/**
 * A Minha fila agrupada por e-mail (`A69`, 3A).
 *
 * Uma lista de 34 ligantes é um pedido só: o trabalho real é feito de uma vez
 * no sistema da associação, e depois a pessoa clicava 68 vezes aqui. O grupo
 * junta os itens do mesmo e-mail num cartão com "Concluir os N"; cada item
 * continua existindo e contando no Painel, e "Ver um por um" volta aos cartões
 * de sempre.
 */

export interface GrupoDaFila<T> {
  /** Única na lista: o e-mail, ou o próprio item quando não há e-mail. */
  readonly chave: string
  readonly emailId: string | null
  readonly itens: T[]
}

/**
 * Junta pelo e-mail, na posição do item mais antigo do grupo — a ordem da
 * fila (`A7`) continua valendo entre os grupos.
 *
 * Item sem e-mail (registrado à mão) fica sozinho: juntar todos os "sem
 * e-mail" faria "Concluir os N" concluir coisas sem relação nenhuma.
 */
export function agruparPorEmail<T extends { itemId: string; emailId: string | null }>(
  itens: readonly T[],
): GrupoDaFila<T>[] {
  const grupos: GrupoDaFila<T>[] = []
  const porEmail = new Map<string, GrupoDaFila<T>>()
  for (const item of itens) {
    if (item.emailId === null) {
      grupos.push({ chave: `item:${item.itemId}`, emailId: null, itens: [item] })
      continue
    }
    const existente = porEmail.get(item.emailId)
    if (existente) {
      existente.itens.push(item)
      continue
    }
    const novo: GrupoDaFila<T> = { chave: `email:${item.emailId}`, emailId: item.emailId, itens: [item] }
    porEmail.set(item.emailId, novo)
    grupos.push(novo)
  }
  return grupos
}

/** Os primeiros nomes do grupo e quantos ficaram de fora ("… · mais 31"). */
export function amostraDosTitulos(titulos: readonly string[], quantos = 3): { nomes: string[]; resto: number } {
  return { nomes: titulos.slice(0, quantos), resto: Math.max(0, titulos.length - quantos) }
}
