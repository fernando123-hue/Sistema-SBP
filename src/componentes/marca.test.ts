import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ALTURA_DA_ARTE, BlocoDaMarca, LARGURA_DA_ARTE, P_NA_ARTE } from './marca'

const ARTE = readFileSync(join(process.cwd(), 'public', 'marca-sbp.png'))

/**
 * Decodifica o PNG da arte (RGBA de 8 bits, sem entrelaçamento) e diz, pixel a
 * pixel, onde há tinta — o que não é o azul escuro do fundo. Só o suficiente
 * para este arquivo; sem dependência nova.
 */
function mapaDeTinta(png: Buffer): { largura: number; altura: number; tinta: (x: number, y: number) => boolean } {
  const largura = png.readUInt32BE(16)
  const altura = png.readUInt32BE(20)
  if (png[24] !== 8 || png[25] !== 6 || png[28] !== 0) throw new Error('a arte deixou de ser RGBA 8 bits sem entrelaçamento')
  const partes: Buffer[] = []
  for (let i = 8; i < png.length; ) {
    const tamanho = png.readUInt32BE(i)
    if (png.toString('ascii', i + 4, i + 8) === 'IDAT') partes.push(png.subarray(i + 8, i + 8 + tamanho))
    i += 12 + tamanho
  }
  const cru = inflateSync(Buffer.concat(partes))
  const linha = largura * 4
  const px = Buffer.alloc(linha * altura)
  for (let y = 0; y < altura; y += 1) {
    const filtro = cru[y * (linha + 1)]!
    for (let x = 0; x < linha; x += 1) {
      const bruto = cru[y * (linha + 1) + 1 + x]!
      const a = x >= 4 ? px[y * linha + x - 4]! : 0
      const b = y > 0 ? px[(y - 1) * linha + x]! : 0
      const c = x >= 4 && y > 0 ? px[(y - 1) * linha + x - 4]! : 0
      const paeth = () => {
        const p = a + b - c
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)]
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      const previsto = [0, a, b, (a + b) >> 1, paeth()][filtro]
      if (previsto === undefined) throw new Error(`filtro PNG desconhecido: ${filtro}`)
      px[y * linha + x] = (bruto + previsto) & 0xff
    }
  }
  return {
    largura,
    altura,
    tinta: (x, y) => {
      const i = y * linha + x * 4
      return px[i]! + px[i + 1]! + px[i + 2]! > 180
    },
  }
}

/**
 * O logotipo é a arte oficial (`A66`). O que o olho não confere: que o
 * arquivo é o que o código supõe, e que o nome da SBP chega ao leitor de tela.
 */

describe('logotipo', () => {
  it('o arquivo existe e tem o tamanho que o recorte do P supõe (136 × 163)', () => {
    // Trocar a arte por outra de tamanho diferente sem ajustar `marca.tsx`
    // deslocaria o recorte da forma reduzida — pedaços do nome apareceriam
    // ao lado do P.
    expect(ARTE.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(ARTE.readUInt32BE(16)).toBe(LARGURA_DA_ARTE)
    expect(ARTE.readUInt32BE(20)).toBe(ALTURA_DA_ARTE)
  })

  it('o recorte da forma reduzida pega o P inteiro, e só o P', () => {
    // As constantes foram medidas à mão, e a primeira medida comia duas
    // colunas da letra (revisão técnica do #152). Aqui elas são conferidas
    // contra os pixels da arte.
    const { tinta } = mapaDeTinta(ARTE)
    const p = P_NA_ARTE

    // O bojo: a caixa é justa — tinta encostando em cada lado, nada fora.
    let [minX, maxX, minY] = [Infinity, -Infinity, Infinity]
    for (let y = 0; y < p.fimDoBojo; y += 1) {
      for (let x = 0; x < LARGURA_DA_ARTE; x += 1) {
        if (!tinta(x, y)) continue
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
      }
    }
    expect({ esquerda: minX, direita: maxX + 1, topo: minY }).toEqual({
      esquerda: p.esquerda,
      direita: p.direita,
      topo: p.topo,
    })

    // A haste: o corte à direita dela cai no vão entre a haste e o nome — as
    // duas colunas em volta do corte são fundo — e nada fica à esquerda do P.
    for (let y = p.fimDoBojo; y < p.pe; y += 1) {
      expect(tinta(p.direitaDaHaste - 1, y), `linha ${y}`).toBe(false)
      expect(tinta(p.direitaDaHaste, y), `linha ${y}`).toBe(false)
      for (let x = 0; x < p.esquerda; x += 1) expect(tinta(x, y), `(${x}, ${y})`).toBe(false)
    }
    for (let x = p.esquerda; x < p.direitaDaHaste; x += 1) {
      // O pé cai no vão antes de "de pediatria".
      expect(tinta(x, p.pe), `pé em (${x}, ${p.pe})`).toBe(false)
    }
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
