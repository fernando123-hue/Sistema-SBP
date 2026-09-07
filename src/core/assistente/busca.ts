import type { VerbeteDoManual } from './conhecimento'

/**
 * Busca no manual por termos — domínio puro, sem modelo e sem rede.
 *
 * ═══ PARA QUE ISTO EXISTE ═══
 *
 * Duas coisas, e a segunda é a que importa.
 *
 * A primeira: é o assistente que roda com `IA_ADAPTER=mock`, que é o padrão do
 * sistema. Sem ela, o painel de ajuda ficaria morto em desenvolvimento, em
 * teste e em qualquer instalação que não queira pagar por modelo — e recurso
 * que só funciona com chave configurada é recurso que ninguém experimenta.
 *
 * A segunda: é o CHÃO da funcionalidade. Se o modelo estiver fora do ar, se a
 * cota estourar, se a chave for revogada, a ajuda continua respondendo — pior,
 * mas honestamente pior, e dizendo qual das duas respondeu. É o oposto de
 * degradar em silêncio: a tela mostra a origem da resposta, e a pessoa sabe se
 * está falando com o modelo ou com a busca.
 *
 * Não é um stub que devolve texto falso: o texto que ela devolve é o mesmo
 * texto do manual que iria para o modelo. O que muda é que aqui ninguém
 * reescreve nada — a resposta é o verbete, não uma paráfrase dele.
 */

/**
 * Palavras curtas e conectivos, que casariam com tudo.
 *
 * Sem esta lista, "o que é a fila" dá pontuação a todo verbete que contenha
 * "que" — ou seja, a todos — e a busca devolve sempre o primeiro.
 */
const VAZIAS = new Set([
  'a', 'as', 'o', 'os', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos',
  'nas', 'por', 'para', 'pra', 'com', 'sem', 'que', 'quem', 'qual', 'quais', 'como', 'quando',
  'onde', 'porque', 'por que', 'e', 'ou', 'se', 'ao', 'aos', 'à', 'às', 'meu', 'minha', 'meus',
  'minhas', 'seu', 'sua', 'eu', 'voce', 'você', 'isso', 'esse', 'essa', 'este', 'esta', 'é',
  'ser', 'sao', 'são', 'tem', 'ter', 'fazer', 'faz', 'faço', 'posso', 'pode', 'devo', 'deve',
  'nao', 'não', 'sim', 'mais', 'menos', 'muito', 'ja', 'já', 'aqui', 'ali', 'la', 'lá',
])

/**
 * Menor pontuação que ainda conta como resposta.
 *
 * Vale 3 porque é o peso de UM acerto no título: abaixo disso, o que houve foi
 * duas palavras comuns coincidindo no meio de um texto longo, e responder com
 * o verbete errado é pior que dizer "não sei". Medido na tela: "como destravo a
 * conta bloqueada de um colega" casava com o verbete do RATEIO, por causa de
 * "conta" (a conta da divisão) e "colegas" — e o assistente respondia com ar de
 * quem sabia, sobre outro assunto.
 */
const PONTUACAO_MINIMA = 3

/**
 * Quantos caracteres de cada palavra entram na comparação.
 *
 * Um radical curto, não a palavra inteira. Quem pergunta escreve "destravo" e o
 * manual diz "destravar"; escreve "revisão" e o manual diz "revisar". Comparar
 * as formas completas erra justamente nos VERBOS, que são como as pessoas
 * descrevem o que querem fazer.
 *
 * Seis é o ponto em que os finais de conjugação já caíram e as palavras ainda
 * se distinguem: `destravo`/`destravar` viram `destra`, enquanto `conta` (5,
 * inalterada) continua diferente de `contagem` → `contag`. Cortar mais juntaria
 * palavras que significam coisas distintas.
 */
const TAMANHO_DO_RADICAL = 6

function radical(palavra: string): string {
  return palavra.slice(0, TAMANHO_DO_RADICAL)
}

/** Radicais das palavras de um texto. Comparação é palavra a palavra, nunca por
 * substring solta: `includes('conta')` casaria dentro de `contagem`. */
function radicaisDe(texto: string): Set<string> {
  return new Set(
    normalizar(texto)
      .split(/\s+/)
      .filter((palavra) => palavra.length >= 3)
      .map(radical),
  )
}

/**
 * Tira acento e pontuação.
 *
 * Quem digita com pressa escreve "revisao" e "afastamento" sem acento, e o
 * verbete está acentuado. Comparar as duas formas cruas erraria justamente nas
 * palavras do domínio, que são as que mais importam.
 */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
}

function termosDe(texto: string): string[] {
  return normalizar(texto)
    .split(/\s+/)
    .filter((termo) => termo.length >= 3 && !VAZIAS.has(termo))
}

export interface AchadoNoManual {
  readonly verbete: VerbeteDoManual
  readonly pontuacao: number
}

/**
 * Os verbetes mais próximos da pergunta, do melhor para o pior.
 *
 * Pontuação: título vale mais que corpo, porque quem pergunta "como distribuo"
 * está nomeando o assunto do verbete, não citando uma frase dele. Termo
 * repetido no corpo não acumula — senão o verbete mais LONGO venceria sempre,
 * que é o defeito clássico de contagem crua.
 */
export function buscarNoManual(
  pergunta: string,
  verbetes: readonly VerbeteDoManual[],
): readonly AchadoNoManual[] {
  const termos = termosDe(pergunta)
  if (termos.length === 0) return []

  // `id` entra junto do título porque ele é escrito como assunto
  // (`como-distribuir`, `devolver-e-transferir`) e é exatamente o vocabulário
  // que a pergunta usa.
  const buscados = termos.map(radical)

  return verbetes
    .map((verbete) => {
      const titulo = radicaisDe(`${verbete.id.replaceAll('-', ' ')} ${verbete.titulo}`)
      const corpo = radicaisDe(verbete.texto)

      const pontuacao = buscados.reduce((total, termo) => {
        if (titulo.has(termo)) return total + 3
        if (corpo.has(termo)) return total + 1
        return total
      }, 0)

      return { verbete, pontuacao }
    })
    .filter((achado) => achado.pontuacao >= PONTUACAO_MINIMA)
    .sort((a, b) => b.pontuacao - a.pontuacao)
}
