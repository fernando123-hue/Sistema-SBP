import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { BlocoDaMarca } from './marca'

/**
 * O logotipo é a arte oficial (`A66`). O que o olho não confere: que o
 * arquivo é o que o código supõe, e que o nome da SBP chega ao leitor de tela.
 */

describe('logotipo', () => {
  it('o arquivo existe e tem o tamanho que o recorte do P supõe (136 × 163)', () => {
    // Trocar a arte por outra de tamanho diferente sem ajustar `marca.tsx`
    // deslocaria o recorte da forma reduzida — pedaços do nome apareceriam
    // ao lado do P.
    const png = readFileSync(join(process.cwd(), 'public', 'marca-sbp.png'))
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(136)
    expect(png.readUInt32BE(20)).toBe(163)
  })

  it('a forma completa é a arte, e o nome da SBP está no alt', () => {
    const html = renderToStaticMarkup(createElement(BlocoDaMarca, { altura: 163, comNome: true }))
    expect(html).toContain('src="/marca-sbp.png"')
    expect(html).toContain('alt="Sociedade Brasileira de Pediatria"')
    expect(html).toContain('width="136"')
  })

  it('a forma reduzida é decoração — o nome vem do texto do link', () => {
    const html = renderToStaticMarkup(createElement(BlocoDaMarca, { altura: 48 }))
    expect(html).toContain('alt=""')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('clip-path:polygon(')
  })

  it('ocupado aparece como faixa, e não some com "reduzir movimento"', () => {
    const livre = renderToStaticMarkup(createElement(BlocoDaMarca, { altura: 48 }))
    const ocupado = renderToStaticMarkup(createElement(BlocoDaMarca, { altura: 48, ocupado: true }))
    expect(livre).not.toContain('animate-pulse')
    expect(ocupado).toContain('animate-pulse')
    // Parada, mas visível: só a animação sai.
    expect(ocupado).toContain('motion-reduce:animate-none')
    expect(ocupado).not.toContain('motion-reduce:hidden')
  })
})
