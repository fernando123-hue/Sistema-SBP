/**
 * Dado de trabalho num e-mail que a IA leu como "nenhum pedido" (`AT-73`).
 *
 * POR QUE EXISTE: o texto da IA manda devolver zero itens para a resposta
 * automática (`A34`, `AT-72`). Um e-mail que COMEÇA como resposta automática e
 * esconde um pedido mais abaixo não tem nada de suspeito para a detecção por
 * padrão nem para o modelo; se o modelo errar, o trabalho some — sem item não
 * há `Revisao`, e a idempotência por `messageId` não o relê. A lista da fase 4
 * (`A34`) cobre só o suspeito, então não resolve este caso (revisão de
 * segurança do #190). Esta regra é determinística e não depende do modelo.
 *
 * O QUE CONTA: um CPF (pela FORMA — um número errado continua sendo dado de
 * alguém), um CRM com número, ou QUALQUER anexo. Não dá para poupar imagem:
 * o tipo declarado é do remetente e nunca decide nada (`AnexoSchema`), então
 * um PDF declarado "image/png" escaparia. O preço: a resposta automática com
 * logotipo anexado também fica guardada até alguém olhar.
 *
 * Falso positivo custa pouco (o e-mail fica guardado até alguém olhar); falso
 * negativo é o trabalho sumindo. Por isso a forma é larga: um telefone de 11
 * dígitos sem pontuação também conta como CPF.
 */

export type DadoDeTrabalho = 'cpf' | 'crm' | 'anexo'

/** Três, três, três e dois dígitos, com ou sem ponto, espaço ou traço. */
const FORMA_DE_CPF = /(?<!\d)\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}(?!\d)/

/** "CRM", talvez a UF, e um número de pelo menos quatro dígitos. */
const CRM_COM_NUMERO = /\bCRM\b[\s:/-]*(?:[A-Z]{2}[\s/-]*)?\d{4,}/i

export function dadoDeTrabalhoSemItem(
  email: { assunto: string; corpo: string },
  quantosAnexos: number,
): DadoDeTrabalho | null {
  const texto = `${email.assunto}\n${email.corpo}`
  if (FORMA_DE_CPF.test(texto)) return 'cpf'
  if (CRM_COM_NUMERO.test(texto)) return 'crm'
  if (quantosAnexos > 0) return 'anexo'
  return null
}
