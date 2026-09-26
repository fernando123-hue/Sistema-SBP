import { truncar } from './conteudo-nao-confiavel'

/**
 * A camada de defesa do dado antes de um fornecedor EXTERNO (`DECISOES.md § A62`).
 *
 * O dono decidiu, em 26/09/2026, que e-mail real da associação só vai a um
 * fornecedor externo sem acordo empresarial (o Jev, da TypeSafe) depois de
 * passar por uma camada de defesa. Esta é ela, e vale para qualquer
 * fornecedor externo — não é do Jev.
 *
 * O QUE SAI: link inteiro (pode carregar token, e-mail ou número na própria
 * URL), e-mail, e toda sequência de 5 ou mais dígitos — CPF, CNPJ, telefone,
 * CEP, RG, número de protocolo — com ou sem pontuação entre eles. E o número
 * que vem depois de "CRM", mesmo curto. Nada de dígito verificador: aqui um
 * falso positivo custa pouco (o classificador perde um número que não precisa
 * para entender o pedido) e um falso negativo é dado pessoal saindo da casa.
 *
 * O QUE FICA, e é por isso que esta camada NÃO basta sozinha para dado real:
 * NOMES, endereços por extenso, e o que mais o texto contar sobre a pessoa.
 * Achar nome em texto livre sem modelo não é confiável. Por isso a chave de
 * dado real nasce desligada e quem a liga é o dono, depois de ler os termos
 * do fornecedor (`A38`, `A62`).
 *
 * ORDEM: mascara, e SÓ DEPOIS corta — um número partido ao meio no limite
 * escaparia pela metade que ficou. A contagem diz quanto foi mascarado, nunca
 * o quê: ela vai para a trilha, e a trilha não pode guardar o dado.
 */

export interface TextoProtegido {
  readonly texto: string
  readonly cortado: boolean
  readonly mascarados: { readonly numero: number; readonly email: number; readonly link: number }
}

/** Texto maior que isto não ajuda a classificar e custa por token. */
export const LIMITE_PARA_FORNECEDOR_EXTERNO = 4000

const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi
// COM teto de tamanho, e não `+`: sem ele, um trecho longo sem espaço e sem
// `@` era varrido inteiro a partir de CADA posição — 100 mil caracteres
// levavam 5,6 s (medido; é o teste de texto hostil). 64 antes do `@` e 255
// depois são os limites do próprio endereço de e-mail.
// `%40` é o `@` escapado em URL: um endereço colado de um link continua endereço.
const EMAIL = /[^\s@<>"'`()[\]]{1,64}(?:@|%40)[^\s@<>"'`()[\]]{1,255}\.[^\s@<>"'`()[\]]{1,63}/gi
// "CRM 12345/SP", "CRM-SP 1234", "crm: 987": o número do registro é curto
// demais para a regra geral de 5 dígitos.
const CRM = /\b(CRM(?:[-/ ]?[A-Z]{2})?\s*[:º°.-]*\s*)\d{1,7}/gi
// Cinco ou mais dígitos, com até dois separadores entre eles: `(11) 9…`,
// `123.456.789-09`, `12.345.678/0001-95`, `+55 11 91234 5678`. Os traços
// incluem os tipográficos (‐ ‑ ‒ – —): o Outlook e o Word trocam o hífen
// sozinhos, e `91234–5678` passava inteiro (achado na revisão do #132).
const NUMERO = /\+?\(?\d(?:[\s.\-/()\u2010-\u2014]{0,2}\d){4,}\)?/g

export function protegerParaFornecedorExterno(
  texto: string,
  limite: number = LIMITE_PARA_FORNECEDOR_EXTERNO,
): TextoProtegido {
  const mascarados = { numero: 0, email: 0, link: 0 }

  const semDado = texto
    .replace(LINK, () => {
      mascarados.link += 1
      return '[link]'
    })
    .replace(EMAIL, () => {
      mascarados.email += 1
      return '[e-mail]'
    })
    .replace(CRM, (_inteiro, prefixo: string) => {
      mascarados.numero += 1
      return `${prefixo}[número]`
    })
    .replace(NUMERO, () => {
      mascarados.numero += 1
      return '[número]'
    })

  return {
    texto: truncar(semDado, limite),
    cortado: semDado.length > limite,
    mascarados,
  }
}
