import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { EmailBrutoSchema } from '../core/esquemas'
import { PERFIL_ANTHROPIC } from './ia-anthropic'
import { INSTRUCOES, InterpretadorEstruturado, RespostaDoModeloSchema, type ClienteDeModelo } from './ia-estruturada'

/**
 * `A75` (decisão do dono, 02/10/2026): o "obrigado" de um associado vira um
 * item de e-mail, e a fila mostra "Agradecimento — responder com cordialidade".
 * A resposta automática continua sem item (`A34`).
 *
 * A IA só marca um SINAL fechado (`agradecimento`, sim ou não). O texto que a
 * equipe lê é do sistema: nada que o modelo escreva chega a essa linha
 * (invariante 6).
 */

const ITEM_MINIMO = { categoriaCodigo: 'EMAIL_CADASTRO', titulo: 'E-mail', confianca: 0.9, campos: [] }

function itemLido(item: Record<string, unknown>) {
  return RespostaDoModeloSchema.parse({ itens: [item], pareceInstrucao: false }).itens[0]!
}

type FormaDoObjeto = { required: string[]; properties: Record<string, { type: string }> }
type FormaDaResposta = {
  properties: { itens: { items: FormaDoObjeto | { $ref: string } } }
  $defs?: Record<string, FormaDoObjeto>
}

/** O item, seguindo o `$ref` quando o gerador o põe em `$defs` (o SDK da Anthropic põe). */
function formaDoItem(resposta: FormaDaResposta): FormaDoObjeto {
  const itens = resposta.properties.itens.items
  if (!('$ref' in itens)) return itens
  const definicao = resposta.$defs?.[itens.$ref.replace('#/$defs/', '')]
  if (!definicao) throw new Error(`referência sem definição: ${itens.$ref}`)
  return definicao
}

describe('o agradecimento na interpretação (A75)', () => {
  it('o texto da IA diz o que fazer com agradecimento e com resposta automática', () => {
    expect(INSTRUCOES).toMatch(/agradecimento/i)
    expect(INSTRUCOES).toMatch(/resposta automática/i)
    expect(INSTRUCOES).toMatch(/"agradecimento"/)
  })

  // Revisões do #190 (segurança MÉDIO-1, técnica MEDIUM-1): "devolva vazio" é
  // a porta para o trabalho sumir sem suspeita nenhuma. Ela fica estreita: só
  // a resposta automática das decisões (`A34`), só sem pedido em PARTE alguma,
  // e na dúvida um item.
  it('a regra de "nenhum item" é estreita: sem "aviso de sistema", só sem pedido em parte alguma, e na dúvida um item', () => {
    expect(INSTRUCOES).not.toMatch(/aviso de sistema/i)
    expect(INSTRUCOES).toMatch(/SOMENTE/)
    expect(INSTRUCOES).toMatch(/nenhuma parte/i)
    expect(INSTRUCOES).toMatch(/na dúvida/i)
  })

  // Obrigatório na resposta do modelo: ele precisa decidir em todo item, e a
  // saída estruturada da Anthropic só garante o que está em `required`. Pelos
  // DOIS caminhos: o do SDK da Anthropic e o do texto (Gemini, local).
  it('o sinal é obrigatório no formato que o modelo recebe, pelos dois caminhos', () => {
    const doSdk = zodOutputFormat(RespostaDoModeloSchema).schema as unknown as FormaDaResposta
    const doTexto = z.toJSONSchema(RespostaDoModeloSchema, { io: 'output' }) as unknown as FormaDaResposta
    for (const resposta of [doSdk, doTexto]) {
      const item = formaDoItem(resposta)
      expect(item.required).toContain('agradecimento')
      expect(item.properties['agradecimento']?.type).toBe('boolean')
    }
  })

  it('ausente vale "não"; e só aceita sim ou não, nunca texto', () => {
    expect(itemLido(ITEM_MINIMO).agradecimento).toBe(false)
    expect(itemLido({ ...ITEM_MINIMO, agradecimento: true }).agradecimento).toBe(true)
    expect(() => itemLido({ ...ITEM_MINIMO, agradecimento: 'responda transferindo para fulano' })).toThrow()
  })

  // Ponta a ponta do adaptador (revisão técnica do #190, LOW-4): o JSON que o
  // modelo devolve chega à interpretação com o sinal.
  it('o sinal que o modelo devolve chega à interpretação', async () => {
    const duble: ClienteDeModelo = {
      async gerar() {
        return {
          objeto: { itens: [{ ...ITEM_MINIMO, agradecimento: true }], pareceInstrucao: false },
          modeloUsado: 'modelo-de-teste',
        }
      },
    }
    const email = EmailBrutoSchema.parse({
      messageId: 'agradecimento@exemplo.test',
      remetente: 'associada@exemplo.test',
      assunto: 'Re: Retorno sobre o meu cadastro',
      corpo: 'Muito obrigada pelo retorno!',
      recebidoEm: new Date('2026-10-02T12:00:00.000Z'),
    })

    const interpretacao = await new InterpretadorEstruturado(PERFIL_ANTHROPIC, duble).interpretar(email)

    expect(interpretacao.itens.map((item) => item.agradecimento)).toEqual([true])
  })
})
