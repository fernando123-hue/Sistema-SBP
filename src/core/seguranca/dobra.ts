/**
 * Dobra de texto: a forma em que os padrões de injeção são PROCURADOS.
 *
 * ═══ O FURO QUE ISTO FECHA ═══
 *
 * As expressões de `conteudo-nao-confiavel.ts` rodavam sobre o texto cru.
 * `Ignore as instruções` era detectado; `Ign`+U+200B+`ore as instruções` não —
 * e quem lê, gente ou modelo, lê as duas frases do mesmo jeito. Um remetente não
 * precisava de nenhuma técnica: bastava um caractere invisível no meio da
 * palavra, ou um `о` cirílico no lugar do `o`. Achado 14 da auditoria de
 * 08/09/2026.
 *
 * A dobra tira do caminho tudo o que muda a STRING sem mudar o que se LÊ:
 *
 *   1. formatação invisível (`\p{Cf}`): largura zero, hífen suave, override de
 *      direção, marcas de tag;
 *   2. decomposição de compatibilidade (NFKD): largura total, letras
 *      matemáticas, ligaduras, espaço não separável;
 *   3. marcas combinantes: `voce`+U+0302 vira `voce` — e `você` também, o que as
 *      expressões já aceitam, porque todas trazem a alternativa sem acento;
 *   4. homóglifos de cirílico e grego que se passam por letra latina.
 *
 * ═══ O QUE ELA NÃO É ═══
 *
 * Não é o texto que vai ao modelo. A dobra serve para ENCONTRAR; quem recorta é
 * o chamador, sobre o original, usando o mapa de posições. Nome com acento,
 * ordinal (`2ª`) e o resto do e-mail chegam à IA exatamente como vieram — é
 * deles que ela extrai os campos.
 *
 * E não é defesa completa. Leetspeak (`1gn0re`), sinônimo e paráfrase passam —
 * a lista de padrões é rede, não muro. A defesa real continua sendo a
 * arquitetura: a IA só devolve objeto validado por Zod e nunca decide quem
 * recebe.
 */

export interface TextoDobrado {
  /** O texto na forma em que os padrões são procurados. */
  readonly dobrado: string
  /**
   * Para cada unidade UTF-16 de `dobrado`, o intervalo `[inicio, fim)` do
   * caractere ORIGINAL que a produziu. É o que permite recortar no texto de
   * verdade um trecho encontrado na forma dobrada.
   */
  readonly inicio: readonly number[]
  readonly fim: readonly number[]
}

const FORMATACAO_INVISIVEL = /\p{Cf}/u
const MARCA_COMBINANTE = /\p{M}/u

/**
 * Letras de outros alfabetos que, na fonte da tela, são indistinguíveis de uma
 * latina. Por code point, nunca literal: um homóglifo colado no fonte é
 * invisível justamente para quem revisa esta lista.
 *
 * Mapeia para minúscula porque todas as expressões são `/i`.
 */
const HOMOGLIFOS: ReadonlyMap<string, string> = new Map(
  (
    [
      // cirílico minúsculo
      [0x0430, 'a'], [0x0435, 'e'], [0x043e, 'o'], [0x0440, 'p'], [0x0441, 'c'],
      [0x0443, 'y'], [0x0445, 'x'], [0x0456, 'i'], [0x0458, 'j'], [0x0455, 's'],
      [0x0501, 'd'], [0x04cf, 'l'], [0x051b, 'q'], [0x051d, 'w'],
      // cirílico maiúsculo
      [0x0410, 'a'], [0x0412, 'b'], [0x0415, 'e'], [0x041a, 'k'], [0x041c, 'm'],
      [0x041d, 'h'], [0x041e, 'o'], [0x0420, 'p'], [0x0421, 'c'], [0x0422, 't'],
      [0x0425, 'x'], [0x0406, 'i'], [0x0408, 'j'], [0x0405, 's'], [0x04ae, 'y'],
      // grego
      [0x03bf, 'o'], [0x03b9, 'i'], [0x03ba, 'k'], [0x03bd, 'v'], [0x03c1, 'p'],
      [0x03c5, 'u'], [0x0391, 'a'], [0x0392, 'b'], [0x0395, 'e'], [0x0396, 'z'],
      [0x0397, 'h'], [0x0399, 'i'], [0x039a, 'k'], [0x039c, 'm'], [0x039d, 'n'],
      [0x039f, 'o'], [0x03a1, 'p'], [0x03a4, 't'], [0x03a5, 'y'], [0x03a7, 'x'],
    ] as const
  ).map(([codigo, latina]) => [String.fromCodePoint(codigo), latina]),
)

function dobrarCaractere(caractere: string): string {
  if (FORMATACAO_INVISIVEL.test(caractere)) return ''

  let saida = ''
  for (const parte of caractere.normalize('NFKD')) {
    if (MARCA_COMBINANTE.test(parte)) continue
    saida += HOMOGLIFOS.get(parte) ?? parte
  }
  return saida
}

/**
 * Caractere a caractere, e não `texto.normalize()` de uma vez: só assim cada
 * pedaço da forma dobrada sabe de onde veio. Como a dobra DESCARTA toda marca
 * combinante, decompor um caractere isolado dá o mesmo resultado que decompor a
 * string inteira — a interação entre vizinhos que o NFKD de string trataria é
 * justamente a que é jogada fora.
 */
export function dobrar(texto: string): TextoDobrado {
  let dobrado = ''
  const inicio: number[] = []
  const fim: number[] = []
  let posicao = 0

  for (const caractere of texto) {
    const proxima = posicao + caractere.length
    const forma = dobrarCaractere(caractere)
    for (let unidade = 0; unidade < forma.length; unidade += 1) {
      inicio.push(posicao)
      fim.push(proxima)
    }
    dobrado += forma
    posicao = proxima
  }

  return { dobrado, inicio, fim }
}
