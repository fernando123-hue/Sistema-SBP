import { beforeEach, describe, expect, it } from 'vitest'

import { deslocarDias } from '../core/util/datas'
import { obterPrisma } from '../servidor/prisma'
import { DATA_BASE, atorDeTeste, limparTudo, semearBase } from '../testes/apoio'
import { cancelar, listar, registrar } from './afastamentos'
import { obterEscala } from './escala'
import { confirmar } from './distribuicao'
import { registrarManual } from './itens'

/**
 * Afastamentos (`A10`).
 *
 * A decisão substitui "marcar `Escala.disponivel = false` dia a dia, na mão".
 * Duas semanas de férias eram catorze marcações que alguém precisava lembrar de
 * fazer, e esquecer uma significa distribuir trabalho para quem não está — com
 * o item aparecendo como parado só dias depois.
 *
 * O que estes testes protegem, em ordem de importância:
 *   1. quem está afastado NÃO recebe (é o ponto da decisão);
 *   2. o crédito dele CONGELA — sem isso, quem volta de férias volta credor
 *      gigante e leva tudo, que é o oposto de equilibrar carga;
 *   3. cancelar um afastamento não apaga a trilha.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

/** Gestor é quem registra afastamento — operador cuida do plantão do dia. */
async function comGestor() {
  const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 2 })
  const gestor = await banco.colaborador.create({
    data: { nome: 'Gestora', email: 'gestora@teste.local', papel: 'gestor' },
  })
  return { ...base, gestor: atorDeTeste(gestor.id, 'gestor') }
}

describe('quem pode registrar', () => {
  it('operador não registra afastamento — é decisão de quem administra a equipe', async () => {
    const base = await comGestor()

    await expect(
      registrar(
        banco,
        { colaboradorId: base.colaboradores[0]!.id, tipo: 'ferias', inicio: DATA_BASE },
        base.operador,
      ),
    ).rejects.toThrow(/permissão|papel/i)
  })

  it('gestor registra', async () => {
    const base = await comGestor()

    const feito = await registrar(
      banco,
      {
        colaboradorId: base.colaboradores[0]!.id,
        tipo: 'ferias',
        inicio: DATA_BASE,
        fim: deslocarDias(DATA_BASE, 14),
      },
      base.gestor,
    )

    expect(feito.tipo).toBe('ferias')
    expect(feito.vigente).toBe(true)
  })
})

describe('validação do período', () => {
  it('recusa fim anterior ao início', async () => {
    const base = await comGestor()

    // Sem esta trava o afastamento nunca cobriria data nenhuma: a consulta pede
    // `inicio <= data AND fim >= data`, e nenhum dia satisfaz as duas. O gestor
    // veria a linha na tela e a pessoa continuaria recebendo trabalho.
    await expect(
      registrar(
        banco,
        {
          colaboradorId: base.colaboradores[0]!.id,
          tipo: 'ferias',
          inicio: DATA_BASE,
          fim: deslocarDias(DATA_BASE, -1),
        },
        base.gestor,
      ),
    ).rejects.toThrow(/anterior ao início/i)
  })

  it('aceita ausência de um dia só', async () => {
    const base = await comGestor()

    const feito = await registrar(
      banco,
      {
        colaboradorId: base.colaboradores[0]!.id,
        tipo: 'falta',
        inicio: DATA_BASE,
        fim: DATA_BASE,
      },
      base.gestor,
    )

    expect(feito.inicio).toBe(feito.fim)
  })

  it('recusa afastamento sobreposto, nomeando o que já existe', async () => {
    const base = await comGestor()
    const pessoa = base.colaboradores[0]!

    await registrar(
      banco,
      {
        colaboradorId: pessoa.id,
        tipo: 'ferias',
        inicio: DATA_BASE,
        fim: deslocarDias(DATA_BASE, 10),
      },
      base.gestor,
    )

    // Dois afastamentos no mesmo dia não mudam a elegibilidade, mas quebram a
    // leitura: cancelar UM deixaria a pessoa fora do rateio sem a tela explicar.
    await expect(
      registrar(
        banco,
        {
          colaboradorId: pessoa.id,
          tipo: 'atestado',
          inicio: deslocarDias(DATA_BASE, 5),
          fim: deslocarDias(DATA_BASE, 8),
        },
        base.gestor,
      ),
    ).rejects.toThrow(/já tem afastamento/i)
  })

  it('permite outro afastamento depois que o primeiro termina', async () => {
    const base = await comGestor()
    const pessoa = base.colaboradores[0]!

    await registrar(
      banco,
      { colaboradorId: pessoa.id, tipo: 'ferias', inicio: DATA_BASE, fim: deslocarDias(DATA_BASE, 5) },
      base.gestor,
    )

    const segundo = await registrar(
      banco,
      {
        colaboradorId: pessoa.id,
        tipo: 'atestado',
        inicio: deslocarDias(DATA_BASE, 6),
        fim: deslocarDias(DATA_BASE, 7),
      },
      base.gestor,
    )

    expect(segundo.id).toBeTruthy()
  })
})

