/**
 * O nonce da CSP chegou a cada `<script>` da página? — pendência 46.
 *
 * `src/proxy.ts` sorteia um nonce por requisição e o põe na CSP. O Next lê o
 * cabeçalho da REQUISIÇÃO e repassa o nonce aos próprios scripts de
 * hidratação; script sem o nonce certo o navegador não roda, e a tela quebra
 * sem nenhum erro no servidor. Se uma versão futura do Next deixar de
 * repassar, só uma página servida de verdade mostra — por isso o CI sobe
 * `next start` e chama isto (`scripts/conferir-nonce.ts`).
 *
 * Função pura, num arquivo à parte, para o teste importá-la sem disparar nada
 * (o mesmo arranjo de `proxy-no-manifesto.ts`).
 */

const NONCE_NA_CSP = /'nonce-([^']+)'/
const ABERTURA_DE_SCRIPT = /<script\b[^>]*>/gi
const NONCE_NO_SCRIPT = /\bnonce\s*=\s*(?:"([^"]*)"|'([^']*)')/i

/** Os problemas encontrados; lista vazia = todo script tem o nonce do cabeçalho. */
export function problemasDoNonce(cabecalhoCsp: string | null, html: string): string[] {
  const nonce = cabecalhoCsp?.match(NONCE_NA_CSP)?.[1]
  if (nonce === undefined) return ['o cabeçalho Content-Security-Policy não traz nonce']

  const scripts = html.match(ABERTURA_DE_SCRIPT) ?? []
  if (scripts.length === 0) return ['a página não tem nenhum <script>: a conferência não provou nada']

  const semONonce = scripts.filter((abertura) => {
    const achado = abertura.match(NONCE_NO_SCRIPT)
    return (achado?.[1] ?? achado?.[2]) !== nonce
  })
  if (semONonce.length === 0) return []

  return [
    `${semONonce.length} de ${scripts.length} script(s) sem o nonce do cabeçalho — o navegador não os roda. ` +
      `Primeiro: ${semONonce[0]!.slice(0, 160)}`,
  ]
}
