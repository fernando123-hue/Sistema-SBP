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
 * - link, do começo dele até o fim da palavra, mesmo colado a outra coisa
 *   (`Link:https://…`, `[aqui](https://…)`, `“https://…”`): com esquema
 *   (qualquer `xxx://`), com `www.`, ou `dominio.tld` seguido de caminho,
 *   porta ou `?chave=`. Link carrega token, e-mail e número na própria URL.
 * - e-mail, inclusive `%40`.
 * - o número depois de conselho profissional (CRM, CREMESP, RQE, COREN…),
 *   de "matrícula", "registro" e "inscrição", mesmo curto, com UF e até três
 *   palavras de ligação no meio (`inscrita no CRM/SP sob o nº 1.234`).
 * - toda sequência de 5 ou mais dígitos com até três separadores entre eles:
 *   CPF, CNPJ, telefone, CEP, RG, protocolo — e também DATA COMPLETA e valor
 *   com 5+ dígitos (`AT-49`). Aqui um falso positivo custa pouco (o
 *   classificador perde um número que não precisa para entender o pedido); um
 *   falso negativo é dado pessoal saindo da casa.
 *
 * O QUE FICA, e é por isso que esta camada NÃO basta sozinha para dado real:
 * nome, endereço e data por extenso, dado de saúde (CID), placa, agência de
 * 4 dígitos, número curto com a palavra-chave DEPOIS (`Nº 1234 do CRM`),
 * domínio sem caminho, link partido por quebra de linha, dado de terceiro em
 * e-mail encaminhado, e escrita feita de propósito para escapar (`12x34x56`,
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
// aspas retas), e o link pode começar em QUALQUER ponto dela: `Link:https://…`,
// `[aqui](https://…)`, `“https://…”` (aspas curvas do Word e do Outlook). Uma
// primeira versão olhava só o começo da palavra e deixava todos esses saírem
// inteiros, com o token (segunda rodada de revisões do #135). Do começo do
// link até o fim da palavra, tudo vira `[link]`.
//
// O lookbehind limita onde um link pode começar — nunca no meio de um nome
// ou número, e o domínio sem esquema nem depois de ponto ou `@`
// (`fulana@exemplo.test/x` não vira `fulana@[link]`) —, e todo
// quantificador tem teto: uma palavra de 200 mil caracteres custa uma passada.
//
// Domínio sem esquema precisa de caminho (`/`), porta ou consulta com `=`:
// `bem.Obrigado?` é frase sem espaço, não link. O que fica de fora, e está
// declarado: domínio nu (`exemplo.com.br`), `localhost:3000/…` e link partido
// por quebra de linha — o pedaço depois da quebra sai.
const PALAVRA = /[^\s<>"'`]+/gu
const LINK_NA_PALAVRA =
  /(?<![\p{L}\p{Nd}])(?:[a-z][a-z0-9+.-]{0,15}:\/\/|www\.)|(?<![\p{L}\p{Nd}+.@-])(?:[\p{L}\p{Nd}-]{1,63}\.){1,8}\p{L}{2,24}(?::\p{Nd}{1,5})?(?:\/|[?#][\p{L}\p{Nd}_.-]{1,64}=)/iu

// Parte local sem `%`, `,`, `;` e `:`. Com `%`, cada `%40` abria uma nova
// varredura (1,7 s em 200 mil caracteres); sem `,;`, dois endereços colados
// viravam um só, e o domínio do segundo vazava. O domínio é uma sequência de
// rótulos separados por ponto; como o rótulo não contém ponto, não há recuo.
const EMAIL =
  /[^\s@<>"'`()[\]%,;:]{1,64}(?:@|%40)(?:[\p{L}\p{Nd}_-]{1,63}\.){1,8}[\p{L}\p{Nd}-]{2,63}/giu

// Conselho profissional, e "matrícula" (a chave da própria associação, `A23`),
// com UF e até três palavras de ligação antes do número, nas grafias comuns:
// `CRM-SP 1234`, `CRMSP1234`, `CRM/SP nº 1.234`, `inscrita no CRM/SP sob o nº
// 1234`, `matrícula da associada: 4521`, `Conselho: CRM⏎Número: 1234`. O
// número aceita ponto e traço — `CRM 12.345-6` saía `CRM [número].345-6`.
//
// UF é a LISTA das 27 siglas, e não "duas letras": sob `i`, duas letras
// quaisquer casavam `de`, `do`, `em`, e "o CRM de 2 médicos" perdia o 2. Pelo
// mesmo motivo, quando há palavra de ligação no meio, o número precisa ter 3
// ou mais dígitos (ver `registroOuNao`): "registro de 3 dependentes" fica.
// `º` vira `°` ANTES do NFKC, que o transformaria em `o` — e `nº` ficaria
// igual à preposição `no` ("registro no 2º semestre").
//
// De fora, declarado: a ordem invertida (`Nº 1234 do CRM`).
const SEPARADOR_CURTO = String.raw`[^\p{L}\p{Nd}]{0,4}`
const CHAVE = String.raw`C\.?R\.?M\.?|CREME[A-Z]{1,2}|RQE|COREN|CRO|CRP|CRF|CRN|CREFITO|matr[ií]cula|registro|inscri[cç][aã]o`
const UF = String.raw`AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO`
const LIGACAO = String.raw`n[uú]mero|n\.?\s?°\.?|n\.|nr\.?|no\.|é|sob|o|a|da|do|de|SBP|associad[oa]|estado`
const REGISTRO = new RegExp(
  String.raw`(?<![\p{L}\p{Nd}])(${CHAVE})` +
    String.raw`((?:${SEPARADOR_CURTO}(?:${UF})(?!\p{L}))?)` +
    String.raw`((?:${SEPARADOR_CURTO}(?:${LIGACAO})(?!\p{L})){0,3})` +
    String.raw`(${SEPARADOR_CURTO})` +
    String.raw`(\p{Nd}(?:[.\-/ ]?\p{Nd}){0,9})`,
  'giu',
)

// Cinco ou mais dígitos, com até TRÊS separadores entre eles: `123 - 456 -
// 789 - 09` tem três, e saía inteiro com dois. Separador é tudo que não é
// letra, dígito nem quebra de linha — pega travessão, sinal de menos, ponto
// médio e espaço duro sem precisar listá-los. Quebra de linha fica de fora
// de propósito: juntaria colunas de tabela; o custo é um número partido entre
// duas linhas deixar até 4 dígitos à vista.
const NUMERO = /\+?\(?\p{Nd}(?:[^\p{L}\p{Nd}\n@<>[\]]{0,3}\p{Nd}){4,}\)?/gu

/**
 * Teto do texto NORMALIZADO, antes das máscaras.
 *
 * O NFKC pode multiplicar o texto: `ﷺ` vira 18 caracteres, e 200 mil deles
 * viravam 3,6 milhões para as expressões varrerem (meio segundo, segunda
 * rodada de revisões do #135). Dezesseis vezes o limite sobra para qualquer
 * texto que ainda caberia no corte final depois de mascarado. O corte cai no
 * último espaço antes do teto, para não deixar meia palavra — um número
 * partido ali, se ainda aparecesse, teria no máximo alguns dígitos.
 */
const MULTIPLO_DO_TETO = 16

function antesDoUltimoEspaco(texto: string): string {
  for (let i = texto.length - 1; i >= 0; i--) {
    if (/\s/u.test(texto[i]!)) return texto.slice(0, i)
  }
  return ''
}

/** "registro de 3 dependentes" não é registro: com ligação, só 3+ dígitos. */
function registroOuNao(
  chave: string,
  uf: string,
  ligacao: string,
  antes: string,
  numero: string,
): string | null {
  const digitos = numero.replace(/\P{Nd}/gu, '').length
  if (ligacao !== '' && digitos < 3) return null
  return `${chave}${uf}${ligacao}${antes}[número]`
}

export function protegerParaFornecedorExterno(
  texto: string,
  limite: number = LIMITE_PARA_FORNECEDOR_EXTERNO,
): TextoProtegido {
  const mascarados = { numero: 0, email: 0, link: 0 }

  // O teto vale duas vezes: antes do NFKC, para que ele nunca receba mais do
  // que o teto, e depois, porque ele pode ter multiplicado o que recebeu.
  const teto = limite * MULTIPLO_DO_TETO
  let passouDoTeto = texto.length > teto
  const cru = passouDoTeto ? antesDoUltimoEspaco(texto.slice(0, teto)) : texto
  let normalizado = cru.replaceAll('º', '°').normalize('NFKC').replace(INVISIVEL, '')
  if (normalizado.length > teto) {
    passouDoTeto = true
    normalizado = antesDoUltimoEspaco(normalizado.slice(0, teto))
  }

  const semDado = normalizado
    .replace(PALAVRA, (palavra) => {
      const achado = LINK_NA_PALAVRA.exec(palavra)
      if (!achado) return palavra
      mascarados.link += 1
      return `${palavra.slice(0, achado.index)}[link]`
    })
    .replace(EMAIL, () => {
      mascarados.email += 1
      return '[e-mail]'
    })
    .replace(REGISTRO, (inteiro, chave: string, uf: string, ligacao: string, antes: string, numero: string) => {
      const trocado = registroOuNao(chave, uf, ligacao, antes, numero)
      if (trocado === null) return inteiro
      mascarados.numero += 1
      return trocado
    })
    .replace(NUMERO, () => {
      mascarados.numero += 1
      return '[número]'
    })

  return {
    texto: truncar(semDado, limite),
    cortado: passouDoTeto || semDado.length > limite,
    mascarados,
  }
}
