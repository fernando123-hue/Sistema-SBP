import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Botao } from './matrizes'

function classesDoBotao(tamanho: 'normal' | 'pequeno'): string[] {
  const html = renderToStaticMarkup(createElement(Botao, { tamanho, children: 'Concluir' }))
  const classes = /class="([^"]*)"/.exec(html)?.[1]
  if (classes === undefined) throw new Error(`botão sem classe: ${html}`)
  return classes.split(' ')
}

describe('Botao — alvo de toque no celular', () => {
  // O pequeno fica ao lado de outro pequeno ("Não é comigo" e "Concluir" na
  // Minha fila). Com 36 px no celular, mirar num e tocar no outro é fácil —
  // e "Concluir" não tem volta (N-04).
  it('pequeno tem 44 px no celular e só encolhe da largura sm para cima', () => {
    const classes = classesDoBotao('pequeno')

    expect(classes).toContain('min-h-11')
    expect(classes).toContain('sm:min-h-9')
    expect(classes).not.toContain('min-h-9')
  })

  it('normal continua com 44 px no celular', () => {
    expect(classesDoBotao('normal')).toContain('min-h-11')
  })
})
