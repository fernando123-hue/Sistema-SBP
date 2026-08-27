import { arredondar, somar } from './util/numero'

/**
 * Qualidade da interpretação — domínio puro.
 *
 * Responde à pergunta que o critério de aceitação nº 5 faz e que hoje ninguém
 * consegue responder: *quanto a IA acerta?* Enquanto esse número não existir,
 * afrouxar o limiar de confiança ou baixar o `effort` do modelo é palpite, e
 * palpite sobre carga de trabalho de gente é o que este sistema veio substituir.
 *
 * ═══ O QUE ESTA MEDIDA NÃO É ═══
 *
 * Não é avaliação de pessoa. `Revisao.resolvidoPor` existe no banco e é
 * deliberadamente IGNORADO aqui: recortar acerto por revisor transformaria a
 * fila de revisão num instrumento de vigilância, e quem revisa passaria a
 * evitar corrigir para não "estragar o próprio número" — destruindo exatamente
 * o dado que este cálculo precisa. Invariante 10 do `CLAUDE.md`.
 *
 * ═══ O DENOMINADOR, QUE É A PARTE DIFÍCIL ═══
 *
 * "Aceita sem correção" tem uma armadilha: se o universo fosse TODOS os itens,
 * os que nunca foram a revisão contariam como acerto — e bastaria subir o
 * limiar de confiança até ninguém revisar nada para a taxa ir a 100%. O número
 * subiria justamente enquanto a conferência humana desaparecia.
 *
 * Então o universo aqui é só o que passou por humano. É um número PESSIMISTA
 * por construção — a fila de revisão seleciona os casos duvidosos — e é o único
 * que não se pode inflar mexendo em parâmetro. A cobertura (quanto foi
 * revisado) é reportada ao lado, porque taxa alta sobre amostra minúscula não
 * significa nada.
 */

export interface SugestaoDaIa {
  categoriaCodigo: string
  titulo: string
  confianca: number
  campos: Record<string, string>
}

/**
 * O que o humano decidiu.
 *
 * Os campos anuláveis cobrem a aprovação em massa, que grava só `aprovado` —
 * e aprovar em massa É aceitar a sugestão inteira sem tocar nela.
 */
export interface DecisaoHumana {
  categoriaCodigo: string | null
  titulo: string | null
  campos: Record<string, string> | null
  aprovado: boolean
  itensExtras: number
}

export interface ParDeRevisao {
  sugestao: SugestaoDaIa
  decisao: DecisaoHumana
}

/**
 * O rótulo único de uma revisão, por precedência de gravidade.
 *
 * Uma revisão pode ter várias correções ao mesmo tempo; o rótulo pega a mais
 * grave, para que a distribuição some 100% e possa virar gráfico. As correções
 * individuais continuam disponíveis em `Correcoes`, sem precedência nenhuma.
 */
export type DesfechoDaRevisao =
  | 'aceita_sem_correcao'
  | 'recusada'
  | 'categoria_trocada'
  | 'itens_acrescentados'
  | 'titulo_editado'
  | 'campos_corrigidos'

export const DESFECHOS: readonly DesfechoDaRevisao[] = [
  'aceita_sem_correcao',
  'recusada',
  'categoria_trocada',
  'itens_acrescentados',
  'titulo_editado',
  'campos_corrigidos',
]

export interface Correcoes {
  categoriaTrocada: boolean
  tituloEditado: boolean
  camposCorrigidos: boolean
  itensAcrescentados: boolean
  recusada: boolean
}

/** Espaço em branco não é correção: "  Ficha " e "Ficha" são o mesmo título. */
function mesmoTexto(a: string, b: string): boolean {
  return a.trim() === b.trim()
}

/**
 * Houve edição de campo extraído?
 *
 * A tela de revisão inicializa os campos editáveis COM o que a IA extraiu e
 * devolve o conjunto inteiro. Então diferença aqui é edição de verdade, não
 * ruído de formulário. A comparação corre a união das chaves — campo que a IA
 * inventou e o humano esvaziou também é correção.
 */
function camposForamCorrigidos(
  sugeridos: Record<string, string>,
  finais: Record<string, string>,
): boolean {
  const chaves = new Set([...Object.keys(sugeridos), ...Object.keys(finais)])
  for (const chave of chaves) {
    if (!mesmoTexto(sugeridos[chave] ?? '', finais[chave] ?? '')) return true
  }
  return false
}

