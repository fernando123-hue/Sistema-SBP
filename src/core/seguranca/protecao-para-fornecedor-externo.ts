import { truncar } from './conteudo-nao-confiavel'

/**
 * A camada de defesa do dado antes de um fornecedor EXTERNO (`DECISOES.md § A62`).
 *
 * O dono decidiu, em 26/09/2026, que e-mail real da associação só vai a um
 * fornecedor externo sem acordo empresarial (o Jev, da TypeSafe) depois de
 * passar por uma camada de defesa. Esta é ela, e vale para qualquer
 * fornecedor externo — não é do Jev.
 *
 * ANTES DE TUDO, NORMALIZA (NFKC, e sem caracteres invisíveis de formatação):
 * dígito de largura total, `＠`, espaço de largura zero e hífen suave entre os
 * grupos de um CPF aparecem ao copiar de PDF ou da web, e passavam inteiros
 * pelas expressões (revisões do #135). O texto que sai é o normalizado: o
 * classificador não precisa da forma original, e acento continua acento.
 *
 * O QUE SAI:
 * - "palavra" com cara de link: com esquema (`https://`, `ftp://`, qualquer
 *   `xxx://`), com `www.` ou `dominio.tld/caminho`. Link carrega token,
 *   e-mail e número na própria URL; sai inteiro.
 * - e-mail, inclusive `%40`.
 * - o número depois de conselho profissional (CRM, CREMESP, RQE, COREN…),
 *   de "matrícula" e de "registro", mesmo curto, nas grafias comuns
 *   (`CRM/SP nº 1.234`).
 * - toda sequência de 5 ou mais dígitos com até três separadores entre eles:
 *   CPF, CNPJ, telefone, CEP, RG, protocolo — e também DATA COMPLETA e valor
 *   com 5+ dígitos (`AT-49`). Aqui um falso positivo custa pouco (o
 *   classificador perde um número que não precisa para entender o pedido); um
 *   falso negativo é dado pessoal saindo da casa.
 *
 * O QUE FICA, e é por isso que esta camada NÃO basta sozinha para dado real:
 * nome, endereço e data por extenso, dado de saúde (CID), placa, agência de
 * 4 dígitos, dado de terceiro em e-mail encaminhado, e escrita feita de
 * propósito para escapar (`12x34x56`,
 * `fulana [at] exemplo`). Achar nome em texto livre sem modelo não é
 * confiável. Por isso a chave de dado real nasce desligada, e quem a liga é o
 * dono, com as condições do `§ H.4` item 35.
 *
 * TEMPO: todo quantificador tem teto, e os conjuntos de separador e de dígito
 * são disjuntos — o texto inteiro é mascarado ANTES do corte, e um corpo pode
 * ter 200 mil caracteres. Um `\s*…\s*` sem teto em volta de um grupo que pode
 * ser vazio levava 16 s num corpo hostil (revisões do #135); o teste de texto
 * hostil tem um caso para cada expressão.
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

// Formatação invisível: largura zero, hífen suave, marcas de direção.
const INVISIVEL = /\p{Cf}/gu

// A decisão de ser link é feita por PALAVRA (tudo até o próximo espaço ou
// aspas), e não por uma expressão que busca domínio no meio do texto: cada
// palavra é olhada uma vez, só pelo começo, sem recuo.
const PALAVRA = /[^\s<>"'`]+/gu
const COM_ESQUEMA = /^[([{]?(?:[a-z][a-z0-9+.-]{0,15}:\/\/|www\.)/iu
const DOMINIO_COM_CAMINHO = /^[([{]?(?:[\p{L}\p{Nd}-]{1,63}\.){1,8}\p{L}{2,24}\//u

// Parte local sem `%`, `,`, `;` e `:`. Com `%`, cada `%40` abria uma nova
// varredura (1,7 s em 200 mil caracteres); sem `,;`, dois endereços colados
// viravam um só, e o domínio do segundo vazava. O domínio é uma sequência de
// rótulos separados por ponto; como o rótulo não contém ponto, não há recuo.
const EMAIL =
  /[^\s@<>"'`()[\]%,;:]{1,64}(?:@|%40)(?:[\p{L}\p{Nd}_-]{1,63}\.){1,8}[\p{L}\p{Nd}-]{2,63}/giu

// Conselho profissional, e "matrícula" (a chave da própria associação, `A23`),
// com UF e "nº" opcionais nas grafias comuns: `CRM-SP 1234`, `CRM/SP nº 1.234`,
// `CRM – SP n.º 1234` (depois do NFKC, `º` vira `o`). O número aceita ponto e
// traço — `CRM 12.345-6` saía `CRM [número].345-6`.
const ENTRE = String.raw`[^\p{L}\p{Nd}\n]{0,4}`
const REGISTRO = new RegExp(
  String.raw`(?<![\p{L}\p{Nd}])(` +
    String.raw`(?:C\.?R\.?M\.?|CREM[A-Z]{0,3}|RQE|COREN|CRO|CRP|CRF|CRN|CREFITO|matr[ií]cula|registro)` +
    ENTRE +
    String.raw`(?:[A-Z]{2}(?![\p{L}\p{Nd}])${ENTRE})?` +
    String.raw`(?:n\.?[oº°]?\.?${ENTRE})?` +
    String.raw`)\p{Nd}(?:[.\-/ ]?\p{Nd}){0,9}`,
  'giu',
)

// Cinco ou mais dígitos, com até TRÊS separadores entre eles: `123 - 456 -
// 789 - 09` tem três, e saía inteiro com dois. Separador é tudo que não é
// letra, dígito nem quebra de linha — pega travessão, sinal de menos, ponto
// médio e espaço duro sem precisar listá-los.
const NUMERO = /\+?\(?\p{Nd}(?:[^\p{L}\p{Nd}\n@<>[\]]{0,3}\p{Nd}){4,}\)?/gu

export function protegerParaFornecedorExterno(
  texto: string,
  limite: number = LIMITE_PARA_FORNECEDOR_EXTERNO,
): TextoProtegido {
  const mascarados = { numero: 0, email: 0, link: 0 }

  const semDado = texto
    .normalize('NFKC')
    .replace(INVISIVEL, '')
    .replace(PALAVRA, (palavra) => {
      if (!COM_ESQUEMA.test(palavra) && !DOMINIO_COM_CAMINHO.test(palavra)) return palavra
      mascarados.link += 1
      return '[link]'
    })
    .replace(EMAIL, () => {
      mascarados.email += 1
      return '[e-mail]'
    })
    .replace(REGISTRO, (_inteiro, prefixo: string) => {
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
