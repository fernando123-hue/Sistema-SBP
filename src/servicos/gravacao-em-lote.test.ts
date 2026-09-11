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
 * A gravação da rodada escreve em lote.
 *
 * Achado 2 da auditoria de 08/09/2026: `gravarRodada` fazia `atribuicao.create`
 * e `item.update` por item, com a trava do dia segurada — a metade das
 * consultas da confirmação que cresce com o volume. O ganho não aparece em
 * nenhum resultado (a rodada grava o mesmo), então só uma contagem de chamadas
 * impede que um refactor devolva o laço item a item com a suíte verde.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

describe('gravação da rodada', () => {
  it('não faz uma escrita por item — e grava exatamente o que distribuiu', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const [data] = sequenciaDeDatas(DATA_BASE, 1)
    await sincronizar(
      { banco, ingestao: new IngestaoMock({ datas: [data!], semente: 5 }), ia: new IaMock() },
      base.operador,
    )
    await aprovarTudoNoBanco(banco)

    const ordem: string[] = []
    const relatorio = await confirmar(
      bancoQueAnota(banco, ordem),
      { data: data!, categorias: [] },
      base.operador,
    )

    // Sem volume, "zero chamadas por item" seria verdade de graça.
    expect(relatorio.totalDistribuido).toBeGreaterThan(base.colaboradores.length)

    expect(ordem.filter((chamada) => chamada === 'atribuicao.create')).toHaveLength(0)
    expect(ordem.filter((chamada) => chamada === 'item.update')).toHaveLength(0)
    // No máximo uma escrita de atribuições por pessoa, por rodada.
    expect(ordem.filter((chamada) => chamada === 'atribuicao.createMany').length).toBeLessThanOrEqual(
      relatorio.rodadasGravadas * base.colaboradores.length,
    )

    expect(await banco.atribuicao.count({ where: { ativa: true } })).toBe(relatorio.totalDistribuido)
    expect(await banco.item.count({ where: { status: 'distribuido' } })).toBe(
      relatorio.totalDistribuido,
    )
  })
})
