import { normalizarCpf } from './chave-de-busca'
import { nomeDeCampoGravavel } from './nome-de-campo'

/**
 * Conferência do que a IA extraiu, contra o texto do e-mail — domínio puro
 * (pendência 17, `DECISOES.md § H.4` item 40).
 *
 * ═══ O PROBLEMA ═══
 *
 * O prompt manda extrair "apenas o que estiver LITERALMENTE no texto", e nada
 * conferia isso depois. O modelo local escolhido tem literalidade 0,69 no
 * gabarito (`A59`): reescreve em vez de copiar. Um nome reescrito, um CPF com
 * um dígito a menos, com confiança acima do limiar, entravam APROVADOS — e o
 * item ia para a fila de alguém com o dado errado. A confiança é a própria IA
 * que dá; ela não prova nada sobre o valor.
 *
 * ═══ A REGRA (aprovada pelo dono em 29/09/2026) ═══
 *
 * O valor precisa aparecer no e-mail ignorando maiúsculas, espaços e acentos;
 * número se compara só pelos dígitos. Concretamente, os dois lados viram uma
 * sequência de "átomos" — palavras e números, sem acento, em minúsculas, com
 * pontuação e espaço descartados — e o valor precisa ser uma sequência
 * CONTÍGUA de átomos do texto:
 *
 *   - palavra casa com palavra INTEIRA: "Ana Souza" não passa dentro de
 *     "Mariana Souza" (um "includes" de texto deixaria passar, e é justamente
 *     a reescrita que se quer pegar);
 *   - número casa com um ou mais números SEGUIDOS do texto, juntos por
 *     inteiro: "12345678909" casa com "123.456.789-09" e "11987654321" com
 *     "(11) 98765-4321" — mas "1234567890", o CPF sem o último dígito, não
 *     casa com nada, porque cortaria um grupo ao meio.
 *
 * A pontuação é tratada como espaço, e isto vai um passo além da letra do
 * critério aprovado: "Silva," no texto é "Silva" no valor. E um passo mais
 * apertado: "ignorar espaços" vira "palavra por palavra", então "MariaSouza"
 * e "Maria Souza" não casam — é o preço de barrar "Ana Souza" dentro de
 * "Mariana Souza". Endereço de e-mail é exceção: comparado inteiro.
 *
 * ═══ O QUE ELA NÃO FAZ ═══
 *
 * Decidir. Devolve o PRIMEIRO problema achado, e quem chama manda o item para
 * a Revisão com esse motivo. Não corrige o valor, não escolhe outro trecho do
 * texto, não descarta o item: quem revisa vê a sugestão da IA e decide.
 */

export type MotivoDaConferencia = 'cpf_invalido' | 'valor_fora_do_texto'

export interface ProblemaNaExtracao {
  readonly motivo: MotivoDaConferencia
  /** O nome do campo como a IA o escreveu, ou `liga` para a liga mencionada. */
  readonly campo: string
}

/**
 * Abaixo disto, "estar no e-mail" não prova nada: "de" e "da" estão em
 * qualquer texto. O valor curto não é conferido — nem acusado. Mesmo corte do
 * gabarito (`core/avaliacao/gabarito.ts`), contado em letras e dígitos.
 */
export const TAMANHO_MINIMO_CONFERIDO = 3

/**
 * Quantos números seguidos do texto podem se juntar para casar com um número
 * do valor. CPF formatado são 4 grupos, telefone com DDD até 4, data 3; 6 dá
 * folga e põe teto no custo.
 */
const MAIOR_JUNCAO_DE_NUMEROS = 6

/**
 * Quanto trabalho a conferência pode fazer por e-mail, em comparações de átomo.
 *
 * O texto é do remetente. "1 " repetido cem mil vezes, com uma lista de
 * pessoas que a IA desdobra sozinha, levava dezenas de segundos de CPU
 * síncrona e parava o servidor para todo mundo (revisões do #150). Dois
 * milhões de passos são dezenas de milissegundos. Estourou, o valor conta como
 * NÃO achado e o item vai para uma pessoa: falha fechada, nunca aprovação.
 */
