import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Anuncio, Aviso, Botao, Selo, SeloDeConfianca } from './matrizes'

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

describe('SeloDeConfianca — o número nunca parece passar do mínimo sem passar', () => {
  function numero(valor: number, limiar: number): string {
    const html = renderToStaticMarkup(createElement(SeloDeConfianca, { valor, limiar }))
    return /class="numerico">(\d+)%/.exec(html)?.[1] ?? '?'
  }

  it('0,949 com mínimo de 95% aparece como 94%, não 95%', () => {
    expect(numero(0.949, 0.95)).toBe('94')
  })

  it('valores exatos não perdem um ponto no ponto flutuante', () => {
    expect(numero(0.29, 0.85)).toBe('29')
    expect(numero(0.57, 0.85)).toBe('57')
    expect(numero(0.95, 0.95)).toBe('95')
  })

  it('o mínimo sai em porcentagem, em português de gente', () => {
    const html = renderToStaticMarkup(createElement(SeloDeConfianca, { valor: 0.9, limiar: 0.85 }))

    expect(html).toContain('mínimo da categoria 85%')
    expect(html).not.toMatch(/limiar/)
  })
})
