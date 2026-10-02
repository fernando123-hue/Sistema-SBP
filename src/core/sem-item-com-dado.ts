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
 * logotipo anexado também fica guardada — por 30 dias, não para sempre (`A76`).
 *
 * É uma heurística de FORMA: reduz o risco, não o fecha. O pedido escrito só
 * com nome, sem documento e sem anexo, ainda escapa (revisões do #191).
 *
 * Falso positivo custa pouco (o e-mail fica guardado 30 dias); falso negativo
 * é o trabalho sumindo. Por isso a forma é larga: um telefone de 11 dígitos sem
 * pontuação também conta como CPF.
 */

export type DadoDeTrabalho = 'cpf' | 'crm' | 'anexo'

/**
 * Entre os grupos do CPF: nada, ou qualquer mistura de espaço, quebra de
 * linha, ponto, barra, sublinhado ou traço (revisões do #191:
 * `111-444-777-35`, `111/444/777-35` e `111.444.777 - 35` escapavam). Sem
 * vírgula: "pedidos 123, 456, 789, 12" é uma lista, não um CPF.
 */
const SEPARADOR_DE_CPF = String.raw`[\s._/–—-]*`

/** Três, três, três e dois dígitos, sem dígito colado antes nem depois. */
const FORMA_DE_CPF = new RegExp(
  String.raw`(?<!\d)\d{3}` + SEPARADOR_DE_CPF + String.raw`\d{3}` + SEPARADOR_DE_CPF + String.raw`\d{3}` +
    SEPARADOR_DE_CPF + String.raw`\d{2}(?!\d)`,
)

/**
 * "CRM" (qualquer caixa), talvez a UF — em maiúscula qualquer par de letras;
 * em minúscula, só uma das 27 siglas, para "CRM de 2024" não contar —, talvez
 * "nº", e o número: com ponto de milhar (`12.345`) ou com pelo menos quatro
 * dígitos seguidos.
 */
const UF_MINUSCULA = 'ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to'
const CRM_COM_NUMERO = new RegExp(
  String.raw`(?<![A-Za-z])[Cc][Rr][Mm](?:[\s:./-]*(?:[A-Z]{2}|` +
    UF_MINUSCULA +
    String.raw`)(?![a-z]))?[\s:./-]*(?:[Nn][º°oO]?\.?[º°oO]?\.?\s*)?(?:\d{1,3}(?:\.\d{3})+|\d{4,})`,
)

/**
 * Dígito de largura total vira dígito comum (NFKC), e todo caractere de
 * formatação invisível sai — largura zero, junção de palavra, hífen suave,
 * marca de direção (`\p{Cf}`, 2ª rodada das revisões do #191).
 */
function normalizar(texto: string): string {
  return texto.normalize('NFKC').replace(/\p{Cf}/gu, '')
}

export function dadoDeTrabalhoSemItem(
  email: { assunto: string; corpo: string },
  quantosAnexos: number,
): DadoDeTrabalho | null {
  const texto = normalizar(`${email.assunto}\n${email.corpo}`)
  if (FORMA_DE_CPF.test(texto)) return 'cpf'
  if (CRM_COM_NUMERO.test(texto)) return 'crm'
  if (quantosAnexos > 0) return 'anexo'
  return null
}
