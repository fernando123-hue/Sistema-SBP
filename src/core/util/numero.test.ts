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

  // No empate exato, meio último dígito vai para longe do zero — igual ao
  // `Intl`, com quem o limiar do resíduo tem de concordar.
  it('empate no limiar do resíduo', () => {
    expect(decimal(0.005)).toBe('0,01')
    expect(decimal(-0.005)).toBe('-0,01')
    expect(decimal(-0.0049999)).toBe('0,00')
  })

  it('o antigo "+0.00" do Painel sai sem sinal', () => {
    expect(decimal(-0, { sinal: true })).toBe('0,00')
    expect(decimal(0.004, { sinal: true })).toBe('0,00')
  })

  it('negativo com milhar', () => {
    expect(decimal(-1234.5)).toBe('-1.234,50')
  })

  it('outra quantidade de casas, com limiar exato em qualquer uma', () => {
    expect(decimal(0.87, { casas: 1 })).toBe('0,9')
    expect(decimal(-0.00004999, { casas: 4 })).toBe('0,0000')
  })

  // Frase corrida (narrativa da rodada): "A média era 52", não "52,00".
  it('enxuto: sem zeros à direita, e o resíduo também sai zero', () => {
    expect(decimal(52, { enxuto: true })).toBe('52')
    expect(decimal(3.5, { enxuto: true })).toBe('3,5')
    expect(decimal(-1e-16, { enxuto: true })).toBe('0')
  })
})
