import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Anuncio, Aviso, Botao } from './matrizes'

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

describe('Anuncio — o que muda sem mover o foco chega ao leitor de tela (pendência 5)', () => {
  // "Concluir" vira "Confirmar: concluir" no MESMO botão, com o foco nele. Boa
  // parte dos leitores não repete o nome que mudou: quem não enxerga clicava
  // uma vez, não ouvia nada e ficava sem saber que faltava o segundo clique.
  it('fica na página vazio, antes de haver o que dizer', () => {
    const html = renderToStaticMarkup(createElement(Anuncio, { mensagem: null }))

    // A região precisa existir ANTES do texto: leitor de tela não anuncia
    // região viva que nasce já com conteúdo.
    expect(html).toMatch(/aria-live="polite"/)
    expect(html).toContain('sr-only')
    expect(html.replace(/<[^>]*>/g, '')).toBe('')
  })

  it('diz o que fazer quando há mensagem, sem interromper', () => {
    const html = renderToStaticMarkup(
      createElement(Anuncio, { mensagem: 'Para concluir, clique de novo. Concluir não tem volta.' }),
    )

    expect(html).toMatch(/aria-live="polite"/)
    expect(html).not.toMatch(/role="alert"|aria-live="assertive"/)
    expect(html).toContain('Para concluir, clique de novo. Concluir não tem volta.')
  })
})
