import { beforeEach, describe, expect, it } from 'vitest'

import { deslocarDias } from '../core/util/datas'
import { obterPrisma } from '../servidor/prisma'
import type { Ator } from '../servidor/ator'
import { atorDeTeste, DATA_BASE, limparTudo, semearBase, type BaseSemeada } from '../testes/apoio'
import { cancelar, encerrar, registrar } from './afastamentos'
import { avisoDoGestor, marcarAvisoComoVisto } from './aviso-do-gestor'
import { alterarPrazo } from './retencao'
import { rodarLimpezaDiaria } from './rotinas'

const banco = obterPrisma()

/**
 * A regra do aviso é testada em `core/aviso-do-gestor.test.ts`. Aqui: quem pode
 * pedir, e se o que sai do banco chega inteiro à regra — tipo real para a
 * gestora, prazo editado, situação da limpeza de hoje.
 */

let base: BaseSemeada
let gestor: Ator

beforeEach(async () => {
  await limparTudo(banco)
  base = await semearBase(banco, { totalDeDias: 1 })
  const pessoa = await banco.colaborador.create({
    data: { nome: 'Gestora Aviso', email: 'aviso@teste.local', papel: 'gestor' },
  })
  gestor = atorDeTeste(pessoa.id, 'gestor')
})

describe('quem pode', () => {
  it('colaborador e operador não recebem o aviso — ele carrega motivo de ausência', async () => {
    for (const ator of [base.colaboradores[0]!.ator, base.operador]) {
      await expect(avisoDoGestor(banco, ator, DATA_BASE)).rejects.toThrow(/Seu acesso não permite/)
    }
  })
})

describe('o que chega à gestora', () => {
  it('fora hoje com o motivo real, e a limpeza pendente enquanto não roda', async () => {
    await registrar(
      banco,
      {
        colaboradorId: base.colaboradores[0]!.id,
        tipo: 'atestado',
        inicio: DATA_BASE,
        fim: deslocarDias(DATA_BASE, 2),
        observacao: 'sintético',
      },
      gestor,
    )

    const aviso = await avisoDoGestor(banco, gestor, DATA_BASE)

    expect(aviso.foraHoje).toEqual([
      { nome: 'Colaborador A', tipo: 'atestado', volta: deslocarDias(DATA_BASE, 3) },
    ])
    expect(aviso.limpeza).toBe('pendente')
    expect(aviso.vazio).toBe(false)
  })

  it('depois da limpeza de hoje, diz que ela foi concluída, e o motivo apagado não aparece como a sair', async () => {
    await registrar(
      banco,
      {
        colaboradorId: base.colaboradores[0]!.id,
        tipo: 'licenca',
        inicio: deslocarDias(DATA_BASE, -30),
        fim: deslocarDias(DATA_BASE, -20),
        observacao: 'sintético',
      },
      gestor,
    )

    const antes = await avisoDoGestor(banco, gestor, DATA_BASE)
    expect(antes.motivosQueSaem).toHaveLength(1)
    expect(antes.motivosQueSaem[0]!.atrasado).toBe(true)

    await rodarLimpezaDiaria(banco, { hoje: DATA_BASE })
    const depois = await avisoDoGestor(banco, gestor, DATA_BASE)

    expect(depois.limpeza).toBe('concluida')
    expect(depois.motivosQueSaem).toEqual([])
    expect(depois.vazio).toBe(true)
  })

  it('usa o prazo editado: com 30 dias, o motivo de quem voltou há 5 não está perto de sair', async () => {
    await registrar(
      banco,
      {
        colaboradorId: base.colaboradores[0]!.id,
        tipo: 'falta',
        inicio: deslocarDias(DATA_BASE, -6),
        fim: deslocarDias(DATA_BASE, -6),
        observacao: 'sintético',
      },
      gestor,
    )

    expect((await avisoDoGestor(banco, gestor, DATA_BASE)).motivosQueSaem).toHaveLength(1)

    await alterarPrazo(banco, { chave: 'motivo_de_afastamento', dias: 30 }, gestor)

    expect((await avisoDoGestor(banco, gestor, DATA_BASE)).motivosQueSaem).toEqual([])
  })

  it('pessoa desativada não aparece', async () => {
    await registrar(
      banco,
      {
        colaboradorId: base.colaboradores[0]!.id,
        tipo: 'ferias',
        inicio: DATA_BASE,
        fim: DATA_BASE,
        observacao: null,
      },
      gestor,
    )
    await banco.colaborador.update({ where: { id: base.colaboradores[0]!.id }, data: { ativo: false } })

    expect((await avisoDoGestor(banco, gestor, DATA_BASE)).foraHoje).toEqual([])
  })
})

