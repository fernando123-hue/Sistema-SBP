/**
 * A segunda opinião concorda com a interpretação? — domínio puro (`A62`).
 *
 * ═══ PARA QUE SERVE ═══
 *
 * A fase 3 do Jev roda em MODO SOMBRA: o classificador opina sobre a categoria
 * de cada e-mail, a opinião é gravada, e nada no fluxo muda. O que se quer
 * saber, antes de qualquer decisão do dono (`§ H.4` item 36), é com que
 * frequência os dois concordam, e em que casos discordam. Esta função é a
 * régua dessa medição, e por isso mora aqui, sem banco e sem fornecedor: a
 * mesma régua precisa servir ao gabarito (`npm run ia:avaliar`) e à trilha.
 *
 * ═══ O QUE ELA NÃO FAZ ═══
 *
 * Decidir. Uma discordância NÃO manda item para a revisão: isso é mudança de
 * fluxo, e ela só entra depois de medida e decidida pelo dono. Quem quiser
 * usar este resultado para outra coisa que não medir está mudando a regra do
 * `A62`, e isso é decisão, não refatoração.
 *
 * ═══ POR QUE HÁ MAIS DE DOIS RESULTADOS ═══
 *
 * A interpretação devolve ITENS, cada um com sua categoria; o classificador dá
 * UMA categoria para o e-mail. Na maioria dos casos há um item, ou vários da
 * mesma categoria (a lista de ligantes), e a comparação é direta. Mas um
 * e-mail sem item nenhum (resposta automática) ou com itens de categorias
 * diferentes não tem "a categoria da interpretação" — e forçar um dos dois
 * casos para "concorda" ou "discorda" poria número falso na medição.
 */
export type Concordancia = 'concorda' | 'discorda' | 'sem_itens' | 'itens_de_categorias_diferentes'

export function concordanciaDeCategoria(
  categoriasDosItens: readonly string[],
  escolhaDoClassificador: string,
): Concordancia {
  const distintas = new Set(categoriasDosItens)
  if (distintas.size === 0) return 'sem_itens'
  if (distintas.size > 1) return 'itens_de_categorias_diferentes'
  return distintas.has(escolhaDoClassificador) ? 'concorda' : 'discorda'
}
