import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { ambiente, limparCacheDeAmbiente } from '../servidor/ambiente'
import { clienteAnthropic, ENDERECO_DA_API as ENDERECO_ANTHROPIC } from './ia-anthropic'
import { clienteGemini, ENDERECO_DA_API as ENDERECO_GEMINI } from './ia-gemini'

/**
 * Para onde o texto do e-mail vai, e o que sai no log, é decisão do código.
 *
 * Pendência 29: os dois SDKs leem variáveis do ambiente por conta própria.
 * `ANTHROPIC_BASE_URL` e `GOOGLE_GEMINI_BASE_URL` mandam o corpo do e-mail para
 * outro endereço; `GOOGLE_GENAI_USE_VERTEXAI` troca a API gratuita pela Vertex;
 * `ANTHROPIC_AUTH_TOKEN` manda uma segunda credencial junto;
 * `ANTHROPIC_CUSTOM_HEADERS` troca a chave. Nenhuma delas aparece no
 * `.env.example`, então quem as deixou numa máquina não tem motivo para
 * lembrar. (`ANTHROPIC_LOG` tem arquivo próprio: `log-do-sdk.test.ts`.)
 *
 * Cada teste liga UMA variável contra o SDK de verdade, com a rede trocada por
 * um `fetch` falso, e confere o endereço ou o cabeçalho. Um teste por
 * variável, para a mutação de cada opção fixada ter um vermelho só dela.
 */

const SENTINELA = 'SENTINELA-DO-CORPO-DO-EMAIL'
const ESQUEMA = z.object({ ok: z.boolean() })
// O caminho da API gratuita. Na Vertex, com o mesmo host fixado, o caminho vira
// `v1beta1/publishers/google/models/…` — conferir só o host deixava a troca de
// API passar (visto na mutação de `vertexai: false`).
const URL_DA_API_GRATUITA = `${ENDERECO_GEMINI}v1beta/models/modelo-de-teste:generateContent`

const PEDIDO = { instrucoes: 'instruções de teste', conteudo: SENTINELA, modelo: 'modelo-de-teste', esquema: ESQUEMA }

interface Chamada {
  url: string
  cabecalhos: Headers
}

function cabecalhosDe(init?: RequestInit): Headers {
  return new Headers(init?.headers)
}

function urlDe(entrada: unknown): string {
  if (typeof entrada === 'string') return entrada
  if (entrada instanceof URL) return entrada.href
  return (entrada as Request).url
}

beforeEach(() => {
  limparCacheDeAmbiente()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  limparCacheDeAmbiente()
})

