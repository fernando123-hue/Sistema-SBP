import { beforeEach, describe, expect, it } from 'vitest'

import { obterPrisma } from '../servidor/prisma'
import { sequenciaDeDatas } from '../core/util/datas'
import { DATA_BASE, atorDeTeste, limparTudo } from '../testes/apoio'
import { confirmar } from './distribuicao'

/**
 * Distribuir fora de ordem não pode apagar crédito.
 *
 * ═══ O DEFEITO ═══
 *
 * `creditoGlobal` é um TOTAL CORRIDO: cada linha de `SaldoCargaGlobal` guarda o
 * acumulado até aquele dia, e `carregarElegiveis` lê a linha mais recente com
 * `data <= data`.
 *
 * Distribuir uma data ANTERIOR a outra já distribuída quebrava a cadeia. A
 * linha retroativa nascia certa; as dos dias seguintes continuavam com o valor
 * calculado sem ela. Toda leitura posterior pegava uma dessas, e o efeito da
 * rodada retroativa deixava de existir para o desempate — sem erro e sem aviso.
 *
 * Sexta-feira esquecida e feriado processado depois são operação normal, então
 * a correção é propagar, não proibir.
 */

const banco = obterPrisma()

async function semear() {
  const operador = await banco.colaborador.create({
    data: { nome: 'Operadora', email: 'op@teste.local', papel: 'operador' },
  })
  const ana = await banco.colaborador.create({
    data: { nome: 'Ana', email: 'ana@teste.local', papel: 'colaborador' },
  })
  const bruno = await banco.colaborador.create({
    data: { nome: 'Bruno', email: 'bruno@teste.local', papel: 'colaborador' },
  })

  const categoria = await banco.categoria.create({
    data: {
      codigo: 'DOC_CADASTRO',
      rotulo: 'Documento',
      frente: 'CADASTRO',
      grupo: 'ASSOCIADO',
      divisivel: true,
      limiarIndivisivel: 1,
    },
  })

  const dias = sequenciaDeDatas(DATA_BASE, 3)
  for (const pessoa of [ana, bruno]) {
    await banco.habilitacao.create({
      data: { colaboradorId: pessoa.id, categoriaId: categoria.id, podeReceber: true },
    })
    for (const data of dias) {
      await banco.escala.create({
        data: { data, colaboradorId: pessoa.id, disponivel: true },
      })
    }
  }

  return { operador: atorDeTeste(operador.id, 'operador'), categoria, ana, bruno, dias }
}

/** Itens nascendo numa data específica, para caírem no corte temporal daquele dia. */
async function criarItens(categoriaId: string, quando: string, quantos: number): Promise<void> {
  for (let i = 0; i < quantos; i += 1) {
    await banco.item.create({
      data: {
        categoriaId,
        titulo: `Documento ${quando} ${i}`,
        status: 'aprovado',
        criadoEm: new Date(`${quando}T09:00:00.000Z`),
      },
    })
  }
}

/** O acumulado que o desempate leria para uma data. */
async function creditoLidoPara(colaboradorId: string, data: string): Promise<number> {
  const linha = await banco.saldoCargaGlobal.findFirst({
    where: { colaboradorId, escopo: 'CADASTRO', data: { lte: data } },
    orderBy: { data: 'desc' },
    select: { creditoGlobal: true },
  })
  return linha?.creditoGlobal ?? 0
}

/** O acumulado DE CATEGORIA que o desempate leria — o critério primário. */
async function creditoDeCategoriaLidoPara(
  colaboradorId: string,
  categoriaId: string,
  data: string,
): Promise<number> {
  const linha = await banco.saldoCarga.findFirst({
    where: { colaboradorId, categoriaId, data: { lte: data } },
    orderBy: { data: 'desc' },
    select: { creditoAcumulado: true },
  })
  return linha?.creditoAcumulado ?? 0
}

beforeEach(async () => {
  await limparTudo(banco)
})

