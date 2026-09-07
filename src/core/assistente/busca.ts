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

/** Menor pontuação que ainda conta como resposta. Abaixo disto, dizemos que não sabemos. */
const PONTUACAO_MINIMA = 2

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

  return verbetes
    .map((verbete) => {
      const titulo = normalizar(`${verbete.id} ${verbete.titulo}`)
      const corpo = normalizar(verbete.texto)

      const pontuacao = termos.reduce((total, termo) => {
        if (titulo.includes(termo)) return total + 3
        if (corpo.includes(termo)) return total + 1
        return total
      }, 0)

      return { verbete, pontuacao }
    })
    .filter((achado) => achado.pontuacao >= PONTUACAO_MINIMA)
    .sort((a, b) => b.pontuacao - a.pontuacao)
}
