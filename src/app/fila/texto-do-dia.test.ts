import { describe, expect, it } from 'vitest'

import { textoDoDia } from './texto-do-dia'

describe('textoDoDia', () => {
  it('singular e plural', () => {
    expect(textoDoDia(1)).toBe('Hoje você concluiu 1 item.')
    expect(textoDoDia(12)).toBe('Hoje você concluiu 12 itens.')
  })

  it('com zero ou com a contagem que falhou, nenhuma frase', () => {
    expect(textoDoDia(0)).toBeNull()
    expect(textoDoDia(null)).toBeNull()
  })
})
