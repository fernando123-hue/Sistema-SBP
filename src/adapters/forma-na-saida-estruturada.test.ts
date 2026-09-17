import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { describe, expect, it } from 'vitest'

import { RespostaDoModeloAssistenteSchema } from '../core/assistente/esquemas'
import { EmailBrutoSchema } from '../core/esquemas'
import { InterpretadorEstruturado, RespostaDoModeloSchema, type ClienteDeModelo } from './ia-estruturada'
import { clienteAnthropic, IaAnthropic, PERFIL_ANTHROPIC } from './ia-anthropic'

/**
 * Achado C-01 (`docs/auditoria/2026-09-17-achados-da-auditoria-por-agentes.md`).
 *
 * A saída estruturada da Anthropic (`zodOutputFormat`) fecha TODO objeto com
 * `additionalProperties: false`. Um `z.record` vira um objeto fechado sem
 * propriedade nenhuma, e a decodificação restrita só deixa o modelo escrever
 * `{}` ali. Era o caso de `campos`: com `IA_ADAPTER=anthropic`, nome, CPF e CRM
 * nunca eram extraídos, e nada acusava. O duble dos outros testes não passa
 * pelo SDK, por isso nenhum deles via.
 *
 * Estes testes olham a forma DEPOIS da transformação do SDK — a que a API
 * recebe de verdade.
 */

type NoDeEsquema = Record<string, unknown>

/** Todo objeto fechado que não declara propriedade nenhuma: só aceita `{}`. */
function objetosFechadosVazios(no: unknown, caminho = '$'): string[] {
  if (Array.isArray(no)) return no.flatMap((filho, i) => objetosFechadosVazios(filho, `${caminho}[${i}]`))
  if (no === null || typeof no !== 'object') return []
  const objeto = no as NoDeEsquema
  const proprios =
    objeto['type'] === 'object' &&
    objeto['additionalProperties'] === false &&
    Object.keys((objeto['properties'] as NoDeEsquema | undefined) ?? {}).length === 0
      ? [caminho]
      : []
  return [
    ...proprios,
    ...Object.entries(objeto).flatMap(([chave, filho]) => objetosFechadosVazios(filho, `${caminho}.${chave}`)),
  ]
}

describe('forma enviada à saída estruturada da Anthropic', () => {
  it.each([
    ['interpretação de e-mail', RespostaDoModeloSchema],
    ['assistente', RespostaDoModeloAssistenteSchema],
  ])('%s: nenhum objeto sai fechado e vazio', (_nome, esquema) => {
    expect(objetosFechadosVazios(zodOutputFormat(esquema).schema)).toEqual([])
  })

  it('campos viaja como lista de pares chave/valor', () => {
    const forma = JSON.stringify(zodOutputFormat(RespostaDoModeloSchema).schema)
    expect(forma).toContain('"chave"')
    expect(forma).toContain('"valor"')
  })
})

const EMAIL = EmailBrutoSchema.parse({
  messageId: 'c01@exemplo.test',
  remetente: 'alguem@exemplo.test',
  assunto: 'Ficha',
  corpo: 'Nome: Fulano Sintético. CPF 000.000.000-00',
  recebidoEm: new Date('2026-09-17T12:00:00.000Z'),
})

function item(campos: unknown): unknown {
  return {
    categoriaCodigo: 'FICHA_CADASTRO',
    titulo: 'Ficha',
    confianca: 0.9,
    campos,
    camposAusentes: [],
    ligaMencionada: null,
    observacao: null,
  }
}

function cliente(respostas: unknown[]): ClienteDeModelo & { chamadas: number } {
  const estado = { chamadas: 0 }
  return {
    get chamadas() {
      return estado.chamadas
    },
    async gerar() {
      const atual = respostas[Math.min(estado.chamadas, respostas.length - 1)]
      estado.chamadas += 1
      return { objeto: atual, modeloUsado: 'modelo-de-teste' }
    },
  }
}