describe('distribuição fora de ordem', () => {
  it('a rodada retroativa entra no crédito que os dias seguintes enxergam', async () => {
    const base = await semear()
    const [dia1, dia2] = base.dias as [string, string, string]

    // Ordem TORTA de propósito: o dia 2 primeiro, o dia 1 depois.
    await criarItens(base.categoria.id, dia2, 3)
    await confirmar(banco, { data: dia2, categorias: [] }, base.operador)

    const antes = {
      ana: await creditoLidoPara(base.ana.id, dia2),
      bruno: await creditoLidoPara(base.bruno.id, dia2),
    }

    await criarItens(base.categoria.id, dia1, 3)
    await confirmar(banco, { data: dia1, categorias: [] }, base.operador)

    const depois = {
      ana: await creditoLidoPara(base.ana.id, dia2),
      bruno: await creditoLidoPara(base.bruno.id, dia2),
    }

    // A rodada retroativa mexeu no crédito de alguém — logo, o que os dias
    // seguintes leem TEM de ter mudado. Antes da correção, não mudava.
    const mudou = depois.ana !== antes.ana || depois.bruno !== antes.bruno
    expect(mudou, 'a rodada retroativa não chegou às datas posteriores').toBe(true)
  })

  it('o crédito global do dia continua somando ~zero entre a equipe', async () => {
    // O crédito é um jogo de soma zero: o que um recebe a mais que a cota
    // justa, outro recebeu a menos. Se a propagação tivesse duplicado deltas,
    // esta soma sairia do lugar.
    const base = await semear()
    const [dia1, dia2, dia3] = base.dias as [string, string, string]

    await criarItens(base.categoria.id, dia2, 3)
    await confirmar(banco, { data: dia2, categorias: [] }, base.operador)
    await criarItens(base.categoria.id, dia1, 3)
    await confirmar(banco, { data: dia1, categorias: [] }, base.operador)
    await criarItens(base.categoria.id, dia3, 2)
    await confirmar(banco, { data: dia3, categorias: [] }, base.operador)

    const doUltimoDia = await banco.saldoCargaGlobal.findMany({ where: { data: dia3 } })
    const soma = doUltimoDia.reduce((total, linha) => total + linha.creditoGlobal, 0)
    expect(Math.abs(soma)).toBeLessThan(0.001)
  })

  /**
   * A conta exata, nos DOIS razões.
   *
   * Com o dia 2 distribuído antes, a linha dele guarda só o movimento do dia 2
   * (não havia nada antes). Quando o dia 1 entra depois, o total corrido que o
   * dia 2 enxerga tem de passar a ser dia 1 + movimento do dia 2 — nem mais, nem
   * menos. "Mudou" não bastava: a primeira correção só propagava o global, e o
   * crédito POR CATEGORIA — o critério primário do desempate — ficou parado
   * (revisão do PR #35). Um teste que só olhava o global não tinha como ver.
   */
  it('o total corrido do dia seguinte passa a ser exatamente dia anterior + movimento, nos dois razões', async () => {
    const base = await semear()
    const [dia1, dia2] = base.dias as [string, string, string]

    await criarItens(base.categoria.id, dia2, 3)
    await confirmar(banco, { data: dia2, categorias: [] }, base.operador)

    const movimentoDoDia2 = {
      global: await creditoLidoPara(base.ana.id, dia2),
      categoria: await creditoDeCategoriaLidoPara(base.ana.id, base.categoria.id, dia2),
    }
    // Sem movimento, a conta abaixo passaria com zero em tudo.
    expect(movimentoDoDia2.categoria).not.toBe(0)

    await criarItens(base.categoria.id, dia1, 3)
    await confirmar(banco, { data: dia1, categorias: [] }, base.operador)

    const dia1Gravado = {
      global: await creditoLidoPara(base.ana.id, dia1),
      categoria: await creditoDeCategoriaLidoPara(base.ana.id, base.categoria.id, dia1),
    }
    expect(dia1Gravado.categoria).not.toBe(0)

    expect(await creditoLidoPara(base.ana.id, dia2)).toBeCloseTo(
      dia1Gravado.global + movimentoDoDia2.global,
      6,
    )
    expect(await creditoDeCategoriaLidoPara(base.ana.id, base.categoria.id, dia2)).toBeCloseTo(
      dia1Gravado.categoria + movimentoDoDia2.categoria,
      6,
    )
  })

  it('no caminho normal, em ordem, nada muda', async () => {
    // A propagação não pode ter efeito quando não há dia posterior — é o
    // caminho de todo dia, e uma regressão aqui passaria despercebida.
    const base = await semear()
    const [dia1, dia2] = base.dias as [string, string, string]

    await criarItens(base.categoria.id, dia1, 3)
    await confirmar(banco, { data: dia1, categorias: [] }, base.operador)
    const aposDia1 = await creditoLidoPara(base.ana.id, dia1)

    await criarItens(base.categoria.id, dia2, 3)
    await confirmar(banco, { data: dia2, categorias: [] }, base.operador)

    // A linha do dia 1 não pode ter sido tocada pela rodada do dia 2.
    expect(await creditoLidoPara(base.ana.id, dia1)).toBeCloseTo(aposDia1, 6)
  })
})
