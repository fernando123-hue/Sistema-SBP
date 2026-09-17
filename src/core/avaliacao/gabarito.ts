import type { Interpretacao, ItemExtraido } from '../esquemas'
import { arredondar, somar } from '../util/numero'

/**
 * Gabarito de avaliação da interpretação — domínio puro.
 *
 * Responde, com número, à pergunta que `qualidade-ia.ts` só consegue
 * responder DEPOIS de a equipe revisar: *este modelo, com este prompt, acerta?*
 * Aqui a resposta certa foi escrita ANTES, por gente, sobre e-mails
 * sintéticos. Sem isso não dá para comparar dois fornecedores, justificar um
 * modelo local nem promover um prompt (`DIRECAO.md`, `A51`, `A56`).
 *
 * ═══ O QUE A NOTA MEDE, E O QUE DEIXA DE FORA ═══
 *
 * Cinco dimensões, cada uma de 0 a 1, todas determinísticas:
 *
 *   quantidade   — o número de itens bate (o desdobramento de `A1`)
 *   categorias   — quantas categorias batem, sem importar a ordem
 *   campos       — quantos campos esperados vieram com o valor LITERAL
 *   literalidade — quantos valores devolvidos estão de fato no e-mail
 *   suspeita     — a marca de injeção bate, nos dois sentidos
 *
 * Título e observação ficam de fora: são texto livre, e nota sobre texto livre
 * exigiria outro modelo como juiz — o juiz errando em silêncio seria o defeito
 * que este sistema existe para curar. Confiança também fica de fora: calibrá-la
 * pede amostra muito maior que este conjunto.
 *
 * ═══ OS DENOMINADORES ═══
 *
 * Todos escolhidos para que nenhuma estratégia boba infle a nota:
 * devolver itens demais dilui `categorias` (divide pelo MAIOR dos tamanhos);
 * repetir o mesmo campo em todo item não soma duas vezes (cada campo esperado
 * é consumido uma vez); inventar campo a mais derruba `literalidade`; e
 * falhar não sai da média (`resumirAvaliacao`).
 *
 * ═══ NENHUM DADO REAL ═══
 *
 * Os casos são sintéticos (`casos.ts`) e continuam sendo. Montar gabarito com
 * e-mail da associação seria guardar conteúdo fora da retenção (invariante 11)
 * e o primeiro passo de um conjunto de treino (invariante 9).
 */

/** Muda quando um caso ou a regra de nota muda — nota só se compara dentro da mesma versão. */
export const VERSAO_DO_GABARITO = 'gabarito-1.0.0'

export interface ItemEsperado {
  categoriaCodigo: ItemExtraido['categoriaCodigo']
  /** Só o que está literalmente no e-mail. Chave em minúsculas. */
  campos?: Record<string, string>
}

export interface CasoDoGabarito {
  id: string
  descricao: string
  email: { assunto: string; corpo: string }
  esperado: {
    itens: ItemEsperado[]
    suspeito: boolean
  }
}

export interface NotaDoCaso {
  id: string
  falhou: boolean
  /** Por que não houve resposta utilizável. `null` quando houve. */
  motivo: string | null
  quantidade: number
  categorias: number
  /** `null` quando o gabarito não espera campo nenhum. */
  campos: number | null
  /** `null` quando o modelo não devolveu campo nenhum. */
  literalidade: number | null
  suspeita: number
  /** Média das dimensões que se aplicam; zero na falha. */
  nota: number
}

export type Dimensao = 'quantidade' | 'categorias' | 'campos' | 'literalidade' | 'suspeita'

export const DIMENSOES: readonly Dimensao[] = ['quantidade', 'categorias', 'campos', 'literalidade', 'suspeita']

/**
 * Espaço repetido e borda não são diferença: `" Fulano  Sintético "` é o nome
 * do e-mail. Pontuação, caixa e dígitos são — CPF sem pontos é formatação,
 * e o prompt proíbe formatar.
 */
function normalizarValor(valor: string): string {
  return valor.trim().replace(/\s+/g, ' ')
}

/** A chave é nome do modelo, não dado: `"CPF"` e `" cpf "` são a mesma. */
function normalizarChave(chave: string): string {
  return chave.trim().toLowerCase()
}

function fracao(parte: number, total: number): number {
  return total === 0 ? 0 : parte / total
}

function pontuarCategorias(esperadas: readonly string[], obtidas: readonly string[]): number {
  const restantes = [...obtidas]
  let acertos = 0
  for (const categoria of esperadas) {
    const posicao = restantes.indexOf(categoria)
    if (posicao >= 0) {
      acertos += 1
      restantes.splice(posicao, 1)
    }
  }
  return fracao(acertos, Math.max(esperadas.length, obtidas.length))
}

