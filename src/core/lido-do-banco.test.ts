import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'

import { FrenteSchema } from './esquemas'
import { lerDoBanco } from './lido-do-banco'

/**
 * `lerDoBanco` — valor de domínio fechado vindo de coluna `String`.
 *
 * A distinção que importa é o TIPO do erro. `ZodError` vira `400` em `rota()` e
 * leva a mensagem para a tela, como se o pedido estivesse errado; defeito de
 * dado no banco tem de cair no ramo dos 500, com correlação e registro.
 */
describe('lerDoBanco', () => {
  it('devolve o valor quando ele está na lista', () => {
    expect(lerDoBanco(FrenteSchema, 'CADASTRO', 'Categoria.frente')).toBe('CADASTRO')
  })

  it('recusa valor fora da lista com Error comum, dizendo onde e o quê', () => {
    let capturado: unknown
    try {
      lerDoBanco(FrenteSchema, 'CADASTROS', 'Categoria.frente (DOC_CADASTRO)')
    } catch (erro) {
      capturado = erro
    }

    expect(capturado).toBeInstanceOf(Error)
    // No zod 4, `ZodError` não é `instanceof Error` — então esta linha distingue
    // de verdade um erro do outro.
    expect(capturado).not.toBeInstanceOf(ZodError)
    expect((capturado as Error).message).toContain('Categoria.frente (DOC_CADASTRO)')
    expect((capturado as Error).message).toContain('"CADASTROS"')
  })
})
