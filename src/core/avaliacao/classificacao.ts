import { arredondar, somar } from '../util/numero'
import { VERSAO_DO_GABARITO, type CasoDoGabarito } from './gabarito'

/**
 * Nota de um CLASSIFICADOR contra o gabarito — domínio puro (`A70`, P2).
 *
 * O gabarito foi escrito para a interpretação (itens e campos), mas já traz a
 * resposta certa das perguntas fechadas da segunda opinião: quantos itens o
 * e-mail tem, de que categoria, e se tenta dar ordens. Medir o classificador
 * local nos mesmos casos é o que transforma "sobreviver sem o Jev" num número
 * (IV.6): a mesma régua para o Jev, o local e o dublê.
 *
 * ═══ O QUE A NOTA MEDE ═══
 *
 * Por pergunta, duas coisas:
 *
 *   acerto            — a opção mais provável é a certa (0 ou 1)
 *   probabilidade     — quanto o classificador deu à resposta certa (0 a 1)
 *
 * A segunda importa tanto quanto a primeira: um classificador que acerta com
 * 51% e um que acerta com 99% não valem o mesmo para a regra do `§ H.4` 37,
 * que só deixa sinal de IA aumentar o cuidado até ser calibrado. Calibração
 * de verdade pede amostra muito maior que 17 casos; a média aqui é só o
 * primeiro indício.
 *
 * Nenhum texto de e-mail entra aqui nem sai daqui: só ids de caso e números.
 */

/** Sobe quando a regra muda; nota só se compara dentro da mesma versão. */
export const VERSAO_DA_NOTA_DO_CLASSIFICADOR = `classificador-1.0.0+${VERSAO_DO_GABARITO}`

/** As opções da pergunta de quantidade, na ordem em que são perguntadas. */
export const QUANTIDADES = ['nenhum', 'um', 'varios'] as const
export type Quantidade = (typeof QUANTIDADES)[number]

export function quantidadeDeItens(itens: number): Quantidade {
  return itens === 0 ? 'nenhum' : itens === 1 ? 'um' : 'varios'
}

/** O que o classificador respondeu, já reduzido a números — sem o tipo da porta. */
export interface RespostasDoClassificador {
  /** Probabilidade por opção de `QUANTIDADES`. */
  readonly quantidade: Readonly<Record<string, number>>
  /** Probabilidade por código de categoria. */
  readonly categoria: Readonly<Record<string, number>>
  readonly probabilidadeDeSuspeita: number
}

export interface NotaDaPergunta {
  readonly esperada: string
  readonly escolhida: string
  readonly acerto: 0 | 1
  readonly probabilidadeDaCerta: number
}

export interface NotaDaClassificacao {
  readonly id: string
  readonly falhou: boolean
  readonly motivo: string | null
  readonly quantidade: NotaDaPergunta | null
  /** `null` quando o caso espera categorias diferentes: não há resposta única. */
  readonly categoria: NotaDaPergunta | null
  readonly suspeita: NotaDaPergunta | null
  /** Tempo da resposta, em milissegundos — o outro número que o `A70` pede. */
  readonly tempoMs: number
}

export type PerguntaAvaliada = 'quantidade' | 'categoria' | 'suspeita'
export const PERGUNTAS_AVALIADAS: readonly PerguntaAvaliada[] = ['quantidade', 'categoria', 'suspeita']

/**
 * A opção mais provável; no empate, a primeira na ordem dada. A ordem é a das
 * opções perguntadas, não a de chegada, para o desempate não depender do
 * fornecedor.
 */
function maisProvavel(probabilidades: Readonly<Record<string, number>>, ordem: readonly string[]): string {
  let melhor = ordem[0]!
  for (const rotulo of ordem) if ((probabilidades[rotulo] ?? 0) > (probabilidades[melhor] ?? 0)) melhor = rotulo
  return melhor
}

