import { CAMPO_DA_LIGA } from '../../core/conferencia-da-extracao'

/**
 * A fila de revisão como a tela a guarda: até 200 revisões e o total real
 * (achado N-30).
 *
 * A tela tirava da lista a revisão resolvida e nunca descontava do total. O
 * cabeçalho seguia com o número da carga e, quando as 200 da lista acabavam,
 * dizia "Nada aguardando decisão humana" com revisões paradas além do corte —
 * que não entram na distribuição enquanto ninguém decide.
 */

/** Tira a revisão resolvida e diz se é hora de pedir a próxima leva. */
export function depoisDeResolver<T extends { revisaoId: string }>(
  itens: readonly T[],
  total: number,
  revisaoId: string,
): { itens: T[]; total: number; recarregar: boolean } {
  const restantes = itens.filter((linha) => linha.revisaoId !== revisaoId)
  // Revisão que já não estava na lista não é descontada duas vezes.
  if (restantes.length === itens.length) return { itens: [...itens], total, recarregar: false }

  const novoTotal = Math.max(0, total - 1)
  return { itens: restantes, total: novoTotal, recarregar: restantes.length === 0 && novoTotal > 0 }
}

/**
 * Lista local vazia com total maior que zero é a próxima leva a caminho, não
 * fila vazia.
 */
export function estadoDaFila(
  itens: readonly unknown[] | null,
  total: number,
): 'carregando' | 'vazia' | 'lista' {
  if (itens === null) return 'carregando'
  if (itens.length > 0) return 'lista'
  return total > 0 ? 'carregando' : 'vazia'
}

/**
 * A resposta da rota, pronta para a tela.
 *
 * O total e a lista saem de duas consultas (`listarPendentes`): quem resolve a
 * última revisão entre as duas deixa `total: 1` com `itens: []`. Lida como
 * veio, a tela ficaria em "Carregando…" para sempre (revisão do PR #107). A
 * lista é a leitura mais nova — vazia, não há nada pendente agora.
 */
export function filaDaResposta<T>(resposta: { itens: T[]; total: number }): { itens: T[]; total: number } {
  if (resposta.itens.length === 0) return { itens: [], total: 0 }
  return { itens: resposta.itens, total: Math.max(resposta.total, resposta.itens.length) }
}

/** A sugestão da IA gravada na revisão, só com o que a tela usa. */
export interface Sugestao {
  readonly campos: Readonly<Record<string, string>>
  readonly ligaMencionada: string | null
}

/**
 * Lê a sugestão gravada; ilegível vira vazia (a tela não cai por ela).
 *
 * Só entram chaves PRÓPRIAS com valor texto, num objeto sem protótipo. O
 * `campoIncerto` vem da IA: com `campos?.[campo]?.trim()`, um campo chamado
 * "toString" ou "constructor" achava a função herdada e derrubava a tela da
 * Revisão inteira (2ª rodada do #150).
 */
export function lerSugestao(texto: string): Sugestao {
  let valor: unknown
  try {
    valor = JSON.parse(texto)
  } catch {
    return { campos: {}, ligaMencionada: null }
  }
  if (valor === null || typeof valor !== 'object') return { campos: {}, ligaMencionada: null }
  const bruto = valor as { campos?: unknown; ligaMencionada?: unknown }
  const campos: Record<string, string> = Object.create(null)
  if (bruto.campos !== null && typeof bruto.campos === 'object') {
    for (const [chave, conteudo] of Object.entries(bruto.campos)) {
      if (typeof conteudo === 'string') campos[chave] = conteudo
    }
  }
  return { campos, ligaMencionada: typeof bruto.ligaMencionada === 'string' ? bruto.ligaMencionada : null }
}

/**
 * O que o selo do campo diz. "Falta" é o campo que a IA não achou; quando o
 * campo EXISTE (tem valor na sugestão, ou é a liga citada) e o sistema aponta
 * para ele, é o valor que precisa ser conferido contra o e-mail — dizer
 * "falta" mandaria a pessoa procurar a coisa errada. Decidido pelo que a
 * sugestão tem, e não pelo motivo: numa lista, o motivo é "vários itens" e o
 * campo apontado continua sendo o que não bateu (revisão técnica do #150).
 */
export function seloDoCampo(campo: string, sugestao: Sugestao): string {
  const valor = campo === CAMPO_DA_LIGA ? sugestao.ligaMencionada : Object.hasOwn(sugestao.campos, campo) ? sugestao.campos[campo] : null
  return valor?.trim() ? `confira: ${campo}` : `falta: ${campo}`
}
