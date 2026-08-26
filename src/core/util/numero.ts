/**
 * Aritmética do crédito.
 *
 * O crédito é fracionário por natureza (`Q / n`) e é um livro-razão que roda
 * por anos. Duas regras, aprendidas na marra por um teste que falhou:
 *
 *   1. NUNCA arredondar dentro do cálculo. Arredondar a cota justa a 6 casas
 *      vaza até `n × 10⁻⁶` por rodada; a soma dos créditos deixa de ser zero
 *      e o balanceamento deriva devagar, sem ninguém perceber. Exatamente o
 *      tipo de erro silencioso que este sistema existe para eliminar.
 *      O cálculo roda em float64 cheio (erro ~1e-16 por operação).
 *
 *   2. Comparações usam EPSILON, nunca `===`.
 *
 * `arredondar` serve só para a BORDA — exibição na tela e persistência.
 *
 * Alocação, por outro lado, é SEMPRE inteira. Nenhum item vira fração para
 * facilitar uma conta.
 */

export const EPSILON = 1e-9
export const CASAS = 6

const FATOR = 10 ** CASAS

export function arredondar(valor: number): number {
  return Math.round(valor * FATOR) / FATOR
}

/** `-1` se a < b, `1` se a > b, `0` se equivalentes dentro do epsilon. */
export function compararNumero(a: number, b: number): -1 | 0 | 1 {
  const delta = a - b
  if (Math.abs(delta) < EPSILON) return 0
  return delta < 0 ? -1 : 1
}

export function ehInteiroNaoNegativo(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isInteger(valor) && valor >= 0
}

export function somar(valores: readonly number[]): number {
  return valores.reduce((acumulado, valor) => acumulado + valor, 0)
}

/**
 * Gerador pseudoaleatório determinístico (LCG).
 * Usado só em testes — a decisão do motor não tem aleatoriedade nenhuma.
 */
export function criarRandom(seed: number): () => number {
  let estado = seed >>> 0
  return () => {
    estado = (Math.imul(estado, 1664525) + 1013904223) >>> 0
    return estado / 0x100000000
  }
}
