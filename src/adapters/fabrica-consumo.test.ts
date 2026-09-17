import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EmailBrutoSchema } from '../core/esquemas'
import { InterpretacaoIndisponivelError } from '../ports/ia'
import { limparCacheDeAmbiente } from '../servidor/ambiente'
import { obterPrisma } from '../servidor/prisma'
import { esquecerDisjuntores } from './cliente-com-consumo'
import { criarAiPort } from './fabrica'

/**
 * A fiação do controle de consumo (`A54`, achado C-06).
 *
 * O invólucro e a contagem têm testes próprios; o que só se prova aqui é que a
 * fábrica os LIGA. É a mesma classe de defeito que o comentário de `fabrica.ts`
 * registra: a rota instanciava o mock enquanto a configuração dizia outra
 * coisa, e a suíte inteira continuava verde.
 *
 * O fornecedor é um servidor `node:http` local — o adapter `local` é o único
 * que fala com um servidor de verdade sem chave de ninguém.
 */

const banco = obterPrisma()

let servidor: Server
let respostaDoModelo = { itens: [], pareceInstrucao: false }

const EMAIL = EmailBrutoSchema.parse({
  messageId: 'fiacao@exemplo.test',
  remetente: 'alguem@exemplo.test',
  assunto: 'Dúvida',
  corpo: 'Como emito o boleto?',
  recebidoEm: new Date('2026-09-18T12:00:00.000Z'),
})

beforeEach(async () => {
  await banco.usoDaIa.deleteMany({})
  esquecerDisjuntores()

  servidor = createServer((_requisicao, resposta) => {
    resposta.writeHead(200, { 'content-type': 'application/json' })
    resposta.end(
      JSON.stringify({
        model: 'modelo-do-servidor',
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(respostaDoModelo) } }],
      }),
    )
  })
  await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto))

  vi.stubEnv('IA_ADAPTER', 'local')
  vi.stubEnv('IA_LOCAL_URL', `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/v1`)
  vi.stubEnv('IA_MODELO', 'modelo-de-teste')
  vi.stubEnv('IA_TETO_DIARIO', '')
  limparCacheDeAmbiente()
})

afterEach(async () => {
  vi.unstubAllEnvs()
  limparCacheDeAmbiente()
  esquecerDisjuntores()
  await new Promise<void>((pronto) => servidor.close(() => pronto()))
})

describe('criarAiPort liga o controle de consumo', () => {
  it('uma interpretação vira uma chamada contada, com o modelo que o servidor usou', async () => {
    await criarAiPort().interpretar(EMAIL)

    const linha = await banco.usoDaIa.findFirstOrThrow({})
    expect(linha).toMatchObject({
      fornecedor: 'local',
      modelo: 'modelo-do-servidor',
      tarefa: 'interpretacao',
      chamadas: 1,
      falhas: 0,
    })
  })

  it('atingido o teto diário, a camada é dada como indisponível e o lote para', async () => {
    vi.stubEnv('IA_TETO_DIARIO', '1')
    limparCacheDeAmbiente()

    await criarAiPort().interpretar(EMAIL)
    await expect(criarAiPort().interpretar(EMAIL)).rejects.toBeInstanceOf(InterpretacaoIndisponivelError)
    await expect(criarAiPort().interpretar(EMAIL)).rejects.toThrow(/teto diário/)

    // A chamada impedida não é contada: ela não foi pedida a ninguém.
    expect((await banco.usoDaIa.findFirstOrThrow({})).chamadas).toBe(1)
  })

  it('o mock não é contado — não custa nada e inflaria o teto do fornecedor de verdade', async () => {
    vi.stubEnv('IA_ADAPTER', 'mock')
    limparCacheDeAmbiente()

    await criarAiPort().interpretar(EMAIL)
    expect(await banco.usoDaIa.count()).toBe(0)
  })
})
