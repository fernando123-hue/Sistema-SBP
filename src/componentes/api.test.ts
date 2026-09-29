import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ErroDaApi, mensagemDoErro, observarAtividade } from './api'

/**
 * O que a tela mostra quando a resposta NÃO traz um erro legível.
 *
 * Até 25/09/2026 a pessoa lia "Falha na requisição (404)." — frase de
 * engenharia, com um número que não diz nada a quem atende associado. Acontece
 * de verdade: duas vezes em 24/09 o servidor de telas subiu com as rotas
 * aninhadas de `/api` em 404, devolvendo a página HTML do Next em vez do
 * envelope (pendência 16). O status continua no `ErroDaApi` — é o que a tela de
 * entrada usa para distinguir 404 e 422 —, vai ao fim da frase como código e ao
 * console do navegador, para um 500 de verdade não ficar igual a Wi-Fi caído.
 */

const FRASE = 'Não foi possível falar com o sistema. Atualize a tela e tente de novo.'

function responder(corpo: string, status: number, tipo = 'application/json'): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(corpo, { status, headers: { 'content-type': tipo } })),
  )
}

async function falhaDe(chamada: Promise<unknown>): Promise<ErroDaApi> {
  const erro = await chamada.then(
    () => null,
    (causa: unknown) => causa,
  )
  expect(erro).toBeInstanceOf(ErroDaApi)
  return erro as ErroDaApi
}

let registro: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  registro = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('resposta sem erro legível', () => {
  it('página HTML de 404 no lugar do envelope: frase de gente, status guardado', async () => {
    responder('<!DOCTYPE html><html><body>404</body></html>', 404, 'text/html')

    const erro = await falhaDe(api.buscar('/painel'))

    expect(erro.message).toBe(FRASE)
    expect(erro.status).toBe(404)
    // O código é o único número que a pessoa pode repassar: não há `ref.`.
    expect(mensagemDoErro(erro)).toBe(`${FRASE} (código 404)`)
    expect(registro).toHaveBeenCalledWith(
      'Resposta do sistema sem erro legível',
      expect.objectContaining({ caminho: '/painel', status: 404, tipo: 'text/html' }),
    )
  })

  it('500 sem corpo', async () => {
    responder('', 500)

    const erro = await falhaDe(api.enviar('/distribuicao', {}))

    expect(erro.message).toBe(FRASE)
    expect(erro.status).toBe(500)
    expect(mensagemDoErro(erro)).toBe(`${FRASE} (código 500)`)
  })

  it.each([
    ['vazio', ''],
    ['só espaços', '   '],
    ['objeto', { codigo: 'x' }],
    ['ausente', null],
  ])('envelope com erro %s não vira tarja vazia nem [object Object]', async (_nome, erroDoEnvelope) => {
    responder(JSON.stringify({ sucesso: false, dados: null, erro: erroDoEnvelope }), 502)

    const erro = await falhaDe(api.buscar('/caixa'))

    expect(erro.message).toBe(FRASE)
  })

  it('rede fora do ar: nada de "Failed to fetch" em inglês na tela', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    const sinais: boolean[] = []
    const cancelar = observarAtividade((ocupado) => sinais.push(ocupado))

    const erro = await falhaDe(api.buscar('/fila'))
    cancelar()

    expect(erro.message).toBe(FRASE)
    expect(erro.status).toBe(0)
    expect(mensagemDoErro(erro)).toBe(FRASE)
    // O motivo real não some com a frase genérica: pode ser defeito de código
    // (cabeçalho inválido, URL malformada), que também rejeita com TypeError.
    expect(erro.cause).toBeInstanceOf(TypeError)
    expect(registro).toHaveBeenCalledWith('Sem resposta do sistema', expect.objectContaining({ caminho: '/fila' }))
    // A marca para de respirar: a requisição que falhou não fica "em voo".
    expect(sinais.at(-1)).toBe(false)
  })
})

describe('resposta com erro legível segue igual', () => {
  it('a frase do servidor chega à tela, com a referência', async () => {
    responder(
      JSON.stringify({
        sucesso: false,
        dados: null,
        erro: 'Este item já foi concluído.',
        correlacaoId: 'abcdef0123456789',
      }),
      422,
    )

    const erro = await falhaDe(api.enviar('/fila/concluir', {}))

    expect(erro.message).toBe('Este item já foi concluído.')
    expect(erro.status).toBe(422)
    expect(mensagemDoErro(erro)).toBe('Este item já foi concluído. (ref. abcdef01)')
    expect(registro).not.toHaveBeenCalled()
  })

  it('sem frase mas com referência: a referência vence o código', async () => {
    responder(JSON.stringify({ sucesso: false, dados: null, erro: null, correlacaoId: '0123456789abcdef' }), 500)

    const erro = await falhaDe(api.buscar('/painel'))

    // O `ref.` leva direto à linha do log do servidor; o código seria menos.
    expect(mensagemDoErro(erro)).toBe(`${FRASE} (ref. 01234567)`)
  })

  it('sucesso devolve os dados', async () => {
    responder(JSON.stringify({ sucesso: true, dados: { total: 3 }, erro: null }), 200)

    await expect(api.buscar<{ total: number }>('/painel')).resolves.toEqual({ total: 3 })
  })
})
