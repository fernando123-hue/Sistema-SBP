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

export type CriterioRodada = 'sem_demanda' | 'indivisivel' | 'resto_maior'

export interface EntradaRodada {
  /** ISO date (`YYYY-MM-DD`). */
  data: string
  categoria: Categoria
  /** Q — quantidade de ITENS, não de e-mails. Ver DECISOES.md § A1. */
  quantidade: number
  elegiveis: Elegivel[]
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
  alocacao: Record<ColaboradorId, number>
  creditoCategoriaAntes: Record<ColaboradorId, number>
  creditoCategoriaDepois: Record<ColaboradorId, number>
  creditoGlobalAntes: Record<ColaboradorId, number>
  creditoGlobalDepois: Record<ColaboradorId, number>
}
