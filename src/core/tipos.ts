/**
 * Tipos do domínio. Núcleo puro: nenhum import de banco, rede ou UI.
 */

export type ColaboradorId = string
export type CategoriaId = string

/** Frente operacional. A V1 cobre apenas CADASTRO. */
export type Frente = 'CADASTRO' | 'TITULOS'

/**
 * Subgrupo dentro da frente.
 * Restaura a estrutura que as fórmulas `E=SUM(B:D)` e `I=SUM(F:H)` da planilha
 * revelam e que o documento de contexto havia achatado. Ver DECISOES.md § C7.
 */
export type Grupo = 'ASSOCIADO' | 'LIGA'

export interface Categoria {
  id: CategoriaId
  /** Estável e imutável. O rótulo pode mudar; o código, não. Ver DECISOES.md § C8. */
  codigo: string
  rotulo: string
  frente: Frente
  grupo: Grupo
  /**
   * `false` = dono único, sem rateio (RN-07).
   * Caminho secundário: a elegibilidade já produz 100% quando há um só habilitado.
   * Ver DECISOES.md § C5.
   */
  divisivel: boolean
  /** Peso de esforço em unidades ponderadas. `1` na V1. Ver DECISOES.md § AT-02. */
  peso: number
  /**
   * Quantidade até a qual o lote vai inteiro para uma pessoa (RN-05).
   * Comparação é `Q <= limiar` — ver DECISOES.md § C1 para o off-by-one corrigido.
   */
  limiarIndivisivel: number
  /** `INADIMP.` e `ISENTO` ficam fora do rateio diário (RN-15). */
  entraNoRateio: boolean
  /**
   * A liga é a unidade que não se separa nesta categoria (`A4`).
   *
   * `true` em `LIGANTE` e `EMAIL_LIGA`: todos os ligantes de uma liga no
   * mesmo dia vão inteiros para uma pessoa, ainda que tenham chegado em
   * e-mails diferentes (`A4.1`). Nas demais categorias o item é a unidade, e
   * o rateio continua sendo resto-maior.
   */
  agrupaPorLiga: boolean
}

/**
 * Um candidato a receber trabalho numa rodada.
 * Já é o resultado de `Habilitacao ativa ∩ Escala do dia` — o motor não consulta nada.
 */
export interface Elegivel {
  colaboradorId: ColaboradorId
  /** Crédito acumulado NESTA categoria, em unidades ponderadas. Critério primário. */
  creditoCategoria: number
  /** Crédito acumulado somando todas as categorias. Desempate secundário. */
  creditoGlobal: number
  /** Volume recebido no período corrente (semana, mês — definido por quem chama). */
  recebidoPeriodo: number
  /** Volume recebido hoje, somando rodadas anteriores do mesmo dia. */
  recebidoDia: number
  /** Reservado para meio período / retorno de férias. `1` na V1. */
  capacidadeRelativa: number
}

export type CriterioRodada = 'sem_demanda' | 'indivisivel' | 'resto_maior' | 'por_grupo'

/**
 * Lote que não se separa (`A4`).
 *
 * Hoje é sempre uma liga num dia, mas o motor não sabe disso: para ele é só
 * "um punhado de itens que vai inteiro para alguém". Manter o núcleo alheio ao
 * que a chave significa é o que permite outra categoria ganhar agrupamento
 * amanhã sem tocar no motor.
 */
export interface GrupoIndivisivel {
  /** Identidade do lote. Determinística — desempata tamanho igual. */
  chave: string
  /** Quantos itens. Sempre ≥ 1. */
  tamanho: number
}

export interface EntradaRodada {
  /** ISO date (`YYYY-MM-DD`). */
  data: string
  categoria: Categoria
  /** Q — quantidade de ITENS, não de e-mails. Ver DECISOES.md § A1. */
  quantidade: number
  elegiveis: Elegivel[]
  /**
   * Lotes indivisíveis (`A4`). Opcional.
   *
   * REFINA `quantidade`, não a substitui: `Σ tamanhos` tem de ser igual a `Q`,
   * e a trava de conservação continua sendo a mesma de sempre. Ausente, o
   * motor se comporta exatamente como antes — nenhuma rodada existente muda.
   */
  grupos?: GrupoIndivisivel[]
}

/**
 * Snapshot completo e auto-suficiente da decisão.
 * É o que a `RodadaDistribuicao` persiste — e o que torna qualquer número
 * do painel reconstruível passo a passo.
 */
export interface ResultadoRodada {
  data: string
  categoriaId: CategoriaId
  quantidadeEntrada: number
  algoritmoVersao: string
  criterio: CriterioRodada
  /** Piso da divisão inteira. */
  base: number
  /** `Q mod n` — as unidades que sobram e vão para o topo da ordem. */
  resto: number
  /** `Q × peso / n`. O que cada um deveria ter recebido em unidades ponderadas. */
  cotaJusta: number
  /** Ordem aplicada, do primeiro a receber o resto ao último. Determinística. */
  ordemDesempate: ColaboradorId[]
  /**
   * Estado COMPLETO de cada elegível no instante da decisão, já ordenado.
   *
   * Sem isto, a rodada guarda quem venceu mas não POR QUE venceu: os critérios
   * b, c e d do desempate (crédito global, recebido no período, recebido no dia)
   * ficariam irrecuperáveis, e a tela de auditoria não conseguiria reconstruir
   * a decisão passo a passo. Um item do PRD promete exatamente isso.
   */
  elegiveis: Elegivel[]
  alocacao: Record<ColaboradorId, number>
  /**
   * Qual lote indivisível foi para quem. Presente só no critério `por_grupo`.
   *
   * ═══ POR QUE O NÚMERO NÃO BASTAVA ═══
   *
   * `alocacao` diz QUANTOS itens cada pessoa recebe. Enquanto o rateio era por
   * quantidade isso era suficiente: qualquer conjunto de N itens serve. Com o
   * `A4` deixou de ser — o motor passou a decidir por LOTE, e a identidade do
   * lote é a decisão.
   *
   * Sem este campo, o serviço recebia "Ana: 5, Bruno: 3" e repartia os itens
   * por POSIÇÃO numa lista ordenada por `criadoEm`. Duas ligas cujos e-mails
   * chegaram intercalados eram partidas entre as duas pessoas — exatamente o
   * que o `A4` existe para impedir —, e nada acusava, porque a soma continuava
   * fechando e a trava de conservação só olha a soma.
   *
   * A decisão do motor tem de chegar inteira a quem grava. Este campo é ela.
   */
  atribuicaoDeGrupos?: Record<string, ColaboradorId>
  creditoCategoriaAntes: Record<ColaboradorId, number>
  creditoCategoriaDepois: Record<ColaboradorId, number>
  creditoGlobalAntes: Record<ColaboradorId, number>
  creditoGlobalDepois: Record<ColaboradorId, number>
}
