import { beforeEach, describe, expect, it } from 'vitest'

import { deslocarDias } from '../core/util/datas'
import { obterPrisma } from '../servidor/prisma'
import type { Ator } from '../servidor/ator'
import { atorDeTeste, DATA_BASE, limparTudo, semearBase, type BaseSemeada } from '../testes/apoio'
import { registrar } from './afastamentos'
import { avisoDoGestor } from './aviso-do-gestor'
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
      await expect(avisoDoGestor(banco, ator, DATA_BASE)).rejects.toThrow(/não pode executar/)
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