export function compararRevisao(par: ParDeRevisao): {
  desfecho: DesfechoDaRevisao
  correcoes: Correcoes
} {
  const { sugestao, decisao } = par

  const correcoes: Correcoes = {
    recusada: !decisao.aprovado,
    // `null` = aprovação em massa: a sugestão foi aceita inteira, sem edição.
    categoriaTrocada:
      decisao.categoriaCodigo !== null && decisao.categoriaCodigo !== sugestao.categoriaCodigo,
    tituloEditado: decisao.titulo !== null && !mesmoTexto(decisao.titulo, sugestao.titulo),
    camposCorrigidos:
      decisao.campos !== null && camposForamCorrigidos(sugestao.campos, decisao.campos),
    itensAcrescentados: decisao.itensExtras > 0,
  }

  // Ordem por gravidade: recusar é a IA inteira errada; categoria é a
  // classificação em si; item acrescentado é CARGA que teria sumido; título e
  // campo são conteúdo do item, não a decisão sobre ele.
  const desfecho: DesfechoDaRevisao = correcoes.recusada
    ? 'recusada'
    : correcoes.categoriaTrocada
      ? 'categoria_trocada'
      : correcoes.itensAcrescentados
        ? 'itens_acrescentados'
        : correcoes.tituloEditado
          ? 'titulo_editado'
          : correcoes.camposCorrigidos
            ? 'campos_corrigidos'
            : 'aceita_sem_correcao'

  return { desfecho, correcoes }
}

export interface LinhaDeAcerto {
  /** A categoria que a IA SUGERIU — é o limiar dela que se vai mexer. */
  categoriaCodigo: string
  revisadas: number
  aceitasSemCorrecao: number
  taxaDeAceitacao: number | null
}

export interface TaxaDeAcerto {
  revisadas: number
  aceitasSemCorrecao: number
  /**
   * `null` quando nada foi revisado.
   *
   * Zero leria como "a IA errou tudo", que é o oposto de "ainda não há dado".
   * Confundir os dois é como o painel da planilha mostra `0` para linha vazia.
   */
  taxaDeAceitacao: number | null
  porDesfecho: Record<DesfechoDaRevisao, number>
  porCategoriaSugerida: LinhaDeAcerto[]
  /**
   * Calibração da confiança — o número que decide se o limiar significa algo.
   *
   * Se a confiança média das aceitas for igual à das corrigidas, o valor que o
   * modelo reporta não separa acerto de erro, e mexer no limiar é mexer em
   * ruído. Só faz sentido afrouxar quando há distância entre as duas.
   */
  confiancaMediaAceita: number | null
  confiancaMediaCorrigida: number | null
}

function media(valores: readonly number[]): number | null {
  if (valores.length === 0) return null
  return arredondar(somar(valores) / valores.length)
}

function taxa(parte: number, total: number): number | null {
  if (total === 0) return null
  return arredondar(parte / total)
}

export function calcularTaxaDeAcerto(pares: readonly ParDeRevisao[]): TaxaDeAcerto {
  const porDesfecho = Object.fromEntries(DESFECHOS.map((desfecho) => [desfecho, 0])) as Record<
    DesfechoDaRevisao,
    number
  >

  const porCategoria = new Map<string, { revisadas: number; aceitas: number }>()
  const confiancaAceita: number[] = []
  const confiancaCorrigida: number[] = []
  let aceitasSemCorrecao = 0

  for (const par of pares) {
    const { desfecho } = compararRevisao(par)
    porDesfecho[desfecho] += 1

    const aceita = desfecho === 'aceita_sem_correcao'
    if (aceita) {
      aceitasSemCorrecao += 1
      confiancaAceita.push(par.sugestao.confianca)
    } else {
      confiancaCorrigida.push(par.sugestao.confianca)
    }

    // Agrupado pela categoria SUGERIDA, não pela final: a pergunta é "onde a IA
    // erra", e é o limiar da categoria sugerida que se ajusta.
    const linha = porCategoria.get(par.sugestao.categoriaCodigo) ?? { revisadas: 0, aceitas: 0 }
    linha.revisadas += 1
    if (aceita) linha.aceitas += 1
    porCategoria.set(par.sugestao.categoriaCodigo, linha)
  }

  return {
    revisadas: pares.length,
    aceitasSemCorrecao,
    taxaDeAceitacao: taxa(aceitasSemCorrecao, pares.length),
    porDesfecho,
    porCategoriaSugerida: [...porCategoria.entries()]
      .map(([categoriaCodigo, linha]) => ({
        categoriaCodigo,
        revisadas: linha.revisadas,
        aceitasSemCorrecao: linha.aceitas,
        taxaDeAceitacao: taxa(linha.aceitas, linha.revisadas),
      }))
      // Pior taxa primeiro: é onde se mexe. Desempate por volume, depois por
      // código, para a ordem não depender da ordem de chegada.
      .sort(
        (a, b) =>
          (a.taxaDeAceitacao ?? 0) - (b.taxaDeAceitacao ?? 0) ||
          b.revisadas - a.revisadas ||
          a.categoriaCodigo.localeCompare(b.categoriaCodigo),
      ),
    confiancaMediaAceita: media(confiancaAceita),
    confiancaMediaCorrigida: media(confiancaCorrigida),
  }
}
