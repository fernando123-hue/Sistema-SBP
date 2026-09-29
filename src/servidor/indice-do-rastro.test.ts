import { describe, expect, it } from 'vitest'

import { obterPrisma } from './prisma'

/**
 * As leituras de `EventoProcessamento` por tipo de evento têm índice (pendência 11).
 *
 * ═══ O QUE ESTAVA ABERTO ═══
 *
 * Três leituras escolhem linhas por `situacao` + `etapa` + `referencia`:
 *
 * - o teto do rastro de entrada recusada (`servicos/autenticacao.ts`), a cada
 *   tentativa de entrada com e-mail inexistente e a cada credencial ilegível;
 * - o teto do rastro de permissão negada (`servidor/rastro-de-negacao.ts`);
 * - as tentativas anteriores de um e-mail (`servicos/ingestao.ts`), a cada
 *   sincronização.
 *
 * O índice era só `[situacao, etapa]`, e a tabela nunca é apagada (invariante
 * 11). Medido com 500 mil eventos, o volume de um ano de ataque a um por
 * minuto: 1962 ms por tentativa de entrada com e-mail inexistente, lendo 300
 * mil linhas — justamente a ação que quem ataca repete. Com o índice abaixo:
 * 0,11 ms, e as outras duas de 518 ms e 458 ms para menos de 0,5 ms.
 *
 * Direto no `information_schema`, como `historico-nao-cascateia.test.ts`: é o
 * banco que responde, não o `schema.prisma`.
 */

const banco = obterPrisma()

describe('índice das leituras do rastro', () => {
  it('EventoProcessamento tem índice começando por situacao, etapa, referencia e criadoEm', async () => {
    const colunas = await banco.$queryRaw<{ indice: string; posicao: bigint | number; coluna: string }[]>`
      SELECT INDEX_NAME AS indice, SEQ_IN_INDEX AS posicao, COLUMN_NAME AS coluna
        FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'EventoProcessamento'
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`

    const porIndice = new Map<string, string[]>()
    for (const { indice, coluna } of colunas) {
      porIndice.set(indice, [...(porIndice.get(indice) ?? []), coluna])
    }

    // A ordem importa: igualdades primeiro, o intervalo de tempo por último.
    // Com `criadoEm` antes de `referencia`, o banco usaria só o prefixo.
    const cobre = [...porIndice.values()].some(
      (lista) => lista.slice(0, 4).join(',') === 'situacao,etapa,referencia,criadoEm',
    )
    expect(cobre, `índices encontrados: ${JSON.stringify(Object.fromEntries(porIndice))}`).toBe(true)
  })
})