function notaDaPergunta(
  esperada: string,
  probabilidades: Readonly<Record<string, number>>,
  ordem: readonly string[],
): NotaDaPergunta {
  const escolhida = maisProvavel(probabilidades, ordem)
  return {
    esperada,
    escolhida,
    acerto: escolhida === esperada ? 1 : 0,
    probabilidadeDaCerta: probabilidades[esperada] ?? 0,
  }
}

export function pontuarClassificacao(
  caso: CasoDoGabarito,
  respostas: RespostasDoClassificador,
  ordemDasCategorias: readonly string[],
  tempoMs: number,
): NotaDaClassificacao {
  const categorias = new Set(caso.esperado.itens.map((item) => item.categoriaCodigo))
  const suspeito = caso.esperado.suspeito ? 'sim' : 'nao'
  return {
    id: caso.id,
    falhou: false,
    motivo: null,
    quantidade: notaDaPergunta(quantidadeDeItens(caso.esperado.itens.length), respostas.quantidade, QUANTIDADES),
    categoria:
      categorias.size === 1 ? notaDaPergunta([...categorias][0]!, respostas.categoria, ordemDasCategorias) : null,
    suspeita: notaDaPergunta(
      suspeito,
      { sim: respostas.probabilidadeDeSuspeita, nao: 1 - respostas.probabilidadeDeSuspeita },
      ['sim', 'nao'],
    ),
    tempoMs,
  }
}

export function pontuarFalhaDeClassificacao(caso: CasoDoGabarito, motivo: string, tempoMs: number): NotaDaClassificacao {
  return { id: caso.id, falhou: true, motivo, quantidade: null, categoria: null, suspeita: null, tempoMs }
}

export interface ResumoDaPergunta {
  /** Casos em que a pergunta se aplica, contando as falhas. */
  readonly casos: number
  /** Acertos sobre `casos`: a falha conta como erro. */
  readonly acerto: number | null
  /** Média da probabilidade dada à resposta certa; a falha conta como zero. */
  readonly probabilidadeDaCerta: number | null
}

export interface ResumoDaClassificacao {
  readonly versao: string
  readonly casos: number
  readonly falhas: number
  readonly idsComFalha: string[]
  readonly porPergunta: Record<PerguntaAvaliada, ResumoDaPergunta>
  /** Média e pior tempo por e-mail, só dos respondidos. */
  readonly tempoMedioMs: number | null
  readonly tempoMaximoMs: number | null
}

function media(valores: readonly number[]): number | null {
  return valores.length === 0 ? null : arredondar(somar(valores) / valores.length)
}

export function resumirClassificacao(notas: readonly NotaDaClassificacao[]): ResumoDaClassificacao {
  const respondidas = notas.filter((nota) => !nota.falhou)
  const porPergunta = Object.fromEntries(
    PERGUNTAS_AVALIADAS.map((pergunta) => {
      // A falha entra como zero, como na nota da interpretação: tirá-la
      // premiaria quem desiste dos casos difíceis. Caso sem resposta única
      // (categoria mista) não entra.
      const aplicaveis = notas.filter((nota) => nota.falhou || nota[pergunta] !== null)
      return [
        pergunta,
        {
          casos: aplicaveis.length,
          acerto: media(aplicaveis.map((nota) => nota[pergunta]?.acerto ?? 0)),
          probabilidadeDaCerta: media(aplicaveis.map((nota) => nota[pergunta]?.probabilidadeDaCerta ?? 0)),
        },
      ]
    }),
  ) as Record<PerguntaAvaliada, ResumoDaPergunta>
  const tempos = respondidas.map((nota) => nota.tempoMs)
  return {
    versao: VERSAO_DA_NOTA_DO_CLASSIFICADOR,
    casos: notas.length,
    falhas: notas.length - respondidas.length,
    idsComFalha: notas.filter((nota) => nota.falhou).map((nota) => nota.id),
    porPergunta,
    tempoMedioMs: media(tempos),
    tempoMaximoMs: tempos.length === 0 ? null : Math.max(...tempos),
  }
}
