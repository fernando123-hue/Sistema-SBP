import { beforeEach, describe, expect, it } from 'vitest'

import { IaMock } from '../adapters/ia-mock'
import { IngestaoMock } from '../adapters/ingestao-mock'
import { sequenciaDeDatas } from '../core/util/datas'
import { obterPrisma } from '../servidor/prisma'
import { DATA_BASE, aprovarTudoNoBanco, limparTudo, semearBase } from '../testes/apoio'
import { bancoQueAnota } from '../testes/banco-que-anota'
import { confirmar, tomarTravaDoDia } from './distribuicao'
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
 * A ORDEM é o primeiro invariante: a trava tem de ser a primeira coisa que a
 * transação toca. Com o banco em MySQL (`A42`), a CONCORRÊNCIA passou a ser
 * observável de verdade — e foi o que mostrou que serializar a escrita não
 * bastava (achado N-09). Os dois testes de concorrência abaixo seguram isso.
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

  it('quem espera na trava enxerga o crédito que a transação anterior gravou', async () => {
    // ═══ POR QUE ESTE TESTE EXISTE ═══
    //
    // A trava serializa a ESCRITA — isso o teste acima já prova. O que ela
    // precisa garantir é mais do que isso: que a segunda distribuição do dia
    // DECIDA com o crédito que a primeira acabou de gravar. No InnoDB com
    // REPEATABLE READ (o padrão do MySQL), uma transação tira sua fotografia
    // do banco na primeira leitura consistente — e se essa fotografia for
    // tirada ANTES de a trava ser concedida, a transação passa a esperar por
    // uma trava que já não a protege: ela acorda e lê o mundo velho.
    //
    // O sintoma não é erro nenhum. É rateio injusto, silencioso — a mesma
    // pessoa favorecida duas vezes no mesmo dia. Achado N-09 da auditoria de
    // 17/09/2026.
    const { base, data } = await prepararDia()
    const pessoaId = base.operadorId

    // A linha da trava já existe: este é o caso da SEGUNDA distribuição do dia,
    // em que o `upsert` cai no `update` e portanto trava a linha de verdade. O
    // caso da primeira — duas transações criando a linha ao mesmo tempo — está
    // no teste seguinte, e tem outro sintoma.
    await banco.travaDeDistribuicao.create({ data: { data, execucoes: 0 } })

    const chave = { colaboradorId_escopo_data: { colaboradorId: pessoaId, escopo: 'CADASTRO', data } }
    await banco.saldoCargaGlobal.upsert({
      where: chave,
      create: { colaboradorId: pessoaId, escopo: 'CADASTRO', data, creditoGlobal: 0 },
      update: { creditoGlobal: 0 },
    })

    let liberarPrimeira: () => void = () => {}
    const primeiraPodeCommitar = new Promise<void>((pronto) => {
      liberarPrimeira = pronto
    })

    const primeira = banco.$transaction(
      async (tx) => {
        await tomarTravaDoDia(tx, data)
        await tx.saldoCargaGlobal.update({ where: chave, data: { creditoGlobal: 7 } })
        await primeiraPodeCommitar
      },
      { timeout: 20_000 },
    )

    // Deixa a primeira tomar a trava antes de a segunda tentar.
    await new Promise((pronto) => setTimeout(pronto, 300))

    const segunda = banco.$transaction(
      async (tx) => {
        await tomarTravaDoDia(tx, data)
        const saldo = await tx.saldoCargaGlobal.findUnique({ where: chave })
        return saldo?.creditoGlobal ?? -1
      },
      { timeout: 20_000 },
    )

    // Dá tempo de a segunda chegar à trava e ficar esperando, e só então
    // libera a primeira: é essa ordem que reproduz o caso real.
    await new Promise((pronto) => setTimeout(pronto, 300))
    liberarPrimeira()

    await primeira
    expect(await segunda).toBe(7)
  })

  it('duas PRIMEIRAS distribuições do dia ao mesmo tempo: uma espera a outra, sem erro cru', async () => {
    // Com `upsert`, as duas transações passavam pelo SELECT sem achar a linha e
    // as duas tentavam INSERT: a segunda estourava unicidade crua
    // (`Unique constraint failed on the constraint: PRIMARY`) na cara do
    // operador, num dia de trabalho normal. `ON DUPLICATE KEY UPDATE` faz a
    // segunda esperar e somar.
    const { data } = await prepararDia()
    expect(await banco.travaDeDistribuicao.findUnique({ where: { data } })).toBeNull()

    const executar = () =>
      banco.$transaction(async (tx) => tomarTravaDoDia(tx, data), { timeout: 20_000 })

    const resultados = await Promise.allSettled([executar(), executar(), executar()])

    expect(resultados.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled'])
    // Nenhuma execução some na corrida: a trava conta as três.
    expect((await banco.travaDeDistribuicao.findUniqueOrThrow({ where: { data } })).execucoes).toBe(3)
  })

  it('a trava é tomada ANTES de qualquer leitura de crédito', async () => {
    const { base, data } = await prepararDia()
    const ordem: string[] = []

    await confirmar(bancoQueAnota(banco, ordem), { data, categorias: [] }, base.operador)

    // Sem esta conferência o teste passaria com uma transação vazia: a trava
    // seria "a primeira" de uma lista de um.
    expect(ordem.some((chamada) => chamada.startsWith('saldoCarga'))).toBe(true)
    expect(ordem[0]).toBe('tx.$executeRaw')
  })
})
