import { describe, expect, it } from 'vitest'

import { nonceDoCabecalho, problemasDoNonce, recusaDoAmbiente } from './nonce-na-pagina'

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

  it('data-nonce não é o atributo nonce: o navegador bloquearia (revisões do #214, M3/S2)', () => {
    expect(problemasDoNonce(CSP, '<script data-nonce="QUJDMTIz" src="/a.js"></script>')).toEqual([
      expect.stringMatching(/1 de 1 script/),
    ])
  })

  it('nonce escrito DENTRO do valor de outro atributo também não', () => {
    const html = `<script title="x nonce='QUJDMTIz'" src="/a.js"></script>`

    expect(problemasDoNonce(CSP, html)).toEqual([expect.stringMatching(/1 de 1 script/)])
  })

  it('> dentro de um valor entre aspas não corta a abertura do script', () => {
    const html = '<script data-x="a>b" nonce="QUJDMTIz" src="/a.js"></script>'

    expect(problemasDoNonce(CSP, html)).toEqual([])
  })
})

describe('nonce do cabeçalho', () => {
  it('extrai o valor, ou null', () => {
    expect(nonceDoCabecalho(CSP)).toBe('QUJDMTIz')
    expect(nonceDoCabecalho("script-src 'self'")).toBeNull()
    expect(nonceDoCabecalho(null)).toBeNull()
  })
})

describe('onde a conferência aceita rodar (revisão técnica do #214, M2)', () => {
  // `next start` roda a limpeza diária na partida. Contra a base real, ela
  // apagaria anexos; a conferência só roda contra base de teste e pasta dada.
  const TESTE = { DATABASE_URL: 'mysql://root@127.0.0.1:3306/sbp_teste', ARMAZENAMENTO_DIR: '/tmp/anexos' }

  it('base _teste e pasta de anexos explícita: roda', () => {
    expect(recusaDoAmbiente(TESTE)).toBeNull()
  })

  it('base que não termina em _teste: recusa', () => {
    expect(recusaDoAmbiente({ ...TESTE, DATABASE_URL: 'mysql://root@127.0.0.1:3307/sbp' })).toMatch(/_teste/)
  })

  it('sem DATABASE_URL no ambiente (viria do .env): recusa', () => {
    expect(recusaDoAmbiente({ ARMAZENAMENTO_DIR: '/tmp/anexos' })).toMatch(/DATABASE_URL/)
  })

  it('sem ARMAZENAMENTO_DIR no ambiente (viria do .env): recusa', () => {
    expect(recusaDoAmbiente({ DATABASE_URL: TESTE.DATABASE_URL })).toMatch(/ARMAZENAMENTO_DIR/)
  })

  it('URL inválida: recusa', () => {
    expect(recusaDoAmbiente({ ...TESTE, DATABASE_URL: 'nao e url' })).toMatch(/DATABASE_URL/)
  })
})
