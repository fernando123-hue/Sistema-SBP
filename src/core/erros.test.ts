import { describe, expect, it } from 'vitest'

import { ErroOperacional } from './erros'

/**
 * A regra de `ErroOperacional.statusHttp` é de COMPILAÇÃO — este arquivo a
 * prova com `@ts-expect-error`, que `npm run verificar` confere no `tsc`. Se
 * alguém alargar o tipo de volta para `number`, a diretiva deixa de ter erro
 * para esperar e o typecheck fica vermelho.
 *
 * Achado 18 da auditoria de 08/09/2026.
 */
describe('ErroOperacional.statusHttp', () => {
  it('aceita os dois status em que a mensagem pode atravessar para a tela', () => {
    class Indisponivel extends ErroOperacional {
      readonly codigo = 'TESTE_INDISPONIVEL'
      readonly statusHttp = 503
    }
    class NestaEntrada extends ErroOperacional {
      readonly codigo = 'TESTE_NESTA_ENTRADA'
      readonly statusHttp = 422
    }

    expect(new Indisponivel('fora do ar').statusHttp).toBe(503)
    expect(new NestaEntrada('não deu certo').statusHttp).toBe(422)
  })

  it('recusa, na compilação, uma falha operacional com status de falha de servidor', () => {
    class FalhaDeServidorDisfarcada extends ErroOperacional {
      readonly codigo = 'TESTE_DISFARCADA'
      // @ts-expect-error — 500 é falha do servidor: sobe como `Error` e cai no ramo genérico de `rota()`.
      readonly statusHttp = 500
    }

    // Em runtime a classe existe; a barreira é o compilador. O teste roda para
    // que a declaração acima seja de fato compilada junto com a suíte.
    expect(new FalhaDeServidorDisfarcada('x')).toBeInstanceOf(ErroOperacional)
  })
})
