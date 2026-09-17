import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import { middleware } from '../middleware'
import { pedidoDeOutraOrigem } from './mesma-origem'

/**
 * Achados C-13 e C-17 (`docs/auditoria/2026-09-17-achados-da-auditoria-por-agentes.md`).
 *
 * Nenhuma rota que altera estado conferia a origem; a defesa era só o cookie
 * `SameSite=Lax`. Lax barra outro SITE, não outra ORIGEM do mesmo site (outra
 * porta, outro subdomínio): de lá, um formulário agia como a gestora logada.
 * E o CSRF de login (outro site deixa o navegador da vítima logado na conta do
 * atacante) não era barrado por nada.
 */

function pedido(metodo: string, cabecalhos: Record<string, string>, caminho = '/api/colaboradores/ativacao') {
  return new Request(`http://localhost:3000${caminho}`, {
    method: metodo,
    headers: { host: 'localhost:3000', ...cabecalhos },
  })
}

describe('pedidoDeOutraOrigem', () => {
  it.each(['cross-site', 'same-site', 'none'])('POST com Sec-Fetch-Site=%s é de outra origem', (valor) => {
    expect(pedidoDeOutraOrigem(pedido('POST', { 'sec-fetch-site': valor }))).toBe(true)
  })

  it('POST da própria tela passa', () => {
    expect(pedidoDeOutraOrigem(pedido('POST', { 'sec-fetch-site': 'same-origin' }))).toBe(false)
  })

  it('sem Sec-Fetch-Site, decide pelo Origin', () => {
    expect(pedidoDeOutraOrigem(pedido('POST', { origin: 'http://localhost:3001' }))).toBe(true)
    expect(pedidoDeOutraOrigem(pedido('POST', { origin: 'http://outro.exemplo.test' }))).toBe(true)
    expect(pedidoDeOutraOrigem(pedido('POST', { origin: 'null' }))).toBe(true)
    expect(pedidoDeOutraOrigem(pedido('POST', { origin: 'http://localhost:3000' }))).toBe(false)
  })

  it('sem nenhum dos dois não é navegador — CSRF exige navegador', () => {
    expect(pedidoDeOutraOrigem(pedido('POST', {}))).toBe(false)
  })

  it.each(['GET', 'HEAD', 'OPTIONS'])('%s não altera estado e não é conferido', (metodo) => {
    expect(pedidoDeOutraOrigem(pedido(metodo, { 'sec-fetch-site': 'cross-site' }))).toBe(false)
  })

  it.each(['PUT', 'PATCH', 'DELETE'])('%s de outra origem é recusado', (metodo) => {
    expect(pedidoDeOutraOrigem(pedido(metodo, { 'sec-fetch-site': 'cross-site' }))).toBe(true)
  })
})

describe('o middleware recusa antes de chegar à rota', () => {
  it('POST de outra origem numa rota de API recebe 403', async () => {
    const resposta = middleware(
      new NextRequest('http://localhost:3000/api/sessao', {
        method: 'POST',
        headers: { host: 'localhost:3000', 'sec-fetch-site': 'same-site', 'content-type': 'text/plain' },
        body: '{"email":"x@exemplo.test","senha":"y"}',
      }),
    )
    expect(resposta.status).toBe(403)
    expect(resposta.headers.get('set-cookie')).toBeNull()
    expect(await resposta.json()).toMatchObject({ sucesso: false })
  })

  it('POST da própria tela segue', () => {
    const resposta = middleware(
      new NextRequest('http://localhost:3000/api/sessao', {
        method: 'POST',
        headers: { host: 'localhost:3000', 'sec-fetch-site': 'same-origin' },
      }),
    )
    expect(resposta.status).toBe(200)
    expect(resposta.headers.get('content-security-policy')).toContain("default-src 'self'")
  })

  it('páginas (fora de /api) não são afetadas', () => {
    const resposta = middleware(
      new NextRequest('http://localhost:3000/entrar', { headers: { host: 'localhost:3000', 'sec-fetch-site': 'cross-site' } }),
    )
    expect(resposta.status).toBe(200)
  })
})
