import { afterEach, describe, expect, it, vi } from 'vitest'

import { corpoJsonOpcional } from './http'

/**
 * `corpoJsonOpcional` — o corpo de `DELETE /api/notas/:id`.
 *
 * Achado 21 da auditoria de 08/09/2026: a rota usava `corpoJson`, e todo
 * arquivamento sem motivo — o caso comum — gravava "corpo da requisição não é
 * JSON válido". Um aviso por operação legítima ensina a ignorar o aviso.
 */

const AVISO = 'corpo da requisição não é JSON válido'

function capturarSaida(): string[] {
  const saida: string[] = []
  const capturar = (pedaco: unknown) => {
    saida.push(String(pedaco))
    return true
  }
  vi.spyOn(process.stdout, 'write').mockImplementation(capturar)
  vi.spyOn(process.stderr, 'write').mockImplementation(capturar)
  return saida
}

function remocao(corpo?: string): Request {
  return new Request('http://localhost/api/notas/nota-sintetica', {
    method: 'DELETE',
    ...(corpo === undefined ? {} : { body: corpo }),
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('corpoJsonOpcional', () => {
  it.each([
    ['sem corpo', undefined],
    ['corpo só com espaço', '  \n'],
  ] as const)('%s vira {} sem aviso nenhum', async (_, corpo) => {
    const saida = capturarSaida()

    expect(await corpoJsonOpcional(remocao(corpo))).toEqual({})
    expect(saida.join('')).not.toContain(AVISO)
  })

  it('corpo JSON válido chega inteiro', async () => {
    expect(await corpoJsonOpcional(remocao('{"motivo":"A regra mudou em setembro."}'))).toEqual({
      motivo: 'A regra mudou em setembro.',
    })
  })

  it('corpo PRESENTE e quebrado continua registrado — e vira {}', async () => {
    const saida = capturarSaida()

    expect(await corpoJsonOpcional(remocao('{"motivo": '))).toEqual({})
    expect(saida.join('')).toContain(AVISO)
  })
})
