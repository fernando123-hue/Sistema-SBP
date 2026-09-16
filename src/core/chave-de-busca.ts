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

import { nomeDeCampoGravavel } from './nome-de-campo'

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

/**
 * Tamanho aceito de matrícula (`A41`, resposta 28): o dono sabe que é só número
 * e não sabe quantos dígitos. De 3 a 10 é observação (`A33`), ajustada pelos
 * feedbacks quando aparecer matrícula real fora disso. O teto fica abaixo de 11
 * de propósito: 11 dígitos é um CPF, e aqui ele ficaria guardado sem proteção.
 */
const MENOR_MATRICULA = 3
const MAIOR_MATRICULA = 10

/**
 * Os dígitos da matrícula, ou `null` se o texto não parecer matrícula.
 *
 * A matrícula fica guardada como veio, sem data de exclusão e sem proteção — é
 * número do cadastro, não documento. Por isso o que tem letra (pode ser um
 * nome) ou comprimento de CPF não entra.
 */
export function normalizarMatricula(texto: string): string | null {
  const digitos = texto.replace(SEPARADORES, '')
  if (!/^\d+$/.test(digitos)) return null
  if (digitos.length < MENOR_MATRICULA || digitos.length > MAIOR_MATRICULA) return null
  return digitos
}

/**
 * O CPF e a matrícula que podem virar chave, lidos dos campos extraídos.
 *
 * O nome do campo passa por `nomeDeCampoGravavel`: "CPF", "cpf" e "C.P.F." são
 * o mesmo campo, e "Matrícula" é "matricula". Se dois campos com o mesmo nome
 * trouxerem valores válidos DIFERENTES, não há chave: é ambíguo, e pode ser um
 * e-mail tentando pendurar o item no CPF de outra pessoa.
 */
export function lerCamposDeBusca(campos: Readonly<Record<string, string>>): {
  cpf: string | null
  matricula: string | null
} {
  const cpfs = new Set<string>()
  const matriculas = new Set<string>()

  for (const [chave, valor] of Object.entries(campos)) {
    const nome = nomeDeCampoGravavel(chave)
    if (nome === 'cpf') {
      const cpf = normalizarCpf(valor)
      if (cpf !== null) cpfs.add(cpf)
    } else if (nome === 'matricula') {
      const matricula = normalizarMatricula(valor)
      if (matricula !== null) matriculas.add(matricula)
    }
  }

  return {
    cpf: cpfs.size === 1 ? [...cpfs][0]! : null,
    matricula: matriculas.size === 1 ? [...matriculas][0]! : null,
  }
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
