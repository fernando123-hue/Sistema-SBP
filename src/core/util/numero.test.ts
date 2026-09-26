import { describe, expect, it } from 'vitest'

import { decimal } from './numero'

/**
 * Número na tela é em português: vírgula decimal (pendência 4).
 *
 * A Distribuição mostrava "média 52,00" ao lado de "crédito 0.00 → 1.00", e o
 * Painel "+1.50". Desde o #126 esses números também são lidos pelo leitor de
 * tela — "zero ponto zero zero".
 */
describe('decimal', () => {
  it('duas casas com vírgula', () => {
    expect(decimal(1.5)).toBe('1,50')
    expect(decimal(52)).toBe('52,00')
    expect(decimal(0.333333)).toBe('0,33')
  })

  it('milhar com ponto, como se escreve aqui', () => {
    expect(decimal(1234.5)).toBe('1.234,50')
  })

  it('com sinal: positivo ganha "+", zero fica sem sinal', () => {
    expect(decimal(1.5, { sinal: true })).toBe('+1,50')
    expect(decimal(-1.5, { sinal: true })).toBe('-1,50')
    expect(decimal(0, { sinal: true })).toBe('0,00')
  })

  // O crédito roda em float64 cheio (ver o topo de `numero.ts`): um resíduo de
  // -1e-12 é zero, e "-0,00" na tela parece dívida que não existe.
  it('resíduo de ponto flutuante não vira "-0,00"', () => {
    expect(decimal(-1e-12)).toBe('0,00')
    expect(decimal(-0.004)).toBe('0,00')
    expect(decimal(-1e-12, { sinal: true })).toBe('0,00')
  })

  it('outra quantidade de casas', () => {
    expect(decimal(0.85, { casas: 1 })).toBe('0,9')
  })
})