describe('Anthropic: o ambiente não escolhe destino nem credencial', () => {
  function apiFalsa() {
    const chamadas: Chamada[] = []
    const falso = async (entrada: unknown, init?: RequestInit) => {
      chamadas.push({ url: urlDe(entrada), cabecalhos: cabecalhosDe(init) })
      return new Response(
        JSON.stringify({
          id: 'msg_teste',
          type: 'message',
          role: 'assistant',
          model: 'claude-modelo-de-teste',
          content: [{ type: 'text', text: '{"ok":true}' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return { chamadas, fetch: falso as unknown as typeof fetch }
  }

  it('ANTHROPIC_BASE_URL não desvia o texto', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://desvio.exemplo.test')
    const api = apiFalsa()

    await clienteAnthropic({ chave: 'chave-de-teste', fetch: api.fetch }).gerar(PEDIDO)

    expect(api.chamadas).toHaveLength(1)
    expect(new URL(api.chamadas[0]!.url).origin).toBe(ENDERECO_ANTHROPIC)
  })

  it('ANTHROPIC_AUTH_TOKEN não vai junto com a chave', async () => {
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'token-que-nao-deve-sair')
    const api = apiFalsa()

    await clienteAnthropic({ chave: 'chave-de-teste', fetch: api.fetch }).gerar(PEDIDO)

    const cabecalhos = api.chamadas[0]!.cabecalhos
    expect(cabecalhos.get('x-api-key')).toBe('chave-de-teste')
    expect(cabecalhos.get('authorization')).toBeNull()
  })

  // A variável entra DEPOIS dos cabeçalhos de autenticação no SDK: sem a
  // segunda tranca, a chave de outra conta e o `Authorization` do gateway iam
  // no pedido (revisões técnica e de segurança do #144).
  it('ANTHROPIC_CUSTOM_HEADERS não troca a chave nem devolve o Authorization', async () => {
    vi.stubEnv('ANTHROPIC_CUSTOM_HEADERS', 'x-api-key: chave-de-outra-conta\nAuthorization: Bearer token-do-gateway')
    const api = apiFalsa()

    await clienteAnthropic({ chave: 'chave-de-teste', fetch: api.fetch }).gerar(PEDIDO)

    const cabecalhos = api.chamadas[0]!.cabecalhos
    expect(cabecalhos.get('x-api-key')).toBe('chave-de-teste')
    expect(cabecalhos.get('authorization')).toBeNull()
  })
})

// A tranca principal: a segunda, acima, só cobre a credencial, e um cabeçalho
// que não conhecemos passaria. `ANTHROPIC_LOG` fica em `log-do-sdk.test.ts`,
// num arquivo próprio — ver lá por quê.
describe('ambiente(): ANTHROPIC_CUSTOM_HEADERS com a Anthropic falha na partida', () => {
  const VALOR = 'x-segredo-do-gateway: valor-que-nao-pode-aparecer'

  it('com IA_ADAPTER=anthropic, recusa subir, sem repetir o valor', () => {
    vi.stubEnv('IA_ADAPTER', 'anthropic')
    vi.stubEnv('ANTHROPIC_API_KEY', 'chave-de-teste')
    vi.stubEnv('ANTHROPIC_CUSTOM_HEADERS', VALOR)

    let mensagem = ''
    try {
      ambiente()
    } catch (erro) {
      mensagem = erro instanceof Error ? erro.message : String(erro)
    }
    expect(mensagem).toMatch(/ANTHROPIC_CUSTOM_HEADERS/)
    expect(mensagem).not.toContain('valor-que-nao-pode-aparecer')
  })

  // O outro lado: a variável pode existir na máquina para outra ferramenta
  // (o próprio Claude Code a aceita), e o SDK da Anthropic nem é construído.
  it('com outro adaptador, sobe', () => {
    vi.stubEnv('IA_ADAPTER', 'gemini')
    vi.stubEnv('GOOGLE_AI_KEY', 'chave-de-teste')
    vi.stubEnv('ANTHROPIC_CUSTOM_HEADERS', VALOR)

    expect(() => ambiente()).not.toThrow()
  })
})

describe('Gemini: o ambiente não escolhe destino nem API', () => {
  function apiFalsa() {
    const chamadas: Chamada[] = []
    vi.stubGlobal('fetch', async (entrada: unknown, init?: RequestInit) => {
      chamadas.push({ url: urlDe(entrada), cabecalhos: cabecalhosDe(init) })
      return new Response(
        JSON.stringify({
          candidates: [{ content: { role: 'model', parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
          modelVersion: 'gemini-modelo-de-teste',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    return chamadas
  }

  beforeEach(() => {
    vi.stubEnv('GOOGLE_AI_KEY', 'chave-de-teste')
  })

  it('GOOGLE_GEMINI_BASE_URL não desvia o texto', async () => {
    vi.stubEnv('GOOGLE_GEMINI_BASE_URL', 'https://desvio.exemplo.test/')
    const chamadas = apiFalsa()

    await clienteGemini().gerar(PEDIDO)

    expect(chamadas).toHaveLength(1)
    expect(chamadas[0]!.url).toBe(URL_DA_API_GRATUITA)
  })

  it('GOOGLE_GENAI_USE_VERTEXAI não troca a API gratuita pela Vertex', async () => {
    vi.stubEnv('GOOGLE_GENAI_USE_VERTEXAI', 'true')
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'projeto-de-teste')
    vi.stubEnv('GOOGLE_CLOUD_LOCATION', 'us-central1')
    const chamadas = apiFalsa()

    await clienteGemini().gerar(PEDIDO)

    expect(chamadas).toHaveLength(1)
    expect(chamadas[0]!.url).toBe(URL_DA_API_GRATUITA)
  })
})
