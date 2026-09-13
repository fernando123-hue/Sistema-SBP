/**
 * Chave de busca que fica sem data de exclusão (`A23(b)`) — a parte pura.
 *
 * Decide QUAL CPF pode virar chave. O código protegido em si usa segredo do
 * servidor e `node:crypto`, e por isso mora fora do núcleo.
 *
 * Só entra CPF que confere (`A40`, resposta 26): uma chave feita de um número
 * errado só acharia o item para quem errasse igual, e confunde mais do que
 * ajuda. Se a revisão humana corrigir o CPF, a chave nasce com o número certo.
 */

/** O que uma pessoa costuma pôr entre os dígitos: espaço, ponto e traço. */
const SEPARADORES = /[\s.-]/g

/**
 * Os 11 dígitos do CPF, ou `null` se o texto não for exatamente um CPF válido.
 *
 * Não EXTRAI dígitos de um texto maior: "CPF 111.444.777-35" ou dois números
 * colados não viram uma chave "limpa". O campo vem do modelo, que lê conteúdo
 * hostil, e o que não é só o número fica sem chave.
 */
export function normalizarCpf(texto: string): string | null {
  const digitos = texto.replace(SEPARADORES, '')
  if (!/^\d{11}$/.test(digitos)) return null

  // 000.000.000-00, 111.111.111-11 e os demais fecham a conta dos verificadores
  // e não são CPF de ninguém.
  if (/^(\d)\1{10}$/.test(digitos)) return null

  if (digitoVerificador(digitos, 9) !== Number(digitos.charAt(9))) return null
  if (digitoVerificador(digitos, 10) !== Number(digitos.charAt(10))) return null

  return digitos
}

/** Dígito verificador calculado sobre os `quantos` primeiros dígitos. */
function digitoVerificador(digitos: string, quantos: number): number {
  let soma = 0
  for (let posicao = 0; posicao < quantos; posicao += 1) {
    soma += Number(digitos.charAt(posicao)) * (quantos + 1 - posicao)
  }
  const resto = soma % 11
  return resto < 2 ? 0 : 11 - resto
}
