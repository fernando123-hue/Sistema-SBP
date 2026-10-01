import { CAMPO_DA_LIGA, TAMANHO_MINIMO_CONFERIDO } from './conferencia-da-extracao'
import { dobrar } from './seguranca/dobra'

/**
 * O e-mail ao lado do que a IA leu, na Revisão (`DECISOES.md § A69`, 2A) —
 * domínio puro.
 *
 * Quem revisa via o valor que a IA extraiu e o selo "confira: nome", mas não o
 * e-mail: para conferir, abria a caixa do setor e procurava a mensagem à mão.
 * Aqui mora o que é regra nessa leitura: onde está o trecho duvidoso, e como o
 * texto chega à tela sem que o remetente controle o que a pessoa enxerga.
 *
 * ═══ O QUE ISTO NÃO FAZ ═══
 *
 * Decidir. O trecho marcado é uma ajuda para os olhos, não uma conferência: a
 * conferência que manda o item para a Revisão é `conferencia-da-extracao.ts`.
 * Não achar o trecho NÃO prova que o valor está fora do e-mail — a tela diz
 * "não consegui apontar", nunca "não está".
 */

/** O que a tela recebe ao pedir o e-mail de uma revisão. */
export type EmailDaRevisao =
  | {
      readonly situacao: 'disponivel'
      readonly remetente: string
      readonly assunto: string
      /** ISO 8601. */
      readonly recebidoEm: string
      /** Já passado por `textoParaExibir`. Texto, nunca HTML. */
      readonly corpo: string
      /** O campo que a revisão aponta, como a IA o escreveu; nulo se não aponta nenhum. */
      readonly campo: string | null
      /** Onde o valor desse campo está no `corpo`; nulo se não deu para apontar. */
      readonly trecho: TrechoMarcado | null
    }
  /** A retenção apagou o conteúdo (invariante 11). O item continua existindo. */
  | { readonly situacao: 'expurgado'; readonly expurgadoEm: string }
  /** Item registrado à mão: não há e-mail. */
  | { readonly situacao: 'sem_email' }

/** Intervalo `[inicio, fim)` em unidades UTF-16 do corpo. */
export interface TrechoMarcado {
  readonly inicio: number
  readonly fim: number
  /**
   * Quantas vezes o valor aparece, contando até `VEZES_CONTADAS`. A marca é
   * a PRIMEIRA: um remetente pode pôr o valor numa citação no topo, e a tela
   * precisa dizer que há outras para ninguém tomar a marca por confirmação.
   */
  readonly vezes: number
}

/** Acima disto a tela diz "várias vezes": o número exato não muda o que fazer. */
export const VEZES_CONTADAS = 10

/**
 * Formatação invisível (`\p{Cf}`): largura zero, hífen suave, U+FEFF, controles
 * de direção e os caracteres de tag (U+E0000 em diante). Invisíveis para quem
 * lê, e a IA recebe o texto com eles: quem revisa conferiria um e-mail
 * diferente do que o modelo leu, e um controle de direção faz a tela desenhar
 * "fdp.exe" como "exe.pdf" (revisão de segurança do #163).
 *
 * Trocados por U+FFFD, UMA unidade por unidade UTF-16 (o caractere de tag são
 * duas, e vira dois sinais): o tamanho do texto não muda, e o trecho calculado
 * sobre o original continua valendo no texto exibido. Por propriedade, e não
 * por lista: um caractere invisível colado no fonte some justamente para quem
 * revisa a lista (mesma regra de `seguranca/dobra.ts`).
 */
const FORMATACAO_INVISIVEL = /\p{Cf}/gu

/** O texto do remetente pronto para a tela: igual ao original, com a formatação invisível à vista. */
export function textoParaExibir(texto: string): string {
  return texto.replace(FORMATACAO_INVISIVEL, (caractere) => '\uFFFD'.repeat(caractere.length))
}

/**
 * Letras latinas junto de cirílicas ou gregas. No remetente, é o desenho de
 * quem se passa por outro endereço com um "о" cirílico; em nome de pessoa
 * brasileira, quase nunca é legítimo. A tela avisa; não decide nada.
 */
export function misturaAlfabetos(texto: string): boolean {
  return /\p{Script=Latin}/u.test(texto) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(texto)
}

