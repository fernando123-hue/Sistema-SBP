import { createHmac } from 'node:crypto'

import { lerCamposDeBusca, normalizarCpf } from '../core/chave-de-busca'
import { ambiente } from './ambiente'

/**
 * CPF protegido (`A23(b)`, aprovado pelo dono em `A39(c)`).
 *
 * O sistema guarda, sem data de exclusão, um código calculado a partir do CPF
 * com o segredo `BUSCA_SECRET`. Quem digita o mesmo CPF na busca gera o mesmo
 * código e acha o item; quem copia o banco sem o segredo não volta ao CPF —
 * nem testando todos os CPFs possíveis, porque cada tentativa exige o segredo.
 *
 * Mora fora do núcleo porque usa `node:crypto` e o ambiente. QUAL CPF pode
 * virar código é regra pura, em `core/chave-de-busca.ts`.
 *
 * LIMITE CONHECIDO (`A28`, fase 4): o código só reconhece CPF IDÊNTICO. "CPF
 * quase igual" — o dígito que a pessoa corrige num segundo e-mail — só pode ser
 * comparado enquanto o texto do e-mail ainda existe.
 */

/**
 * Versão do código, gravada na frente dele.
 *
 * Trocar o segredo sem migração quebra a busca de todo item cujo texto já saiu.
 * Com a versão no valor, um segredo novo pode conviver com os códigos antigos
 * (`v1:` e `v2:` lado a lado) em vez de apagar a busca de uma vez.
 */
export const VERSAO_DO_CPF_PROTEGIDO = 'v1'

/** O código protegido do CPF, ou `null` se o texto não for um CPF válido. */
export function protegerCpf(texto: string): string | null {
  const cpf = normalizarCpf(texto)
  if (cpf === null) return null

  const codigo = createHmac('sha256', ambiente().BUSCA_SECRET).update(cpf).digest('hex')
  return `${VERSAO_DO_CPF_PROTEGIDO}:${codigo}`
}

/**
 * As colunas de chave de um item, a partir dos campos extraídos ou revisados.
 *
 * Devolve SEMPRE as duas colunas, inclusive nulas: na revisão, quem trocou ou
 * apagou o CPF precisa que a chave antiga saia, e não que fique por omissão.
 */
export function chaveDeBusca(campos: Readonly<Record<string, string>>): {
  cpfProtegido: string | null
  matricula: string | null
} {
  const { cpf, matricula } = lerCamposDeBusca(campos)
  return { cpfProtegido: cpf === null ? null : protegerCpf(cpf), matricula }
}
