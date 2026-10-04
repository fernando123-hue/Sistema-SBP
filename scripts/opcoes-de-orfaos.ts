/**
 * O que a linha de comando de `db:expurgar` pede sobre anexo sem registro.
 *
 * A porta manual (`AT-74`) passa por cima das travas contra banco errado, então
 * a entrada é conferida aqui, antes de qualquer banco: um número inteiro
 * positivo, que é o que `--listar-orfaos` mostrou, e o nome de quem autoriza,
 * que vai para a trilha (revisão de segurança do #211, S2). O nome é DECLARADO
 * — a linha de comando não tem sessão —, e por isso fica no `depois` da
 * trilha, nunca no campo de quem fez.
 */

export type OpcoesDeOrfaos =
  | { modo: 'rotina' }
  | { modo: 'listar' }
  | { modo: 'aceitar'; quantidade: number; por: string }

const LISTAR = '--listar-orfaos'
const ACEITAR = '--aceitar-orfaos='
const POR = '--por='

/** Letras (com acento), espaço, ponto, apóstrofo e hífen; de 2 a 60. */
const NOME_DECLARADO = /^[\p{L}][\p{L} .'-]{1,59}$/u

function valorDe(argumentos: readonly string[], prefixo: string): string | undefined {
  return argumentos.find((argumento) => argumento.startsWith(prefixo))?.slice(prefixo.length)
}

export function lerOpcoesDeOrfaos(argumentos: readonly string[]): OpcoesDeOrfaos {
  const listar = argumentos.includes(LISTAR)
  const quantidade = valorDe(argumentos, ACEITAR)

  if (listar && quantidade !== undefined) {
    throw new Error(`${LISTAR} e ${ACEITAR}N não vão juntos: liste, confira, e só então aceite.`)
  }
  if (listar) return { modo: 'listar' }
  if (quantidade === undefined) return { modo: 'rotina' }

  if (!/^[1-9][0-9]*$/.test(quantidade)) {
    throw new Error(`${ACEITAR} precisa de um número inteiro positivo, e veio "${quantidade}".`)
  }
  const por = valorDe(argumentos, POR)
  if (por === undefined || !NOME_DECLARADO.test(por)) {
    throw new Error(`${ACEITAR}N exige ${POR}<seu nome> (letras, de 2 a 60): a trilha diz quem autorizou.`)
  }
  return { modo: 'aceitar', quantidade: Number(quantidade), por }
}
