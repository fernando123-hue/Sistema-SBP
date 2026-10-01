import { describe, expect, it } from 'vitest'

import { avisoDaRevisao } from './aviso-da-revisao'

describe('avisoDaRevisao (`A69`, 4A)', () => {
  it('nada a dizer com zero ou com a contagem que falhou', () => {
    expect(avisoDaRevisao(0, 0)).toBeNull()
    expect(avisoDaRevisao(null, 3)).toBeNull()
  })

  it('singular e plural', () => {
    expect(avisoDaRevisao(1, 0)?.titulo).toBe('1 item espera conferência na Revisão')
    expect(avisoDaRevisao(15, 9)).toEqual({
      titulo: '15 itens esperam conferência na Revisão',
      complemento: ' (9 desta busca)',
    })
  })

  it('busca que não trouxe nada novo não fala "desta busca"', () => {
    expect(avisoDaRevisao(4, 0)?.complemento).toBe('')
  })

  // Aprovaram itens enquanto a busca rodava: a parte não pode passar do todo.
  it('não mostra a parte maior que o todo', () => {
    expect(avisoDaRevisao(1, 3)?.complemento).toBe('')
  })
})
