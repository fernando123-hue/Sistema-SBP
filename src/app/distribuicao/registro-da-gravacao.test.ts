import { describe, expect, it } from 'vitest'

import { registroDaGravacao } from './registro-da-gravacao'

describe('registroDaGravacao (`A69`, 5B)', () => {
  it('diz a hora, quantos itens, que nada foi digitado e que a conservação fechou', () => {
    expect(registroDaGravacao(60, 3, '08:14')).toBe(
      'Gravada às 08:14 · 60 itens · nenhum número digitado · conservação conferida. ' +
        '3 rodadas registradas, cada uma auditável.',
    )
  })

  it('singular', () => {
    expect(registroDaGravacao(1, 1, '09:00')).toBe(
      'Gravada às 09:00 · 1 item · nenhum número digitado · conservação conferida. 1 rodada registrada, auditável.',
    )
  })

  it('sem rodada gravada, não afirma conservação de coisa nenhuma', () => {
    const linha = registroDaGravacao(0, 0, '10:30')
    expect(linha).toBe('Nada gravado às 10:30: não havia item a distribuir nesta data.')
    expect(linha).not.toContain('conservação')
  })
})