/**
 * O valor que a revisão manda conferir: o do campo apontado, ou a liga citada.
 * Só chave PRÓPRIA: o nome do campo vem da IA, e "toString" acharia a função
 * herdada (mesma armadilha de `lerSugestao`, 2ª rodada do #150). Número vira
 * texto: um CPF gravado como número JSON não pode virar "não consegui apontar"
 * (revisão técnica do #163).
 */
export function valorProcurado(
  campo: string | null,
  sugestao: { readonly campos: Readonly<Record<string, unknown>>; readonly ligaMencionada: string | null },
): string | null {
  if (campo === null) return null
  const valor =
    campo === CAMPO_DA_LIGA
      ? sugestao.ligaMencionada
      : Object.hasOwn(sugestao.campos, campo)
        ? sugestao.campos[campo]
        : null
  const texto = typeof valor === 'number' && Number.isFinite(valor) ? String(valor) : valor
  return typeof texto === 'string' && texto.trim() !== '' ? texto : null
}

/**
 * Quantas ocorrências candidatas são examinadas antes de desistir. O texto é
 * do remetente: "a " repetido cem mil vezes, com um valor de "a a a … b", faria
 * a busca examinar cada posição. Desistir é devolver "não consegui apontar",
 * que a tela já diz com honestidade.
 */
const MAXIMO_DE_TENTATIVAS = 1_000

/**
 * Teto do texto DECOMPOSTO. O corpo tem até 200 mil caracteres, mas a forma de
 * compatibilidade multiplica: "ﷺ" vira 18 unidades, e 200 mil deles faziam a
 * procura levar quase 2 s de CPU síncrona, com o servidor parado para todo
 * mundo (revisão técnica do #163). O `normalize` nativo mede isso em
 * milissegundos, antes de qualquer laço. Passou, a procura desiste.
 */
const MAIOR_TEXTO_DECOMPOSTO = 400_000

/** Quantos números seguidos do texto podem formar o número do valor (CPF formatado são 4). */
const MAIOR_JUNCAO_DE_NUMEROS = 6

/** Entre dois grupos de um mesmo número formatado: ".", "-", ") ". Mais que isso, é outro número. */
const MAIOR_SEPARACAO_DE_GRUPOS = 3

/**
 * Onde o valor aparece no texto (a primeira vez, e quantas vezes), ou nulo.
 *
 * Duas procuras, a mesma regra de `conferencia-da-extracao.ts` em versão de
 * marcador:
 *
 *   - palavra por palavra, ignorando maiúsculas, acentos, pontuação e espaços
 *     repetidos, e sem cortar palavra ao meio ("Ana Souza" não marca dentro de
 *     "Mariana Souza");
 *   - número só pelos dígitos, juntando grupos próximos sem cortar nenhum
 *     ("12345678909" marca "123.456.789-09"; "1234567890" e "456789" não
 *     marcam nada, porque cortariam um número do texto).
 */
export function acharTrecho(texto: string, valor: string): TrechoMarcado | null {
  const alvo = normalizar(dobrar(valor).dobrado).texto.trim()
  if (alvo.replace(/[^\p{L}\p{Nd}]/gu, '').length < TAMANHO_MINIMO_CONFERIDO) return null
  if (texto.normalize('NFKD').length > MAIOR_TEXTO_DECOMPOSTO) return null

  const dobrado = dobrar(texto)
  const achados =
    procurarPorPalavra(dobrado.dobrado, alvo) ??
    (/^[\d ]+$/.test(alvo) ? procurarPorDigitos(dobrado.dobrado, alvo) : null)
  if (!achados) return null
  const [primeiro, vezes] = achados
  return { inicio: dobrado.inicio[primeiro.inicio]!, fim: dobrado.fim[primeiro.fim - 1]!, vezes }
}

/** Posições na forma dobrada. */
interface Intervalo {
  readonly inicio: number
  readonly fim: number
}

/**
 * A primeira ocorrência e quantas houve, até `VEZES_CONTADAS`, dentro do teto
 * de tentativas. Nenhuma: nulo.
 */
function contar(ocorrencias: Iterable<Intervalo>): [Intervalo, number] | null {
  let primeiro: Intervalo | null = null
  let vezes = 0
  for (const ocorrencia of ocorrencias) {
    primeiro ??= ocorrencia
    vezes += 1
    if (vezes >= VEZES_CONTADAS) break
  }
  return primeiro ? [primeiro, vezes] : null
}

