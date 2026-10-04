import { describe, expect, it } from 'vitest'

import { problemasDoNonce } from './nonce-na-pagina'

/**
 * Pendência 46: o nonce da CSP chega a cada `<script>` da página servida por
 * `next start`? A função confere o que o passo do CI busca; aqui, com HTML
 * escrito à mão, os casos que ela precisa pegar.
 */

const CSP = "default-src 'self'; script-src 'self' 'nonce-QUJDMTIz' 'strict-dynamic'; object-src 'none'"

describe('nonce da CSP nos scripts', () => {
  it('todo script com o nonce do cabeçalho: nenhum problema', () => {
    const html = '<script nonce="QUJDMTIz" src="/_next/a.js"></script><script nonce="QUJDMTIz">self.x=1</script>'

    expect(problemasDoNonce(CSP, html)).toEqual([])
  })

  it('script sem nonce é problema: é o que o navegador bloqueia e a tela quebra', () => {
    const html = '<script nonce="QUJDMTIz" src="/_next/a.js"></script><script src="/_next/b.js"></script>'

    expect(problemasDoNonce(CSP, html)).toEqual([expect.stringMatching(/1 de 2 script/)])
  })

  it('nonce diferente do cabeçalho também', () => {
    const html = '<script nonce="OUTRO" src="/_next/a.js"></script>'

    expect(problemasDoNonce(CSP, html)).toEqual([expect.stringMatching(/1 de 1 script/)])
  })

  it('página sem script nenhum não prova nada, e é problema', () => {
    expect(problemasDoNonce(CSP, '<html><body>vazio</body></html>')).toEqual([
      expect.stringMatching(/nenhum <script>/),
    ])
  })

  it('cabeçalho sem nonce é problema, mesmo que os scripts tenham um', () => {
    expect(problemasDoNonce("script-src 'self'", '<script nonce="QUJDMTIz"></script>')).toEqual([
      expect.stringMatching(/cabeçalho/),
    ])
  })

  it('cabeçalho ausente é problema', () => {
    expect(problemasDoNonce(null, '<script nonce="QUJDMTIz"></script>')).toEqual([
      expect.stringMatching(/cabeçalho/),
    ])
  })

  it('aspas simples e atributos em qualquer ordem contam como o mesmo nonce', () => {
    const html = "<script async src='/_next/a.js' nonce='QUJDMTIz'></script><SCRIPT id=\"x\" nonce=\"QUJDMTIz\"></SCRIPT>"

    expect(problemasDoNonce(CSP, html)).toEqual([])
  })
})
