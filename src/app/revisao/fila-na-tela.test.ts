import { describe, expect, it } from 'vitest'

import { depoisDeResolver, estadoDaFila } from './fila-na-tela'

/**
 * A fila de revisão na tela, depois de cada decisão (achado N-30).
 *
 * A rota devolve até 200 revisões e o total real. A tela tirava da lista a
 * que foi resolvida e nunca mexia no total: o cabeçalho seguia com o número
 * antigo e, quando as 200 acabavam, "Nada aguardando decisão humana" aparecia
 * com revisões ainda pendentes além do corte.
 */

const item = (revisaoId: string) => ({ revisaoId })

describe('depoisDeResolver', () => {
  it('tira a revisão da lista e desconta do total', () => {
    const depois = depoisDeResolver([item('a'), item('b')], 5, 'a')
    expect(depois.itens).toEqual([item('b')])
    expect(depois.total).toBe(4)
    expect(depois.recarregar).toBe(false)
  })

  it('lista local zerada com pendentes além do corte pede a próxima leva', () => {
    const depois = depoisDeResolver([item('a')], 201, 'a')
    expect(depois.itens).toEqual([])
    expect(depois.total).toBe(200)
    expect(depois.recarregar).toBe(true)
  })

  it('última revisão de verdade: não recarrega', () => {
    const depois = depoisDeResolver([item('a')], 1, 'a')
    expect(depois).toEqual({ itens: [], total: 0, recarregar: false })
  })

  it('revisão que não está na lista não mexe em nada', () => {
    const depois = depoisDeResolver([item('a')], 3, 'x')
    expect(depois).toEqual({ itens: [item('a')], total: 3, recarregar: false })
  })
})

describe('estadoDaFila', () => {
  it('sem resposta ainda: carregando', () => {
    expect(estadoDaFila(null, 0)).toBe('carregando')
  })

  it('lista vazia com total maior que zero NÃO é fila vazia', () => {
    expect(estadoDaFila([], 200)).toBe('carregando')
  })

  it('lista vazia e total zero: vazia', () => {
    expect(estadoDaFila([], 0)).toBe('vazia')
  })

  it('com itens: lista', () => {
    expect(estadoDaFila([item('a')], 1)).toBe('lista')
  })
})
