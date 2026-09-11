import { beforeEach, describe, expect, it } from 'vitest'

import { IaMock } from '../adapters/ia-mock'
import { IngestaoMock } from '../adapters/ingestao-mock'
import { sequenciaDeDatas } from '../core/util/datas'
import { obterPrisma } from '../servidor/prisma'
import { DATA_BASE, aprovarTudoNoBanco, limparTudo, semearBase } from '../testes/apoio'
import { bancoQueAnota } from '../testes/banco-que-anota'
import { confirmar } from './distribuicao'
import { sincronizar } from './ingestao'

/**
 * A trava do dia (`TravaDeDistribuicao`).
 *
 * Achado 7 da auditoria de 08/09/2026: `travaDeDistribuicao` não aparecia em
 * nenhum teste. E ela é o tipo de linha que alguém remove achando que limpa —
 * nada LÊ `execucoes`, então o `upsert` parece escrita inútil. O que ele faz é
 * serializar o dia: duas confirmações concorrentes de categorias diferentes
 * leriam o crédito global uma da outra ainda não gravado e desempatariam com
 * dado obsoleto. Sem erro, sem exceção — só um rateio injusto.
 *
 * Concorrência real não é observável sob better-sqlite3, que é síncrono. A
 * ORDEM é: a trava tem de ser a primeira coisa que a transação toca.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

async function prepararDia() {
  const base = await semearBase(banco, { totalDeDias: 1 })
  const datas = sequenciaDeDatas(DATA_BASE, 1)
  await sincronizar(
    { banco, ingestao: new IngestaoMock({ datas, semente: 5 }), ia: new IaMock() },
    base.operador,
  )
  await aprovarTudoNoBanco(banco)
  return { base, data: datas[0]! }
}

describe('trava de distribuição do dia', () => {
  it('confirmar registra a trava do dia e conta cada execução', async () => {
    const { base, data } = await prepararDia()

    await confirmar(banco, { data, categorias: [] }, base.operador)
    // A segunda não tem mais nada a distribuir — e ainda assim toma a trava. É
    // a mesma porta, com ou sem trabalho do outro lado.
    await confirmar(banco, { data, categorias: [] }, base.operador)

    const trava = await banco.travaDeDistribuicao.findUnique({ where: { data } })
    expect(trava?.execucoes).toBe(2)
  })

  it('a trava é tomada ANTES de qualquer leitura de crédito', async () => {
    const { base, data } = await prepararDia()
    const ordem: string[] = []

    await confirmar(bancoQueAnota(banco, ordem), { data, categorias: [] }, base.operador)

    // Sem esta conferência o teste passaria com uma transação vazia: a trava
    // seria "a primeira" de uma lista de um.
    expect(ordem.some((chamada) => chamada.startsWith('saldoCarga'))).toBe(true)
    expect(ordem[0]).toBe('travaDeDistribuicao.upsert')
  })
})
