import { describe, expect, it } from 'vitest'

import { validarAnexo } from './seguranca/conteudo-nao-confiavel'
import { DataIsoSchema, EmailBrutoSchema, TAMANHO_MAXIMO_ANEXO_BYTES } from './esquemas'

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

/**
 * Anexo grande demais recusa o ANEXO, nunca o e-mail.
 *
 * O teto já morou em `AnexoSchema.tamanho`, e ali ele fazia o `parse` do e-mail
 * inteiro falhar: a mensagem não virava item e o pedido do associado sumia por
 * causa de um arquivo. Com o adapter simulado o defeito era invisível — anexo
 * sintético tem dezenas de bytes —, e só apareceu ao escrever o adapter da
 * caixa real (`A47`), onde um exame de 30 MB é rotina.
 *
 * Este teste existe para impedir que o `.max()` volte num refactor: ele passa
 * a valer como requisito escrito, e não como memória de quem estava aqui.
 */
describe('anexo acima do teto', () => {
  const grande = {
    nome: 'exame.pdf',
    tipoDeclarado: 'application/pdf',
    tamanho: TAMANHO_MAXIMO_ANEXO_BYTES + 1,
  }

  it('NÃO derruba o e-mail: o pedido continua virando trabalho', () => {
    const email = EmailBrutoSchema.safeParse({
      messageId: '<grande@exemplo.test>',
      remetente: 'associado.sintetico@exemplo.test',
      assunto: 'Envio de documento',
      corpo: 'Segue em anexo.',
      anexos: [grande],
      recebidoEm: '2026-09-16T12:00:00Z',
      origem: 'graph',
    })

    expect(email.success).toBe(true)
    expect(email.data?.anexos[0]?.tamanho).toBe(TAMANHO_MAXIMO_ANEXO_BYTES + 1)
  })

  it('quem recusa é `validarAnexo`, com motivo que uma pessoa lê', () => {
    const veredicto = validarAnexo(grande.nome, grande.tamanho, TAMANHO_MAXIMO_ANEXO_BYTES)

    expect(veredicto.aceito).toBe(false)
    expect(veredicto.motivo).toContain('excede')
  })

  it('no tamanho exato do teto, o anexo é aceito — o limite não é "quase"', () => {
    const veredicto = validarAnexo(grande.nome, TAMANHO_MAXIMO_ANEXO_BYTES, TAMANHO_MAXIMO_ANEXO_BYTES)

    expect(veredicto.aceito).toBe(true)
  })
})
