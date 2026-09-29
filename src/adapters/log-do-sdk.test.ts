import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { clienteAnthropic } from './ia-anthropic'

/**
 * `ANTHROPIC_LOG=debug` não escreve o pedido no console (pendência 29).
 *
 * Nesse modo, o logger do SDK da Anthropic escreve o corpo do e-mail e a
 * resposta inteiros (`formatRequestDetails`), por fora de `registrarLog`,
 * `redigir` e `resumoDeTransporte`. `clienteAnthropic` fixa `logLevel: 'warn'`.
 *
 * ═══ POR QUE ESTE TESTE MORA SOZINHO NUM ARQUIVO ═══
 *
 * O SDK guarda em cache, por objeto `console` e por nível, as funções
 * `console.warn`/`console.error` já presas com `bind`. O primeiro cliente
 * construído num arquivo fixa esse cache. Quando este teste morava em
 * `destino-do-sdk.test.ts`, os clientes dos testes anteriores nasciam antes do
 * espião, e o que o SDK escrevesse em `warn`/`error` ia ao console de verdade
 * sem passar por ele. O teste só provava o que dizia para `debug`/`info`
 * (revisões técnica e de segurança do #144).
 *
 * Aqui o espião é instalado ao carregar o arquivo, antes de qualquer cliente
 * existir, e fica até o fim. O vitest isola cada arquivo, e o cache nasce já
 * com o espião dentro. `vi.resetModules()` não resolveria: o SDK está em
 * `node_modules`, fora do grafo de módulos do vitest.
 */

const SENTINELA = 'SENTINELA-DO-CORPO-DO-EMAIL'
const PEDIDO = {
  instrucoes: 'instruções de teste',
  conteudo: SENTINELA,
  modelo: 'modelo-de-teste',
  esquema: z.object({ ok: z.boolean() }),
}

const escrito: string[] = []
for (const metodo of ['debug', 'info', 'log', 'warn', 'error'] as const) {
  vi.spyOn(console, metodo).mockImplementation((...args: unknown[]) => {
    escrito.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  })
}

beforeEach(() => {
  escrito.length = 0
})

afterEach(() => {
  vi.unstubAllEnvs()
})

afterAll(() => {
  vi.restoreAllMocks()
})

function apiFalsa() {
  let chamadas = 0
  const falso = async () => {
    chamadas += 1
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
  return { chamadas: () => chamadas, fetch: falso as unknown as typeof fetch }
}

it('ANTHROPIC_LOG=debug não escreve o pedido no console, em nível nenhum', async () => {
  vi.stubEnv('ANTHROPIC_LOG', 'debug')
  const api = apiFalsa()

  await clienteAnthropic({ chave: 'chave-de-teste', fetch: api.fetch }).gerar(PEDIDO)

  expect(api.chamadas()).toBe(1)
  expect(escrito.filter((linha) => linha.includes(SENTINELA))).toEqual([])
})