describe('efeito no rateio — o ponto da decisão', () => {
  it('quem está afastado não recebe, mesmo escalado', async () => {
    const base = await comGestor()
    const afastada = base.colaboradores[0]!
    const presente = base.colaboradores[1]!

    // A escala do dia continua marcada: é exatamente o caso que o A10 resolve —
    // ninguém precisa lembrar de desmarcar dia a dia.
    await registrar(
      banco,
      { colaboradorId: afastada.id, tipo: 'ferias', inicio: DATA_BASE, fim: deslocarDias(DATA_BASE, 14) },
      base.gestor,
    )

    await registrarManual(
      banco,
      { categoriaCodigo: 'DOC_CADASTRO', titulo: 'Documento', quantidade: 4 },
      base.operador,
    )
    await confirmar(banco, { data: DATA_BASE, categorias: ['DOC_CADASTRO'] }, base.operador)

    const daAfastada = await banco.atribuicao.count({
      where: { colaboradorId: afastada.id, ativa: true },
    })
    const doPresente = await banco.atribuicao.count({
      where: { colaboradorId: presente.id, ativa: true },
    })

    expect(daAfastada).toBe(0)
    expect(doPresente).toBe(4)
  })

  it('o crédito de quem está afastado CONGELA — não fica credor durante a ausência', async () => {
    const base = await comGestor()
    const afastada = base.colaboradores[0]!

    await registrar(
      banco,
      { colaboradorId: afastada.id, tipo: 'ferias', inicio: DATA_BASE, fim: deslocarDias(DATA_BASE, 14) },
      base.gestor,
    )

    await registrarManual(
      banco,
      { categoriaCodigo: 'DOC_CADASTRO', titulo: 'Documento', quantidade: 6 },
      base.operador,
    )
    await confirmar(banco, { data: DATA_BASE, categorias: ['DOC_CADASTRO'] }, base.operador)

    // ESTE é o teste que importa. Se o crédito acumulasse durante a ausência,
    // quem passou duas semanas fora voltaria como credor gigante e levaria
    // tudo — o oposto de equilibrar carga. Ele congela por CONSEQUÊNCIA: só
    // muda para quem entra numa rodada, e a afastada não entrou.
    const saldo = await banco.saldoCarga.findFirst({
      where: { colaboradorId: afastada.id },
    })

    expect(saldo).toBeNull()
  })

  it('afastamento cancelado deixa de tirar a pessoa do rateio', async () => {
    const base = await comGestor()
    const pessoa = base.colaboradores[0]!

    const feito = await registrar(
      banco,
      { colaboradorId: pessoa.id, tipo: 'ferias', inicio: DATA_BASE, fim: deslocarDias(DATA_BASE, 14) },
      base.gestor,
    )
    await cancelar(banco, feito.id, base.gestor)

    await registrarManual(
      banco,
      { categoriaCodigo: 'DOC_CADASTRO', titulo: 'Documento', quantidade: 4 },
      base.operador,
    )
    await confirmar(banco, { data: DATA_BASE, categorias: ['DOC_CADASTRO'] }, base.operador)

    const recebidas = await banco.atribuicao.count({
      where: { colaboradorId: pessoa.id, ativa: true },
    })
    expect(recebidas).toBe(2)
  })

  it('ausência em aberto cobre o dia enquanto ninguém encerrar', async () => {
    const base = await comGestor()
    const afastada = base.colaboradores[0]!

    await registrar(
      banco,
      { colaboradorId: afastada.id, tipo: 'licenca', inicio: DATA_BASE, fim: null },
      base.gestor,
    )

    await registrarManual(
      banco,
      { categoriaCodigo: 'DOC_CADASTRO', titulo: 'Documento', quantidade: 4 },
      base.operador,
    )
    await confirmar(banco, { data: DATA_BASE, categorias: ['DOC_CADASTRO'] }, base.operador)

    expect(
      await banco.atribuicao.count({ where: { colaboradorId: afastada.id, ativa: true } }),
    ).toBe(0)
  })

  it('afastamento que já terminou não tira ninguém do rateio', async () => {
    const base = await comGestor()
    const pessoa = base.colaboradores[0]!

    await registrar(
      banco,
      {
        colaboradorId: pessoa.id,
        tipo: 'falta',
        inicio: deslocarDias(DATA_BASE, -10),
        fim: deslocarDias(DATA_BASE, -9),
      },
      base.gestor,
    )

    await registrarManual(
      banco,
      { categoriaCodigo: 'DOC_CADASTRO', titulo: 'Documento', quantidade: 4 },
      base.operador,
    )
    await confirmar(banco, { data: DATA_BASE, categorias: ['DOC_CADASTRO'] }, base.operador)

    expect(
      await banco.atribuicao.count({ where: { colaboradorId: pessoa.id, ativa: true } }),
    ).toBe(2)
  })
})