export const PASSOS_POR_EMAIL = 2_000_000

interface Atomo {
  readonly digitos: boolean
  readonly valor: string
}

/**
 * Sem acento, sem forma de compatibilidade, e em minúsculas que dobram de
 * verdade. A caixa vem ANTES de tirar os acentos: "ẞ" só vira "ss" passando
 * por minúscula e maiúscula ("ẞ" → "ß" → "SS"), e "İ" em minúscula traz um
 * ponto combinante que a limpeza de acentos precisa ver depois (2ª rodada do
 * #150). A minúscula do fim é porque a forma de compatibilidade pode devolver
 * maiúscula ("ᴬ" → "A"). O "°" (grau) escrito no lugar do "º" (ordinal) vira
 * "o": no teclado, são o mesmo gesto.
 */
function dobrar(texto: string): string {
  return texto
    .toLowerCase()
    .toUpperCase()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/°/g, 'o')
    .toLowerCase()
}

/** Palavras e números. */
function atomos(texto: string): Atomo[] {
  const lista: Atomo[] = []
  for (const achado of dobrar(texto).matchAll(/\p{L}+|\p{Nd}+/gu)) {
    lista.push({ digitos: /^\p{Nd}/u.test(achado[0]), valor: achado[0] })
  }
  return lista
}

/** Números seguidos no VALOR viram um só: "123.456.789-09" é "12345678909". */
function atomosDoValor(valor: string): Atomo[] {
  const juntos: Atomo[] = []
  for (const atomo of atomos(valor)) {
    const anterior = juntos.at(-1)
    if (atomo.digitos && anterior?.digitos) {
      juntos[juntos.length - 1] = { digitos: true, valor: anterior.valor + atomo.valor }
    } else {
      juntos.push(atomo)
    }
  }
  return juntos
}

/**
 * Endereço de e-mail é comparado INTEIRO, com a pontuação dele. Tratando
 * pontuação como espaço, "ana@souza.exemplo.test" casava com
 * "ana.souza@exemplo.test" — outro endereço, e alguém vai responder para ele
 * (revisão técnica do #150).
 *
 * Os endereços saem por SEPARAÇÃO, e não por uma expressão `[^…]+@[^…]+`:
 * aquela voltava atrás a cada posição de um trecho longo sem `@`, e 200 mil
 * letras seguidas levavam 45 s, fora de qualquer orçamento (2ª rodada do
 * #150). Separar é linear.
 */
