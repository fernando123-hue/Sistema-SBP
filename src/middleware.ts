import { NextResponse, type NextRequest } from 'next/server'

import { pedidoDeOutraOrigem } from './servidor/mesma-origem'

/**
 * Política de segurança de conteúdo, com nonce por requisição.
 *
 * ═══ POR QUE SAIU DO `next.config.ts` ═══
 *
 * Lá os cabeçalhos são estáticos, e um nonce estático não é nonce. O que havia
 * era `script-src 'self' 'unsafe-inline'` — e `'unsafe-inline'` em `script-src`
 * anula justamente a rede de segurança que o comentário de lá promete: com ela
 * ligada, um `<img src=x onerror="...">` que chegasse ao DOM executa, e o
 * `httpOnly` do cookie não impede nada, porque o script age COMO a pessoa
 * logada — a requisição sai com o cookie anexado.
 *
 * Agora cada resposta carrega um nonce sorteado. O Next lê o cabeçalho
 * `Content-Security-Policy` da REQUISIÇÃO, encontra o nonce e o repassa para os
 * próprios scripts de hidratação; script sem nonce não roda.
 *
 * ═══ `strict-dynamic` E O QUE ELE MUDA ═══
 *
 * Com ele, um script já autorizado pode carregar outros — que é como o Next
 * monta os pedaços da página — e as listas de origem (`'self'`) passam a ser
 * IGNORADAS pelos navegadores que o entendem. Por isso `'self'` fica: é o que
 * os navegadores antigos leem, e para eles a política continua sendo a de antes.
 *
 * ═══ DESENVOLVIMENTO CONTINUA COM `unsafe-eval` ═══
 *
 * O Fast Refresh avalia código em tempo de execução. Sem `unsafe-eval` o HMR
 * cai e — o pior sintoma — formulários controlados param de reagir à digitação,
 * fazendo quem for conferir uma correção de tela ver uma tela quebrada por um
 * motivo que não é o dela. Em produção a diretriz sai, e o build não usa `eval`.
 */
export function middleware(requisicao: NextRequest): NextResponse {
  // Pedido de outra origem que altera estado não chega à rota (achados C-13 e
  // C-17) — inclusive o de entrada, que não tem sessão para conferir. Ver
  // `servidor/mesma-origem.ts`. Mesmo formato de erro das rotas.
  if (requisicao.nextUrl.pathname.startsWith('/api/') && pedidoDeOutraOrigem(requisicao)) {
    return NextResponse.json(
      { sucesso: false, dados: null, erro: 'Pedido recusado: ele não veio da tela do sistema.' },
      { status: 403 },
    )
  }

  // Sinal positivo (achado C-12): `unsafe-eval` só no servidor de desenvolvimento.
  // Com PONTO de propósito, ao contrário de `sessao.ts`: aqui o Next troca o
  // valor no build, e um `next build` fica `'production'` mesmo com NODE_ENV
  // herdado errado no `next start`.
  const emDesenvolvimento = process.env.NODE_ENV === 'development'
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')

  const politica = [
    "default-src 'self'",
    emDesenvolvimento
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // `style-src` continua com `'unsafe-inline'`: é exigência do Next para os
    // estilos críticos embutidos, e o estrago possível por CSS é de outra
    // ordem de grandeza — não executa código.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ')

  const cabecalhosDaRequisicao = new Headers(requisicao.headers)
  // É por este cabeçalho na REQUISIÇÃO que o Next descobre o nonce e o coloca
  // nos scripts que ele mesmo emite. Sem isto, a página carrega sem JavaScript
  // nenhum e a tela fica estática, sem erro visível.
  cabecalhosDaRequisicao.set('x-nonce', nonce)
  cabecalhosDaRequisicao.set('Content-Security-Policy', politica)

  const resposta = NextResponse.next({ request: { headers: cabecalhosDaRequisicao } })
  resposta.headers.set('Content-Security-Policy', politica)
  return resposta
}

export const config = {
  /**
   * Fora: os arquivos estáticos e as imagens otimizadas.
   *
   * Eles não executam script e não precisam de nonce; passar por aqui só
   * gastaria uma execução de middleware por arquivo. As ROTAS DE API ficam
   * dentro de propósito — a política também vale para o que elas devolvem.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