describe('o que mudou desde a última olhada (A39)', () => {
  /**
   * Outra gestora mexe nas ausências. Mudança feita por quem está olhando não
   * acende a bolinha dela — então, para testar novidade, quem mexe tem de ser
   * outra pessoa.
   */
  let colega: Ator

  beforeEach(async () => {
    const pessoa = await banco.colaborador.create({
      data: { nome: 'Colega Gestora', email: 'colega-aviso@teste.local', papel: 'gestor' },
    })
    colega = atorDeTeste(pessoa.id, 'gestor')
  })

  async function feriasHoje(indice: number, quemRegistra: Ator = colega) {
    // Férias sem observação: aparecem só em "fora hoje", nunca em "motivo sai".
    return registrar(
      banco,
      {
        colaboradorId: base.colaboradores[indice]!.id,
        tipo: 'ferias',
        inicio: DATA_BASE,
        fim: deslocarDias(DATA_BASE, 2),
        observacao: null,
      },
      quemRegistra,
    )
  }

  it('primeira olhada do dia; depois de marcar como visto, nada de novo', async () => {
    await feriasHoje(0)

    const primeira = await avisoDoGestor(banco, gestor, DATA_BASE)
    expect(primeira.primeiraVezHoje).toBe(true)

    await marcarAvisoComoVisto(banco, { chaves: primeira.chaves }, gestor, DATA_BASE)
    const depois = await avisoDoGestor(banco, gestor, DATA_BASE)

    expect(depois.primeiraVezHoje).toBe(false)
    expect(depois.novidades).toEqual({ entraram: [], sairam: [] })
  })

  it('troca no mesmo dia: cancelam a de A e registram a de B — o aviso diz os dois nomes', async () => {
    const deA = await feriasHoje(0)
    const visto = await avisoDoGestor(banco, gestor, DATA_BASE)
    await marcarAvisoComoVisto(banco, { chaves: visto.chaves }, gestor, DATA_BASE)

    await cancelar(banco, deA.id, colega)
    await feriasHoje(1)
    const depois = await avisoDoGestor(banco, gestor, DATA_BASE)

    // A contagem de "fora hoje" continua 1 — é justamente o caso que o dono
    // não queria que passasse calado.
    expect(depois.foraHoje).toHaveLength(1)
    expect(depois.novidades).toEqual({
      entraram: [{ lista: 'fora', nome: 'Colaborador B' }],
      sairam: [{ lista: 'fora', nome: 'Colaborador A' }],
    })
  })

  it('não marca como visto o que não está no aviso', async () => {
    await feriasHoje(0)

    await marcarAvisoComoVisto(banco, { chaves: ['fora:inventado'] }, gestor, DATA_BASE)
    const depois = await avisoDoGestor(banco, gestor, DATA_BASE)

    expect(depois.primeiraVezHoje).toBe(false)
    // As três coisas, e não só a primeira: aceitar a chave inventada deixaria a
    // mesma novidade de "entrou", mas gravaria lixo e anunciaria uma saída sem nome.
    expect(depois.novidades).toEqual({ entraram: [{ lista: 'fora', nome: 'Colaborador A' }], sairam: [] })
    const linha = await banco.avisoVisto.findUniqueOrThrow({ where: { colaboradorId: gestor.colaboradorId } })
    expect(JSON.parse(linha.chaves)).toEqual([])
  })

  it('quem é desativado no meio do dia sai da lista com o nome — buscado na linha do afastamento', async () => {
    // A leitura de agora não traz mais a pessoa desativada; o nome de quem saiu
    // tem de vir de outra consulta. Sem ela, a gestora leria "saiu de Fora hoje"
    // sem saber quem.
    await feriasHoje(0)
    const visto = await avisoDoGestor(banco, gestor, DATA_BASE)
    await marcarAvisoComoVisto(banco, { chaves: visto.chaves }, gestor, DATA_BASE)

    await banco.colaborador.update({ where: { id: base.colaboradores[0]!.id }, data: { ativo: false } })
    const depois = await avisoDoGestor(banco, gestor, DATA_BASE)

    expect(depois.novidades).toEqual({ entraram: [], sairam: [{ lista: 'fora', nome: 'Colaborador A' }] })
  })

  it('o que fica guardado são só chaves: nenhum nome, nenhum motivo', async () => {
    await registrar(
      banco,
      {
        colaboradorId: base.colaboradores[0]!.id,
        tipo: 'atestado',
        inicio: DATA_BASE,
        fim: DATA_BASE,
        observacao: 'observação sintética',
      },
      gestor,
    )
    const aviso = await avisoDoGestor(banco, gestor, DATA_BASE)
    await marcarAvisoComoVisto(banco, { chaves: aviso.chaves }, gestor, DATA_BASE)

    const linha = await banco.avisoVisto.findUniqueOrThrow({ where: { colaboradorId: gestor.colaboradorId } })
    expect(JSON.parse(linha.chaves)).toHaveLength(aviso.chaves.length)
    expect(linha.chaves).not.toContain('Colaborador')
    expect(linha.chaves).not.toContain('atestado')
    expect(linha.chaves).not.toContain('observação')
  })

  it('o visto é de cada gestora: o que uma viu não apaga a novidade da outra', async () => {
    const outra = await banco.colaborador.create({
      data: { nome: 'Outra Gestora', email: 'outra-aviso@teste.local', papel: 'gestor' },
    })
    await feriasHoje(0)

    const daPrimeira = await avisoDoGestor(banco, gestor, DATA_BASE)
    await marcarAvisoComoVisto(banco, { chaves: daPrimeira.chaves }, gestor, DATA_BASE)

    expect((await avisoDoGestor(banco, atorDeTeste(outra.id, 'gestor'), DATA_BASE)).primeiraVezHoje).toBe(true)
  })

  it('o que a própria gestora registra não acende a bolinha dela — para a colega, acende', async () => {
    // Levantado pelo dono em 12/09/2026: a gestora é quem mais registra ausência.
    // Sem este filtro, a bolinha dela ficaria acesa quase o tempo todo contando
    // o que ela mesma acabou de fazer.
    for (const ator of [gestor, colega]) {
      const primeira = await avisoDoGestor(banco, ator, DATA_BASE)
      await marcarAvisoComoVisto(banco, { chaves: primeira.chaves }, ator, DATA_BASE)
    }

    await feriasHoje(0, gestor)

    expect((await avisoDoGestor(banco, gestor, DATA_BASE)).novidades).toEqual({ entraram: [], sairam: [] })
    expect((await avisoDoGestor(banco, colega, DATA_BASE)).novidades).toEqual({
      entraram: [{ lista: 'fora', nome: 'Colaborador A' }],
      sairam: [],
    })
  })

  it('quem sai da lista por desativação leva o autor da ausência — a gestora que registrou e desativou não é avisada', async () => {
    // A pessoa desativada não vem mais na leitura de agora: o autor da ausência
    // tem de ser buscado junto com o nome. Sem isso, a própria ação da gestora
    // voltaria a acender a bolinha dela.
    await feriasHoje(0, gestor)
    const visto = await avisoDoGestor(banco, gestor, DATA_BASE)
    await marcarAvisoComoVisto(banco, { chaves: visto.chaves }, gestor, DATA_BASE)

    await banco.colaborador.update({ where: { id: base.colaboradores[0]!.id }, data: { ativo: false } })

    expect((await avisoDoGestor(banco, gestor, DATA_BASE)).novidades).toEqual({ entraram: [], sairam: [] })
  })

  it('"Voltou hoje" marcado pela própria gestora não acende a bolinha dela', async () => {
    const semVolta = await registrar(
      banco,
      {
        colaboradorId: base.colaboradores[0]!.id,
        tipo: 'licenca',
        inicio: deslocarDias(DATA_BASE, -3),
        fim: null,
        observacao: null,
      },
      colega,
    )
    const visto = await avisoDoGestor(banco, gestor, DATA_BASE)
    await marcarAvisoComoVisto(banco, { chaves: visto.chaves }, gestor, DATA_BASE)

    // Voltou hoje: continua fora hoje, passa a voltar amanhã e o motivo entra no relógio.
    await encerrar(banco, { afastamentoId: semVolta.id, fim: DATA_BASE }, gestor)

    const depois = await avisoDoGestor(banco, gestor, DATA_BASE)
    expect(depois.chaves).toContain(`volta:${semVolta.id}`)
    expect(depois.novidades).toEqual({ entraram: [], sairam: [] })
  })

  it('só gestor marca como visto', async () => {
    for (const ator of [base.colaboradores[0]!.ator, base.operador]) {
      await expect(marcarAvisoComoVisto(banco, { chaves: [] }, ator, DATA_BASE)).rejects.toThrow(
        /Seu acesso não permite/,
      )
    }
  })
})
