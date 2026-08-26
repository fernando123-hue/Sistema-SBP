import type { RelatorioDistribuicao } from '../../../servicos/distribuicao'

/**
 * Achata o relatório do serviço para o formato da tela.
 *
 * Existe para que a prévia e a confirmação devolvam EXATAMENTE a mesma forma —
 * a tela não precisa saber se o número já foi gravado ou não.
 */

export interface FatiaDaPrevia {
  colaboradorId: string
  quantidade: number
  creditoAntes: number
  creditoDepois: number
}

export interface LinhaDaPrevia {
  categoriaCodigo: string
  rotulo: string
  grupo: string
  quantidade: number
  criterio: string | null
  base: number
  resto: number
  cotaJusta: number
  erro: string | null
  fatias: FatiaDaPrevia[]
}

export interface ResumoDaDistribuicao {
  data: string
  correlacaoId: string
  totalDistribuido: number
  rodadasGravadas: number
  linhas: LinhaDaPrevia[]
}

export function resumirPlanos(relatorio: RelatorioDistribuicao): ResumoDaDistribuicao {
  return {
    data: relatorio.data,
    correlacaoId: relatorio.correlacaoId,
    totalDistribuido: relatorio.totalDistribuido,
    rodadasGravadas: relatorio.rodadasGravadas,
    linhas: relatorio.planos.map((plano) => ({
      categoriaCodigo: plano.categoria.codigo,
      rotulo: plano.categoria.rotulo,
      grupo: plano.categoria.grupo,
      quantidade: plano.quantidade,
      criterio: plano.resultado?.criterio ?? null,
      base: plano.resultado?.base ?? 0,
      resto: plano.resultado?.resto ?? 0,
      cotaJusta: plano.resultado?.cotaJusta ?? 0,
      erro: plano.erro,
      fatias:
        plano.resultado?.ordemDesempate.map((colaboradorId) => ({
          colaboradorId,
          quantidade: plano.resultado!.alocacao[colaboradorId] ?? 0,
          creditoAntes: plano.resultado!.creditoCategoriaAntes[colaboradorId] ?? 0,
          creditoDepois: plano.resultado!.creditoCategoriaDepois[colaboradorId] ?? 0,
        })) ?? [],
    })),
  }
}
