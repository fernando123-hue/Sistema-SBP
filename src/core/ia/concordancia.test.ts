import { describe, expect, it } from 'vitest'

import { concordanciaDeCategoria } from './concordancia'

describe('concordância da segunda opinião', () => {
  it('um item, ou vários da mesma categoria, compara direto', () => {
    expect(concordanciaDeCategoria(['LIGANTE'], 'LIGANTE')).toBe('concorda')
    expect(concordanciaDeCategoria(['LIGANTE', 'LIGANTE', 'LIGANTE'], 'LIGANTE')).toBe('concorda')
    expect(concordanciaDeCategoria(['LIGANTE'], 'LIGA')).toBe('discorda')
  })

  // Forçar estes dois para "concorda" ou "discorda" poria número falso na medição.
  it('sem item, ou com itens de categorias diferentes, não há o que comparar', () => {
    expect(concordanciaDeCategoria([], 'EMAIL_CADASTRO')).toBe('sem_itens')
    expect(concordanciaDeCategoria(['LIGA', 'LIGANTE'], 'LIGA')).toBe('itens_de_categorias_diferentes')
  })
})