describe('a tela de plantão e a distribuição têm de concordar', () => {
  it('a escala marca quem está afastado, para a tela não prometer o que não vai acontecer', async () => {
    const base = await comGestor()
    const afastada = base.colaboradores[0]!

    await registrar(
      banco,
      { colaboradorId: afastada.id, tipo: 'ferias', inicio: DATA_BASE, fim: deslocarDias(DATA_BASE, 14) },
      base.gestor,
    )

    const escala = await obterEscala(banco, DATA_BASE)
    const linha = escala.find((item) => item.colaboradorId === afastada.id)!

    // Sem este campo a tela deixava marcar a caixa, `carregarElegiveis`
    // excluía a pessoa do rateio de qualquer jeito, e a prévia vinha com uma
    // pessoa a menos sem NADA explicar. Marcar e não acontecer nada é a
    // divergência silenciosa que este sistema existe para eliminar.
    expect(linha.afastamento).toBe('ferias')
  })

  it('quem não está afastado continua sem marca', async () => {
    const base = await comGestor()

    const escala = await obterEscala(banco, DATA_BASE)
    for (const linha of escala) {
      expect(linha.afastamento).toBeNull()
    }
    expect(base.colaboradores.length).toBeGreaterThan(0)
  })

  it('a marca da escala usa a MESMA cobertura de data que o rateio', async () => {
    const base = await comGestor()
    const pessoa = base.colaboradores[0]!

    // Afastamento que termina ONTEM: não cobre hoje, nos dois lugares.
    await registrar(
      banco,
      {
        colaboradorId: pessoa.id,
        tipo: 'falta',
        inicio: deslocarDias(DATA_BASE, -3),
        fim: deslocarDias(DATA_BASE, -1),
      },
      base.gestor,
    )

    const escala = await obterEscala(banco, DATA_BASE)
    expect(escala.find((item) => item.colaboradorId === pessoa.id)!.afastamento).toBeNull()

    await registrarManual(
      banco,
      { categoriaCodigo: 'DOC_CADASTRO', titulo: 'Documento', quantidade: 4 },
      base.operador,
    )
    await confirmar(banco, { data: DATA_BASE, categorias: ['DOC_CADASTRO'] }, base.operador)

    // Se as duas condições divergissem, a tela diria uma coisa e a
    // distribuição faria outra — e ninguém saberia qual acreditar.
    expect(
      await banco.atribuicao.count({ where: { colaboradorId: pessoa.id, ativa: true } }),
    ).toBe(2)
  })
})

describe('cancelamento carimba, nunca apaga', () => {
  it('a linha continua no banco depois de cancelada', async () => {
    const base = await comGestor()

    const feito = await registrar(
      banco,
      { colaboradorId: base.colaboradores[0]!.id, tipo: 'ferias', inicio: DATA_BASE },
      base.gestor,
    )
    await cancelar(banco, feito.id, base.gestor)

    // A trilha precisa continuar respondendo por que alguém ficou fora do
    // rateio na terça-feira passada. Apagar a linha destruiria essa resposta.
    const linha = await banco.afastamento.findUniqueOrThrow({ where: { id: feito.id } })
    expect(linha.canceladoEm).not.toBeNull()
    expect(linha.canceladoPor).toBeTruthy()
  })

  it('recusa cancelar duas vezes', async () => {
    const base = await comGestor()

    const feito = await registrar(
      banco,
      { colaboradorId: base.colaboradores[0]!.id, tipo: 'ferias', inicio: DATA_BASE },
      base.gestor,
    )
    await cancelar(banco, feito.id, base.gestor)

    await expect(cancelar(banco, feito.id, base.gestor)).rejects.toThrow(/já foi cancelado/i)
  })

  it('some da listagem, mas o registro fica', async () => {
    const base = await comGestor()

    const feito = await registrar(
      banco,
      { colaboradorId: base.colaboradores[0]!.id, tipo: 'ferias', inicio: DATA_BASE },
      base.gestor,
    )
    expect(await listar(banco, base.gestor)).toHaveLength(1)

    await cancelar(banco, feito.id, base.gestor)
    expect(await listar(banco, base.gestor)).toHaveLength(0)
    expect(await banco.afastamento.count()).toBe(1)
  })
})
