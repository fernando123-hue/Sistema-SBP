import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { PAPEIS_DA_TELA, telaInicial } from '../core/telas'
import { PapelSchema } from '../core/esquemas'

vi.mock('next/navigation', () => ({
  usePathname: () => '/painel',
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}))

const { Navegacao } = await import('./navegacao')

/** O `href` do primeiro link da barra — o logotipo. */
function destinoDoLogotipo(papel: string): string {
  const html = renderToStaticMarkup(createElement(Navegacao, { nome: 'Pessoa Sintética', papel }))
  const href = /<a[^>]*href="([^"]*)"/.exec(html)?.[1]
  if (href === undefined) throw new Error(`navegação sem link: ${html}`)
  return href
}

describe('tela inicial por papel (achado N-31)', () => {
  // O logotipo apontava para /distribuicao para todo mundo: o colaborador caía
  // numa tela que não é dele, com botões que parecem funcionar e voltam 403.
  it('o logotipo leva o colaborador à própria fila', () => {
    expect(destinoDoLogotipo('colaborador')).toBe('/fila')
  })

  it('o logotipo leva quem distribui à Distribuição', () => {
    expect(destinoDoLogotipo('operador')).toBe('/distribuicao')
    expect(destinoDoLogotipo('gestor')).toBe('/distribuicao')
  })

  it('a tela inicial de todo papel é uma tela que ele alcança', () => {
    for (const papel of PapelSchema.options) {
      expect(PAPEIS_DA_TELA[telaInicial(papel)]).toContain(papel)
    }
  })
})
