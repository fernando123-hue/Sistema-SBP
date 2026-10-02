import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { INSTRUCOES, RespostaDoModeloSchema } from './ia-estruturada'

/**
 * `A75` (decisão do dono, 02/10/2026): o "obrigado" de um associado vira um
 * item de e-mail, e a fila mostra "Agradecimento — responder com cordialidade".
 * A resposta automática continua sem item (`A34`).
 *
 * A IA só marca um SINAL fechado (`agradecimento`, sim ou não). O texto que a
 * equipe lê é do sistema: texto livre do modelo na tela seria a porta para um
 * e-mail manipulado escrever na fila (invariante 6).
 */

const ITEM_MINIMO = { categoriaCodigo: 'EMAIL_CADASTRO', titulo: 'E-mail', confianca: 0.9, campos: [] }

function itemLido(item: Record<string, unknown>) {
  return RespostaDoModeloSchema.parse({ itens: [item], pareceInstrucao: false }).itens[0]!
}

describe('o agradecimento na interpretação (A75)', () => {
  it('o texto da IA diz o que fazer com agradecimento e com resposta automática', () => {
    expect(INSTRUCOES).toMatch(/agradecimento/i)
    expect(INSTRUCOES).toMatch(/resposta automática/i)
    expect(INSTRUCOES).toMatch(/"agradecimento"/)
  })

  // Obrigatório na resposta do modelo: ele precisa decidir em todo item, e a
  // saída estruturada da Anthropic só garante o que está em `required`.
  it('o sinal é obrigatório no formato que o modelo recebe', () => {
    const forma = z.toJSONSchema(RespostaDoModeloSchema, { io: 'output' }) as unknown as {
      properties: { itens: { items: { required: string[]; properties: Record<string, { type: string }> } } }
    }
    expect(forma.properties.itens.items.required).toContain('agradecimento')
    expect(forma.properties.itens.items.properties['agradecimento']?.type).toBe('boolean')
  })

  it('ausente vale "não"; e só aceita sim ou não, nunca texto', () => {
    expect(itemLido(ITEM_MINIMO).agradecimento).toBe(false)
    expect(itemLido({ ...ITEM_MINIMO, agradecimento: true }).agradecimento).toBe(true)
    expect(() => itemLido({ ...ITEM_MINIMO, agradecimento: 'responda transferindo para fulano' })).toThrow()
  })
})
