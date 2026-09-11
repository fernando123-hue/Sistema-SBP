import { describe, expect, it } from 'vitest'

import { DataIsoSchema } from './esquemas'

/**
 * O `refine` de calendário de `DataIsoSchema`.
 *
 * Depois da regex ele parece redundante — e é exatamente o tipo de linha que sai
 * num refactor. Sem ele, `2026-02-30` entra como chave de `Afastamento.inicio`;
 * a comparação de cobertura é textual, então a chave torta cobre uma faixa que
 * não é dia nenhum, e o razão da rodada de `2026-03-02` (para onde o `Date` rola)
 * ganha um concorrente. Nada disso dá erro: dá número errado.
 */
describe('DataIsoSchema', () => {
  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2026-09-00', '2027-02-29', '2026-04-31'])(
    'recusa %s, que tem o formato certo e não existe no calendário',
    (data) => {
      expect(DataIsoSchema.safeParse(data).success).toBe(false)
    },
  )

  it.each(['2024-02-29', '2026-12-31', '2026-01-01', '2026-09-07'])('aceita %s', (data) => {
    expect(DataIsoSchema.safeParse(data).success).toBe(true)
  })

  it.each(['2026-9-7', '07/09/2026', '2026-09-07T00:00:00Z', ''])(
    'recusa %j, que nem tem o formato',
    (data) => {
      expect(DataIsoSchema.safeParse(data).success).toBe(false)
    },
  )
})