interface Normalizado {
  readonly texto: string
  /** Para cada unidade de `texto`, a posição de origem na forma dobrada. */
  readonly origem: readonly number[]
}

/**
 * Minúsculas, e tudo que não é letra, dígito ou "@" vira um espaço só. Unidade
 * a unidade, para não perder o mapa de posições: a minúscula que muda de
 * tamanho ("İ") fica como veio.
 */
function normalizar(dobrado: string): Normalizado {
  // Lista e `join`, e não `texto +=` com `texto[texto.length - 1]`: ler o fim
  // de uma string montada aos pedaços a achata a cada leitura, e cem mil
  // pedaços custavam segundos.
  const partes: string[] = []
  const origem: number[] = []
  let ultimoFoiEspaco = true
  for (let i = 0; i < dobrado.length; i += 1) {
    const unidade = dobrado[i]!
    if (LETRA_DIGITO_OU_ARROBA.test(unidade)) {
      const minuscula = unidade.toLowerCase()
      partes.push(minuscula.length === 1 ? minuscula : unidade)
      origem.push(i)
      ultimoFoiEspaco = false
    } else if (!ultimoFoiEspaco) {
      partes.push(' ')
      origem.push(i)
      ultimoFoiEspaco = true
    }
  }
  return { texto: partes.join(''), origem }
}

const LETRA_DIGITO_OU_ARROBA = /[\p{L}\p{Nd}@]/u

function procurarPorPalavra(dobrado: string, alvo: string): [Intervalo, number] | null {
  const { texto, origem } = normalizar(dobrado)
  function* ocorrencias(): Generator<Intervalo> {
    let de = 0
    for (let tentativa = 0; tentativa < MAXIMO_DE_TENTATIVAS; tentativa += 1) {
      const posicao = texto.indexOf(alvo, de)
      if (posicao < 0) return
      de = posicao + 1
      const fim = posicao + alvo.length
      const comecaInteiro = posicao === 0 || texto[posicao - 1] === ' '
      const terminaInteiro = fim === texto.length || texto[fim] === ' '
      if (comecaInteiro && terminaInteiro) yield { inicio: origem[posicao]!, fim: origem[fim - 1]! + 1 }
    }
  }
  return contar(ocorrencias())
}

function procurarPorDigitos(dobrado: string, alvo: string): [Intervalo, number] | null {
  const procurado = alvo.replace(/ /g, '')
  const posicoes: number[] = []
  const partes: string[] = []
  for (let i = 0; i < dobrado.length; i += 1) {
    const unidade = dobrado[i]!
    if (unidade >= '0' && unidade <= '9') {
      partes.push(unidade)
      posicoes.push(i)
    }
  }
  const digitos = partes.join('')
  /** Os dois dígitos são do mesmo número formatado: colados, ou separados por ".", "-", ") ". */
  const mesmoNumero = (a: number, b: number) => posicoes[b]! - posicoes[a]! - 1 <= MAIOR_SEPARACAO_DE_GRUPOS

  function* ocorrencias(): Generator<Intervalo> {
    let de = 0
    for (let tentativa = 0; tentativa < MAXIMO_DE_TENTATIVAS; tentativa += 1) {
      const k = digitos.indexOf(procurado, de)
      if (k < 0) return
      de = k + 1
      const ultimo = k + procurado.length - 1
      // Não corta número: o dígito antes e o depois têm de estar LONGE, e não
      // só fora do grupo. Com "colado" apenas, "456789" marcava "456.789",
      // um pedaço do CPF "123.456.789-09" (revisão técnica do #163).
      if (k > 0 && mesmoNumero(k - 1, k)) continue
      if (ultimo + 1 < posicoes.length && mesmoNumero(ultimo, ultimo + 1)) continue
      // Grupos próximos, e poucos: "123, … bem depois 456" não é "123456".
      let grupos = 1
      let perto = true
      for (let j = k + 1; j <= ultimo; j += 1) {
        if (posicoes[j]! - posicoes[j - 1]! === 1) continue
        grupos += 1
        if (!mesmoNumero(j - 1, j) || grupos > MAIOR_JUNCAO_DE_NUMEROS) {
          perto = false
          break
        }
      }
      if (perto) yield { inicio: posicoes[k]!, fim: posicoes[ultimo]! + 1 }
    }
  }
  return contar(ocorrencias())
}
