import { describe, expect, it } from 'vitest'

import { rotuloDeAfastamento } from './afastamento-visivel'

/**
 * O que cada papel pode saber sobre a ausência de um colega.
 *
 * Decisão do dono do negócio em 06/09/2026, respondendo o que o `A10` deixou
 * aberto: a operação precisa saber **quem não vai receber trabalho hoje** — sem
 * isso a tela promete uma equipe que não existe. O que ela **não** precisa
 * saber é o motivo médico.
 *
 * Estes testes existem porque a regra é de PRIVACIDADE, e privacidade que
 * depende de alguém lembrar de esconder na tela não é privacidade: é sorte.
 */

describe('gestor vê o motivo — é a ficha', () => {
  it.each(['ferias', 'atestado', 'licenca', 'falta', 'outro'])('%s chega inteiro', (tipo) => {
    expect(rotuloDeAfastamento(tipo, 'gestor')).toBe(tipo)
  })
})

describe('quem não é gestor vê férias ou "indisponível"', () => {
  it.each(['operador', 'colaborador'] as const)('%s vê férias como férias', (papel) => {
    // Férias não é informação de saúde: é agenda. Esconder produziria a
    // pergunta "por que fulano está indisponível?", que é exatamente a
    // conversa que a redação existe para evitar.
    expect(rotuloDeAfastamento('ferias', papel)).toBe('ferias')
  })

  it.each(['atestado', 'licenca', 'falta', 'outro'])(
    '%s vira "indisponivel" para operador',
    (tipo) => {
      expect(rotuloDeAfastamento(tipo, 'operador')).toBe('indisponivel')
    },
  )

  it('TODOS os motivos sensíveis viram o MESMO rótulo', () => {
    // Se `atestado` virasse um rótulo próprio e os outros não, a ausência do
    // rótulo já denunciaria o motivo. A indistinguibilidade é a proteção.
    const rotulos = ['atestado', 'licenca', 'falta', 'outro'].map((tipo) =>
      rotuloDeAfastamento(tipo, 'colaborador'),
    )

    expect(new Set(rotulos).size).toBe(1)
  })

  it('nenhum papel comum recebe um motivo médico, nem por engano', () => {
    for (const papel of ['operador', 'colaborador'] as const) {
      for (const tipo of ['atestado', 'licenca', 'falta', 'outro']) {
        expect(rotuloDeAfastamento(tipo, papel)).not.toBe(tipo)
      }
    }
  })
})

describe('ausência de afastamento', () => {
  it.each(['gestor', 'operador', 'colaborador'] as const)('null continua null para %s', (papel) => {
    expect(rotuloDeAfastamento(null, papel)).toBeNull()
  })
})
