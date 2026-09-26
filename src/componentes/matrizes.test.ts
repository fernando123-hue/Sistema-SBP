import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Aviso, Botao, Selo } from './matrizes'

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

function avisoRenderizado(tom?: 'alerta' | 'atencao' | 'ok' | 'neutro'): { role: string; classes: string[] } {
  const html = renderToStaticMarkup(
    createElement(Aviso, tom === undefined ? { children: 'texto' } : { tom, children: 'texto' }),
  )
  const role = /role="([^"]*)"/.exec(html)?.[1]
  const classes = /class="([^"]*)"/.exec(html)?.[1]
  if (role === undefined || classes === undefined) throw new Error(`aviso sem role ou classe: ${html}`)
  return { role, classes: classes.split(' ') }
}

describe('Aviso — o que o leitor de tela anuncia (N-32)', () => {
  // `role="alert"` interrompe a leitura e anuncia na hora. Usado em todo tom,
  // cada item suspeito da Revisão virava um alerta urgente ao carregar.
  it('só o tom de alerta (o padrão, usado nos erros) é "alert"', () => {
    expect(avisoRenderizado().role).toBe('alert')
    expect(avisoRenderizado('alerta').role).toBe('alert')
  })

  it('atenção, sucesso e neutro são "status" — anunciados sem interromper', () => {
    expect(avisoRenderizado('atencao').role).toBe('status')
    expect(avisoRenderizado('ok').role).toBe('status')
    expect(avisoRenderizado('neutro').role).toBe('status')
  })

  it('o tom neutro não usa a cor de sucesso', () => {
    expect(avisoRenderizado('neutro').classes.some((classe) => classe.includes('ok'))).toBe(false)
  })
})

describe('Selo — explicação fora do mouse (pendência 2)', () => {
  // `title` só aparece passando o mouse: não chega a teclado nem a leitor de
  // tela. A explicação tem de estar no texto que o leitor lê.
  it('a explicação do selo chega ao leitor de tela, não só ao `title`', () => {
    const html = renderToStaticMarkup(
      createElement(Selo, { titulo: 'Registrado à mão: nenhum modelo classificou este item.', children: 'manual' }),
    )
    const semAtributos = html.replace(/<[^>]*>/g, ' ')

    expect(semAtributos).toContain('Registrado à mão: nenhum modelo classificou este item.')
    expect(html).toContain('sr-only')
  })

  it('selo sem explicação continua só com o rótulo', () => {
    const html = renderToStaticMarkup(createElement(Selo, { children: 'Cadastro' }))

    expect(html).not.toContain('sr-only')
    expect(html).not.toContain('title=')
  })
})