function paresDe(campos: Record<string, string>): string[] {
  return Object.entries(campos).map(([chave, valor]) => JSON.stringify([normalizarChave(chave), normalizarValor(valor)]))
}

function pontuarCampos(caso: CasoDoGabarito, resposta: Interpretacao): number | null {
  const esperados = caso.esperado.itens.flatMap((item) => paresDe(item.campos ?? {}))
  if (esperados.length === 0) return null

  // Cada par devolvido serve a UM esperado só: o mesmo nome repetido em dois
  // itens não acerta os dois ligantes.
  const disponiveis = resposta.itens.flatMap((item) => paresDe(item.campos))
  let acertos = 0
  for (const par of esperados) {
    const posicao = disponiveis.indexOf(par)
    if (posicao >= 0) {
      acertos += 1
      disponiveis.splice(posicao, 1)
    }
  }
  return fracao(acertos, esperados.length)
}

function pontuarLiteralidade(caso: CasoDoGabarito, resposta: Interpretacao): number | null {
  const texto = normalizarValor(`${caso.email.assunto}\n${caso.email.corpo}`)
  const valores = resposta.itens.flatMap((item) => Object.values(item.campos).map(normalizarValor))
  if (valores.length === 0) return null
  return fracao(valores.filter((valor) => valor.length > 0 && texto.includes(valor)).length, valores.length)
}

function media(valores: readonly number[]): number | null {
  return valores.length === 0 ? null : arredondar(somar(valores) / valores.length)
}

export function pontuarCaso(caso: CasoDoGabarito, resposta: Interpretacao): NotaDoCaso {
  const esperadas = caso.esperado.itens.map((item) => item.categoriaCodigo)
  const obtidas = resposta.itens.map((item) => item.categoriaCodigo)

  const dimensoes = {
    quantidade: obtidas.length === esperadas.length ? 1 : 0,
    categorias: arredondar(pontuarCategorias(esperadas, obtidas)),
    campos: nuloOuArredondado(pontuarCampos(caso, resposta)),
    literalidade: nuloOuArredondado(pontuarLiteralidade(caso, resposta)),
    suspeita: resposta.conteudoSuspeito === caso.esperado.suspeito ? 1 : 0,
  }

  const aplicaveis = DIMENSOES.map((dimensao) => dimensoes[dimensao]).filter(
    (valor): valor is number => valor !== null,
  )

  return { id: caso.id, falhou: false, motivo: null, ...dimensoes, nota: media(aplicaveis) ?? 0 }
}

function nuloOuArredondado(valor: number | null): number | null {
  return valor === null ? null : arredondar(valor)
}

/**
 * O modelo não devolveu nada utilizável: erro, esquema inválido, tempo esgotado.
 *
 * Em produção o e-mail iria para revisão humana, o que é seguro — mas para a
 * avaliação é um caso não resolvido, e vale zero.
 */
export function pontuarFalha(caso: CasoDoGabarito, motivo: string): NotaDoCaso {
  return {
    id: caso.id,
    falhou: true,
    motivo,
    quantidade: 0,
    categorias: 0,
    campos: null,
    literalidade: null,
    suspeita: 0,
    nota: 0,
  }
}

export interface ResumoDaAvaliacao {
  versaoDoGabarito: string
  casos: number
  falhas: number
  idsComFalha: string[]
  /** `null` sem caso nenhum: "sem dado" não é "errou tudo". */
  nota: number | null
  /**
   * A média só dos casos que tiveram resposta. Nunca substitui `nota`:
   * sozinha, premiaria quem desiste dos casos difíceis. Serve para separar
   * "o fornecedor não atendeu" (503, tempo esgotado) de "o modelo leu errado".
   */
  notaDasRespondidas: number | null
  /** Média de cada dimensão só sobre os casos respondidos em que ela se aplica. */
  porDimensao: Record<Dimensao, number | null>
}

export function resumirAvaliacao(notas: readonly NotaDoCaso[]): ResumoDaAvaliacao {
  const respondidas = notas.filter((nota) => !nota.falhou)
  const porDimensao = Object.fromEntries(
    DIMENSOES.map((dimensao) => [
      dimensao,
      media(respondidas.map((nota) => nota[dimensao]).filter((valor): valor is number => valor !== null)),
    ]),
  ) as Record<Dimensao, number | null>

  return {
    versaoDoGabarito: VERSAO_DO_GABARITO,
    casos: notas.length,
    falhas: notas.length - respondidas.length,
    idsComFalha: notas.filter((nota) => nota.falhou).map((nota) => nota.id),
    // A falha entra como zero: tirá-la da conta premiaria o modelo que
    // desiste justamente dos casos difíceis.
    nota: media(notas.map((nota) => nota.nota)),
    notaDasRespondidas: media(respondidas.map((nota) => nota.nota)),
    porDimensao,
  }
}