describe('campos: pares do modelo viram o mapa do sistema', () => {
  it('os pares chegam à interpretação como mapa', async () => {
    const duble = cliente([
      {
        itens: [
          item([
            { chave: 'nome', valor: 'Fulano Sintético' },
            { chave: 'cpf', valor: '000.000.000-00' },
          ]),
        ],
        pareceInstrucao: false,
      },
    ])

    const interpretacao = await new InterpretadorEstruturado(PERFIL_ANTHROPIC, duble).interpretar(EMAIL)

    expect(interpretacao.itens[0]!.campos).toEqual({ nome: 'Fulano Sintético', cpf: '000.000.000-00' })
  })

  it('lista vazia vira mapa vazio, e campos omitido também', async () => {
    const duble = cliente([{ itens: [item([]), { ...(item([]) as object), campos: undefined }], pareceInstrucao: false }])

    const interpretacao = await new InterpretadorEstruturado(PERFIL_ANTHROPIC, duble).interpretar(EMAIL)

    expect(interpretacao.itens.map((i) => i.campos)).toEqual([{}, {}])
  })

  it('chave repetida é defeito de forma: repete uma vez e depois falha alto', async () => {
    const repetida = {
      itens: [
        item([
          { chave: 'cpf', valor: '000.000.000-00' },
          { chave: 'cpf', valor: '111.111.111-11' },
        ]),
      ],
      pareceInstrucao: false,
    }
    const duble = cliente([repetida, repetida])

    await expect(new InterpretadorEstruturado(PERFIL_ANTHROPIC, duble).interpretar(EMAIL)).rejects.toThrow()
    expect(duble.chamadas).toBe(2)
  })

  it('o mapa antigo não é mais aceito do modelo', async () => {
    const antigo = { itens: [item({ cpf: '000.000.000-00' })], pareceInstrucao: false }
    const duble = cliente([antigo, antigo])

    await expect(new InterpretadorEstruturado(PERFIL_ANTHROPIC, duble).interpretar(EMAIL)).rejects.toThrow()
  })
})

/**
 * O caminho REAL do SDK, com a rede trocada por um `fetch` falso.
 *
 * Revisão do PR #58: `messages.parse` validava a resposta dentro do SDK e
 * lançava `AnthropicError`, que `especieDoErro` lê como transporte — a nova
 * tentativa por erro de forma nunca acontecia com a Anthropic, e a causa crua
 * ia para o log. O duble dos testes acima não passa pelo SDK e não via isso.
 */
describe('Anthropic pelo SDK de verdade, sem rede', () => {
  function respostaDaApi(texto: string): Response {
    return new Response(
      JSON.stringify({
        id: 'msg_teste',
        type: 'message',
        role: 'assistant',
        model: 'claude-modelo-de-teste',
        content: [{ type: 'text', text: texto }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  function apiFalsa(textos: string[]) {
    const corpos: Record<string, unknown>[] = []
    const falso = async (_url: unknown, init?: { body?: unknown }) => {
      corpos.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return respostaDaApi(textos[Math.min(corpos.length - 1, textos.length - 1)]!)
    }
    return { corpos, fetch: falso as unknown as typeof fetch }
  }

  const PARES = JSON.stringify({
    itens: [item([{ chave: 'cpf', valor: '000.000.000-00' }])],
    pareceInstrucao: false,
  })

  it('a forma vai no pedido e os campos voltam preenchidos', async () => {
    const api = apiFalsa([PARES])
    const ia = new IaAnthropic(clienteAnthropic({ chave: 'chave-de-teste', fetch: api.fetch }))

    const interpretacao = await ia.interpretar(EMAIL)

    expect(interpretacao.itens[0]!.campos).toEqual({ cpf: '000.000.000-00' })
    expect(interpretacao.modelo).toBe('claude-modelo-de-teste')
    const formato = (api.corpos[0]!['output_config'] as { format: { type: string; schema: unknown } }).format
    expect(formato.type).toBe('json_schema')
    expect(objetosFechadosVazios(formato.schema)).toEqual([])
  })

  it('erro de forma repete UMA vez, com o defeito resumido', async () => {
    const repetida = JSON.stringify({
      itens: [
        item([
          { chave: 'cpf', valor: '000.000.000-00' },
          { chave: 'cpf', valor: '111.111.111-11' },
        ]),
      ],
      pareceInstrucao: false,
    })
    const api = apiFalsa([repetida, PARES])
    const ia = new IaAnthropic(clienteAnthropic({ chave: 'chave-de-teste', fetch: api.fetch }))

    const interpretacao = await ia.interpretar(EMAIL)

    expect(api.corpos).toHaveLength(2)
    expect(String(api.corpos[1]!['system'])).toContain('rejeitada pela validação')
    expect(interpretacao.itens[0]!.campos).toEqual({ cpf: '000.000.000-00' })
  })

  it('resposta que não é JSON também repete, sem devolver o texto ao modelo', async () => {
    const api = apiFalsa(['não é json: CPF 000.000.000-00', PARES])
    const ia = new IaAnthropic(clienteAnthropic({ chave: 'chave-de-teste', fetch: api.fetch }))

    await ia.interpretar(EMAIL)

    expect(api.corpos).toHaveLength(2)
    expect(String(api.corpos[1]!['system'])).not.toContain('000.000.000-00')
  })
})
