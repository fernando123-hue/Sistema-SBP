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
 * Funções puras, num arquivo à parte, para o teste importá-las sem disparar
 * nada (o mesmo arranjo de `proxy-no-manifesto.ts`).
 */

const NONCE_NA_CSP = /'nonce-([^']+)'/

/** A abertura do script inteira: `>` dentro de um valor entre aspas não a corta. */
const ABERTURA_DE_SCRIPT = /<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi

/**
 * Um atributo por vez — nome e, se houver, valor. Ler atributo a atributo, e não
 * procurar `nonce=` no meio do texto, é o que impede `data-nonce="X"` e um
 * `nonce='X'` escrito dentro do valor de outro atributo de passarem por nonce
 * (revisões do #214, M3 e S2): o navegador não os trataria assim.
 */
const ATRIBUTO = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

export function nonceDoCabecalho(cabecalhoCsp: string | null): string | null {
  return cabecalhoCsp?.match(NONCE_NA_CSP)?.[1] ?? null
}

function nonceDoScript(atributos: string): string | null {
  for (const [, nome, duplas, simples, semAspas] of atributos.matchAll(ATRIBUTO)) {
    if (nome!.toLowerCase() === 'nonce') return duplas ?? simples ?? semAspas ?? ''
  }
  return null
}

/** Os problemas encontrados; lista vazia = todo script tem o nonce do cabeçalho. */
export function problemasDoNonce(cabecalhoCsp: string | null, html: string): string[] {
  const nonce = nonceDoCabecalho(cabecalhoCsp)
  if (nonce === null) return ['o cabeçalho Content-Security-Policy não traz nonce']

  const scripts = [...html.matchAll(ABERTURA_DE_SCRIPT)]
  if (scripts.length === 0) return ['a página não tem nenhum <script>: a conferência não provou nada']

  const semONonce = scripts.filter(([, atributos]) => nonceDoScript(atributos ?? '') !== nonce)
  if (semONonce.length === 0) return []

  return [
    `${semONonce.length} de ${scripts.length} script(s) sem o nonce do cabeçalho — o navegador não os roda. ` +
      `Primeiro: ${semONonce[0]![0].slice(0, 160)}`,
  ]
}

/**
 * `null` quando a conferência pode rodar; senão, o porquê de não rodar.
 *
 * `next start` roda a limpeza diária na partida (`A17`, `A78`). Com a base e a
 * pasta do `.env`, ela apagaria anexos de verdade — locais, mas que não são
 * desta conferência decidir (revisão técnica do #214, M2). Então a base tem de
 * ser de teste e as duas vêm do ambiente do comando, nunca do `.env`, que o
 * `next start` leria sozinho.
 */
export function recusaDoAmbiente(ambiente: Readonly<Record<string, string | undefined>>): string | null {
  const url = ambiente['DATABASE_URL']
  if (url === undefined || url === '') {
    return 'DATABASE_URL precisa vir no ambiente do comando, apontando para uma base de teste (o .env não serve).'
  }
  let base: string
  try {
    base = new URL(url).pathname.replace(/^\//, '')
  } catch {
    return 'DATABASE_URL não é uma URL válida.'
  }
  if (!base.endsWith('_teste')) {
    return `A base "${base}" não termina em _teste: a limpeza diária da partida rodaria nela.`
  }
  if ((ambiente['ARMAZENAMENTO_DIR'] ?? '') === '') {
    return 'ARMAZENAMENTO_DIR precisa vir no ambiente do comando, numa pasta temporária (o .env não serve).'
  }
  return null
}
