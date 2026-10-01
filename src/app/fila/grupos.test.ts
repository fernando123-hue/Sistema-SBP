import { describe, expect, it } from 'vitest'

import { agruparPorEmail, amostraDosTitulos } from './grupos'

/** Itens sintéticos, só com o que o agrupamento olha. */
function item(itemId: string, emailId: string | null, titulo = `Item ${itemId}`) {
  return { itemId, emailId, titulo }
}

describe('agruparPorEmail (`A69`, 3A)', () => {
  it('junta os itens do mesmo e-mail, na posição do mais antigo', () => {
    const grupos = agruparPorEmail([
      item('a', 'e1'),
      item('b', 'e2'),
      item('c', 'e1'),
      item('d', 'e1'),
    ])

    expect(grupos.map((grupo) => grupo.itens.map((linha) => linha.itemId))).toEqual([
      ['a', 'c', 'd'],
      ['b'],
    ])
    expect(grupos[0]!.emailId).toBe('e1')
  })

  // Item registrado à mão não tem e-mail: juntar todos os "sem e-mail" num
  // grupo faria "Concluir os N" concluir coisas sem relação nenhuma.
  it('item sem e-mail fica sozinho, cada um no seu grupo', () => {
    const grupos = agruparPorEmail([item('a', null), item('b', null)])

    expect(grupos).toHaveLength(2)
    expect(grupos.every((grupo) => grupo.emailId === null && grupo.itens.length === 1)).toBe(true)
    expect(new Set(grupos.map((grupo) => grupo.chave)).size).toBe(2)
  })

  it('chaves distintas entre um e-mail e um item com o mesmo id', () => {
    const grupos = agruparPorEmail([item('x', 'x'), item('y', null)])
    expect(new Set(grupos.map((grupo) => grupo.chave)).size).toBe(2)
  })

  it('lista vazia não tem grupo', () => {
    expect(agruparPorEmail([])).toEqual([])
  })
})

describe('amostraDosTitulos', () => {
  it('mostra os três primeiros e conta o resto', () => {
    expect(amostraDosTitulos(['A', 'B', 'C', 'D', 'E'])).toEqual({ nomes: ['A', 'B', 'C'], resto: 2 })
  })

  it('poucos títulos aparecem todos', () => {
    expect(amostraDosTitulos(['A', 'B'])).toEqual({ nomes: ['A', 'B'], resto: 0 })
  })
})
