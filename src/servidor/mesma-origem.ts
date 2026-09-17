/**
 * O pedido que altera estado veio de outra origem?
 *
 * Achados C-13 e C-17: nenhuma rota que altera estado conferia a origem, e a
 * defesa era só o cookie `SameSite=Lax`. Lax barra outro SITE, não outra
 * ORIGEM do mesmo site — outra porta no mesmo endereço, outro subdomínio do
 * mesmo domínio. De lá, um formulário agia como a gestora logada. E o CSRF de
 * login não era barrado por nada: outro site deixava o navegador da vítima
 * logado na conta do atacante.
 *
 * A regra, na ordem:
 * - método que não altera estado (GET, HEAD, OPTIONS) não é conferido;
 * - com `Sec-Fetch-Site` — que o navegador escreve e página nenhuma consegue
 *   forjar —, só `same-origin` passa;
 * - sem ele, decide o `Origin`, que precisa ser o mesmo host do pedido;
 * - sem nenhum dos dois, não é navegador, e CSRF exige navegador: passa. A
 *   autenticação continua valendo como sempre.
 *
 * Sem dependência de Node: roda no middleware.
 *
 * ATRÁS DE PROXY (`A46`): a comparação do `Origin` usa o `Host` que chega ao
 * Next. Se o proxy reescrever o `Host`, os navegadores sem `Sec-Fetch-Site`
 * passam a ser recusados — conferir junto com `PROXIES_CONFIAVEIS` no dia da
 * publicação.
 */

const METODOS_SEM_EFEITO = new Set(['GET', 'HEAD', 'OPTIONS'])

export function pedidoDeOutraOrigem(pedido: Pick<Request, 'method' | 'headers'>): boolean {
  if (METODOS_SEM_EFEITO.has(pedido.method.toUpperCase())) return false

  const site = pedido.headers.get('sec-fetch-site')
  if (site !== null) return site !== 'same-origin'

  const origem = pedido.headers.get('origin')
  if (origem === null) return false

  const host = pedido.headers.get('host')
  try {
    return host === null || new URL(origem).host !== host
  } catch {
    // `Origin: null` (documento isolado, redirecionamento) não é a própria tela.
    return true
  }
}
