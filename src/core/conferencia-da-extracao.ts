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
 * critério aprovado: "Silva," no texto é "Silva" no valor.
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
 * folga e põe teto no custo — uma lista de mil números separados por espaço
 * não vira um milhão de junções.
 */
const MAIOR_JUNCAO_DE_NUMEROS = 6

interface Atomo {
  readonly digitos: boolean
  readonly valor: string
}

/**
 * Palavras e números, sem acento e em minúsculas. NFKD também desfaz a forma
 * de compatibilidade: dígito de largura cheia vira dígito comum.
 */
function atomos(texto: string): Atomo[] {
  const forma = texto.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  const lista: Atomo[] = []
  for (const achado of forma.matchAll(/\p{L}+|\p{Nd}+/gu)) {
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
 * O texto do e-mail preparado uma vez para conferir todos os valores dele.
 * Opaco para quem chama: a forma interna pode mudar sem mexer nos serviços.
 */
export interface TextoParaConferir {
  readonly atomos: readonly Atomo[]
  /** Onde cada palavra aparece — o ponto de partida de um valor que começa por palavra. */
  readonly porPalavra: ReadonlyMap<string, readonly number[]>
  readonly posicoesDeNumero: readonly number[]
}

export function prepararTextoParaConferir(texto: string): TextoParaConferir {
  const lista = atomos(texto)
  const porPalavra = new Map<string, number[]>()
  const posicoesDeNumero: number[] = []
  lista.forEach((atomo, posicao) => {
    if (atomo.digitos) {
      posicoesDeNumero.push(posicao)
      return
    }
    const posicoes = porPalavra.get(atomo.valor)
    if (posicoes) posicoes.push(posicao)
    else porPalavra.set(atomo.valor, [posicao])
  })
  return { atomos: lista, porPalavra, posicoesDeNumero }
}

/** O valor casa a partir do átomo `i` do texto? Laço, não recursão: um valor longo não estoura a pilha. */
function casaAPartirDe(texto: readonly Atomo[], valor: readonly Atomo[], inicio: number): boolean {
  // Pilha explícita de (posição no texto, posição no valor) — o número pode
  // casar juntando 1, 2… grupos, e só o resto do valor diz qual serve.
  const pendentes: [number, number][] = [[inicio, 0]]
  while (pendentes.length > 0) {
    const [i, k] = pendentes.pop()!
    if (k === valor.length) return true
    const alvo = valor[k]!
    if (!alvo.digitos) {
      const atual = texto[i]
      if (atual && !atual.digitos && atual.valor === alvo.valor) pendentes.push([i + 1, k + 1])
      continue
    }
    let junto = ''
    for (let n = 0; n < MAIOR_JUNCAO_DE_NUMEROS; n += 1) {
      const atual = texto[i + n]
      if (!atual?.digitos) break
      junto += atual.valor
      if (!alvo.valor.startsWith(junto)) break
      if (junto.length === alvo.valor.length) {
        pendentes.push([i + n + 1, k + 1])
        break
      }
    }
  }
  return false
}

/** O valor aparece no texto? Valor curto demais conta como "aparece": não há o que provar. */
export function valorEstaNoTexto(texto: TextoParaConferir, valor: string): boolean {
  const alvo = atomosDoValor(valor)
  const tamanho = alvo.reduce((total, atomo) => total + atomo.valor.length, 0)
  if (tamanho < TAMANHO_MINIMO_CONFERIDO) return true

  const primeiro = alvo[0]!
  const inicios = primeiro.digitos
    ? texto.posicoesDeNumero.filter((posicao) => primeiro.valor.startsWith(texto.atomos[posicao]!.valor))
    : (texto.porPalavra.get(primeiro.valor) ?? [])
  return inicios.some((inicio) => casaAPartirDe(texto.atomos, alvo, inicio))
}

/**
 * O primeiro problema do que a IA extraiu para UM item, ou `null`.
 *
 * Ordem: CPF que não confere vem antes de valor fora do texto — um CPF com
 * dígito errado copiado LITERALMENTE do e-mail (quem escreveu errou) também
 * precisa de uma pessoa (`A40`, resposta 26), e o motivo certo para ela é
 * "o CPF não confere", não "o valor não está no e-mail".
 *
 * A liga mencionada entra na conferência de texto: ela vira IDENTIDADE
 * (`resolverLiga`), e uma liga inventada nasceria no banco.
 */
export function conferirExtracao(
  texto: TextoParaConferir,
  campos: Readonly<Record<string, string>>,
  ligaMencionada: string | null = null,
): ProblemaNaExtracao | null {
  for (const [campo, valor] of Object.entries(campos)) {
    if (nomeDeCampoGravavel(campo) === 'cpf' && normalizarCpf(valor) === null) {
      return { motivo: 'cpf_invalido', campo }
    }
  }
  for (const [campo, valor] of Object.entries(campos)) {
    if (!valorEstaNoTexto(texto, valor)) return { motivo: 'valor_fora_do_texto', campo }
  }
  if (ligaMencionada !== null && !valorEstaNoTexto(texto, ligaMencionada)) {
    return { motivo: 'valor_fora_do_texto', campo: 'liga' }
  }
  return null
}
