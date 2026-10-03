/**
 * O build registrou o proxy? — conferência depois do `next build`, no CI.
 *
 * `src/proxy.ts` aplica a CSP com nonce e recusa pedido de outra origem em
 * `/api/*`. O Next só o executa se ele estiver no lugar e com o nome da
 * convenção; fora disso (movido para `src/app/`, apagado, convenção trocada
 * numa versão futura), o Next o IGNORA SEM AVISO e o build fica verde — as duas
 * defesas somem em silêncio (revisão de segurança do PR da troca
 * `middleware.ts` → `proxy.ts`). O teste unitário importa a função direto e
 * não percebe nada disso.
 *
 * A prova está no manifesto que o build grava: `functions-config-manifest.json`
 * lista o proxy como `/_middleware` (nome interno do Next) com o regexp do
 * `matcher`. O `middleware-manifest.json` NÃO serve: fica vazio com o proxy em
 * Node.js.
 */

/** Rotas que o proxy TEM de cobrir, e a que ele não deve tocar. */
const PRECISA_COBRIR = ['/api/sessao', '/entrar', '/'] as const
const NAO_DEVE_COBRIR = ['/_next/static/chunks/x.js'] as const

/** Os problemas encontrados; lista vazia = o build registrou o proxy certo. */
export function problemasDoProxyNoManifesto(manifesto: unknown): string[] {
  const funcoes = (manifesto as { functions?: Record<string, { matchers?: { regexp?: unknown }[] }> } | null)
    ?.functions
  const proxy = funcoes?.['/_middleware']
  if (!proxy) return ['o build não registrou o proxy (`/_middleware` ausente do manifesto)']

  const expressoes = (proxy.matchers ?? [])
    .map((m) => m.regexp)
    .filter((r): r is string => typeof r === 'string')
    .map((r) => new RegExp(r))
  if (expressoes.length === 0) return ['o proxy foi registrado sem nenhum matcher']

  const cobre = (rota: string) => expressoes.some((e) => e.test(rota))
  return [
    ...PRECISA_COBRIR.filter((rota) => !cobre(rota)).map((rota) => `o proxy não cobre ${rota}`),
    ...NAO_DEVE_COBRIR.filter(cobre).map((rota) => `o proxy cobre ${rota}, que é arquivo estático`),
  ]
}
