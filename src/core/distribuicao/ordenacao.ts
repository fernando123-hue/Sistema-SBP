import type { Elegivel } from '../tipos'
import { compararNumero } from '../util/numero'

/**
 * Ordem de precedência para receber as unidades que sobram da divisão.
 *
 * Esta é a formalização de RN-13. Hoje, a alternância `+0,5 / −0,5` entre dias
 * é memória de uma pessoa — não existe em nenhuma fórmula da planilha. Aqui
 * vira consequência aritmética de um número guardado no banco.
 *
 *   a) maior creditoCategoria  — recebeu menos do que devia NESTA categoria
 *   b) maior creditoGlobal     — recebeu menos do que devia NO TOTAL
 *   c) menor recebidoPeriodo
 *   d) menor recebidoDia
 *   e) colaboradorId asc       — determinismo estável
 *
 * (a) antes de (b) é a decisão registrada em DECISOES.md § A2: ligante compara
 * com ligante; o total só desempata.
 *
 * A ordenação é total e determinística: mesma entrada, mesma saída, sempre.
 */
export function ordenarElegiveis(elegiveis: readonly Elegivel[]): Elegivel[] {
  return [...elegiveis].sort((a, b) => {
    const porCreditoCategoria = compararNumero(b.creditoCategoria, a.creditoCategoria)
    if (porCreditoCategoria !== 0) return porCreditoCategoria

    const porCreditoGlobal = compararNumero(b.creditoGlobal, a.creditoGlobal)
    if (porCreditoGlobal !== 0) return porCreditoGlobal

    const porPeriodo = compararNumero(a.recebidoPeriodo, b.recebidoPeriodo)
    if (porPeriodo !== 0) return porPeriodo

    const porDia = compararNumero(a.recebidoDia, b.recebidoDia)
    if (porDia !== 0) return porDia

    return a.colaboradorId < b.colaboradorId ? -1 : a.colaboradorId > b.colaboradorId ? 1 : 0
  })
}