const SEPARADOR_DE_ENDERECO = /[\s<>()[\],;:"'`“”«»‘’/|!?]+/u

const LETRA_OU_DIGITO = /[\p{L}\p{Nd}]/u

/**
 * Tira das pontas o que não é letra nem dígito (o ponto final da frase).
 * Por laço, e não por `[^…]+$`: essa expressão volta atrás em cada ponto de
 * "a.....a" e fica quadrática no pedaço que o remetente escolher.
 */
function limparEndereco(endereco: string): string {
  let inicio = 0
  let fim = endereco.length
  while (inicio < fim && !LETRA_OU_DIGITO.test(endereco[inicio]!)) inicio += 1
  while (fim > inicio && !LETRA_OU_DIGITO.test(endereco[fim - 1]!)) fim -= 1
  return endereco.slice(inicio, fim)
}

/** Os pedaços com cara de endereço: algo antes e algo depois do `@`. */
function enderecosEm(textoDobrado: string): string[] {
  return textoDobrado
    .split(SEPARADOR_DE_ENDERECO)
    .map(limparEndereco)
    .filter((pedaco) => /^[^@]+@[^@]+$/u.test(pedaco))
}

/**
 * O texto do e-mail preparado uma vez para conferir todos os valores dele.
 * Carrega o orçamento de passos e a memória do e-mail: é por e-mail.
 */
export interface TextoParaConferir {
  readonly atomos: readonly Atomo[]
  /** Onde cada palavra aparece — o ponto de partida de um valor que começa por palavra. */
  readonly porPalavra: ReadonlyMap<string, readonly number[]>
  /** Onde cada número aparece, pelo valor dele. */
  readonly porNumero: ReadonlyMap<string, readonly number[]>
  readonly enderecos: ReadonlySet<string>
  /** Resultado por valor já conferido neste e-mail: listas repetem valores. */
  readonly memoria: Map<string, boolean>
  orcamento: number
}

export function prepararTextoParaConferir(texto: string): TextoParaConferir {
  const lista = atomos(texto)
  const porPalavra = new Map<string, number[]>()
  const porNumero = new Map<string, number[]>()
  lista.forEach((atomo, posicao) => {
    const indice = atomo.digitos ? porNumero : porPalavra
    const posicoes = indice.get(atomo.valor)
    if (posicoes) posicoes.push(posicao)
    else indice.set(atomo.valor, [posicao])
  })
  const enderecos = new Set(enderecosEm(dobrar(texto)))
  return { atomos: lista, porPalavra, porNumero, enderecos, memoria: new Map(), orcamento: PASSOS_POR_EMAIL }
}

/**
 * O valor casa a partir do átomo `inicio` do texto? Cada comparação gasta um
 * passo do orçamento; sem orçamento, "não casa".
 *
 * Linear: o número do valor casa com UMA junção de números seguidos do texto
 * — a que tem o mesmo comprimento —, então não há escolha a explorar.
 */
function casaAPartirDe(texto: TextoParaConferir, valor: readonly Atomo[], inicio: number): boolean {
  let i = inicio
  for (const alvo of valor) {
    if (!alvo.digitos) {
      texto.orcamento -= 1
      const atual = texto.atomos[i]
      if (texto.orcamento < 0 || !atual || atual.digitos || atual.valor !== alvo.valor) return false
      i += 1
      continue
    }
    let junto = ''
    let casou = false
    for (let n = 0; n < MAIOR_JUNCAO_DE_NUMEROS; n += 1) {
      texto.orcamento -= 1
      const atual = texto.atomos[i + n]
      if (texto.orcamento < 0 || !atual?.digitos) break
      junto += atual.valor
      if (!alvo.valor.startsWith(junto)) break
      if (junto.length === alvo.valor.length) {
        i += n + 1
        casou = true
        break
      }
    }
    if (!casou) return false
  }
  return true
}

/**
 * Onde um valor pode começar: as posições da primeira palavra, ou as do número
 * que é começo do primeiro número do valor ("111" em "111.444.777-35").
 * Gerador, e não lista: com cem mil "1" no texto, copiar as posições para
 * cada valor já custava segundos, fora do orçamento (revisões do #150).
 */
function* inicios(texto: TextoParaConferir, primeiro: Atomo): Generator<number> {
  if (!primeiro.digitos) {
    yield* texto.porPalavra.get(primeiro.valor) ?? []
    return
  }
  for (let tamanho = 1; tamanho <= primeiro.valor.length; tamanho += 1) {
    yield* texto.porNumero.get(primeiro.valor.slice(0, tamanho)) ?? []
  }
}

/** O valor aparece no texto? Valor curto demais conta como "aparece": não há o que provar. */
export function valorEstaNoTexto(texto: TextoParaConferir, valor: string): boolean {
  const lembrado = texto.memoria.get(valor)
  if (lembrado !== undefined) return lembrado
  const resultado = conferirValor(texto, valor)
  texto.memoria.set(valor, resultado)
  return resultado
}

function conferirValor(texto: TextoParaConferir, valor: string): boolean {
  if (texto.orcamento < 0) return false
  // O endereço dentro do valor tem de estar no texto inteiro, e o resto do
  // valor ("Ana Souza <ana@…>", "mailto:") passa pela conferência de átomos.
  // "@perfil" sem nada antes não é endereço: vai pelos átomos.
  const dobrado = dobrar(valor)
  const enderecos = enderecosEm(dobrado)
  if (enderecos.some((endereco) => !texto.enderecos.has(endereco))) return false
  let resto = valor
  if (enderecos.length > 0) {
    resto = dobrado
      .split(SEPARADOR_DE_ENDERECO)
      .filter((pedaco) => !/^[^@]+@[^@]+$/u.test(limparEndereco(pedaco)))
      .join(' ')
      .replace(/\bmailto\b/gu, ' ')
  }

  const alvo = atomosDoValor(resto)
  const tamanho = alvo.reduce((total, atomo) => total + atomo.valor.length, 0)
  if (tamanho < TAMANHO_MINIMO_CONFERIDO) return true

  for (const inicio of inicios(texto, alvo[0]!)) {
    // Cada início tentado custa um passo, mesmo o que falha na primeira
    // comparação: é o que dá teto a "cem mil lugares onde poderia começar".
    texto.orcamento -= 1
    if (texto.orcamento < 0) return false
    if (casaAPartirDe(texto, alvo, inicio)) return true
  }
  return false
}

/**
 * O nome do "campo" quando é a liga citada que não bate. Não é `liga`: um
 * campo da IA com a chave `liga` colidiria com ele (2ª rodada do #150).
 */
export const CAMPO_DA_LIGA = 'liga citada'

/**
 * A liga citada está no texto? Conferida SEMPRE, à parte do primeiro
 * problema: se outro campo falhasse antes, a liga inventada seguia para
 * `resolverLiga` e nascia no banco (2ª rodada do #150). Sem liga, `true`.
 */
export function ligaEstaNoTexto(texto: TextoParaConferir, ligaMencionada: string | null): boolean {
  return ligaMencionada === null || valorEstaNoTexto(texto, ligaMencionada)
}

/**
 * O primeiro problema do que a IA extraiu para UM item, ou `null`.
 *
 * Ordem: CPF que não confere vem antes de valor fora do texto — um CPF com
 * dígito errado copiado LITERALMENTE do e-mail (quem escreveu errou) também
 * precisa de uma pessoa (`A40`, resposta 26), e o motivo certo para ela é
 * "o CPF não confere", não "o valor não está no e-mail". Um "CPF" sem nenhum
 * dígito ("não informado") não é tentativa de CPF: a conferência de texto
 * cuida dele (revisão técnica do #150).
 *
 * A liga mencionada entra na conferência de texto: ela vira IDENTIDADE
 * (`resolverLiga`), e a ingestão não liga o item a uma liga que o e-mail não
 * cita.
 *
 * O que ela prova é "aparece no texto", não "está completo nem é o certo":
 * "(11) 98765" passa com "(11) 98765-4321" no e-mail, e um CPF de outra pessoa
 * citada no texto também passa. Não é controle contra injeção — contra ela
 * valem a suspeita e a Revisão (revisões do #150).
 */
export function conferirExtracao(
  texto: TextoParaConferir,
  campos: Readonly<Record<string, string>>,
  ligaMencionada: string | null,
): ProblemaNaExtracao | null {
  for (const [campo, valor] of Object.entries(campos)) {
    if (nomeDeCampoGravavel(campo) === 'cpf' && /\d/.test(valor) && normalizarCpf(valor) === null) {
      return { motivo: 'cpf_invalido', campo }
    }
  }
  for (const [campo, valor] of Object.entries(campos)) {
    if (!valorEstaNoTexto(texto, valor)) return { motivo: 'valor_fora_do_texto', campo }
  }
  if (!ligaEstaNoTexto(texto, ligaMencionada)) return { motivo: 'valor_fora_do_texto', campo: CAMPO_DA_LIGA }
  return null
}
