import { CAMPO_DA_LIGA, ROTULO_DO_CAMPO_DA_LIGA } from '../../core/conferencia-da-extracao'
import { decidivelNoCartao } from '../../core/revisao-por-email'
import { chaveDaLiga } from '../../core/ligas'

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

/** O mesmo, para as N revisões de um e-mail decididas de uma vez (`A69`, 1A). */
export function depoisDeResolverVarias<T extends { revisaoId: string }>(
  itens: readonly T[],
  total: number,
  revisaoIds: readonly string[],
): { itens: T[]; total: number; recarregar: boolean } {
  const saem = new Set(revisaoIds)
  const restantes = itens.filter((linha) => !saem.has(linha.revisaoId))
  const novoTotal = Math.max(0, total - (itens.length - restantes.length))
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
  const daLiga = campo === CAMPO_DA_LIGA
  const valor = daLiga ? sugestao.ligaMencionada : Object.hasOwn(sugestao.campos, campo) ? sugestao.campos[campo] : null
  const nome = daLiga ? ROTULO_DO_CAMPO_DA_LIGA : campo
  return valor?.trim() ? `confira: ${nome}` : `falta: ${nome}`
}

/**
 * A liga que a IA citou e que não virou a liga do item. Aparece qualquer que
 * seja o campo apontado: com o CPF falhando e a liga fora do e-mail, o selo
 * aponta o CPF, e sem esta linha quem aprova não saberia que o item ficou sem
 * liga (3ª rodada do #150).
 */
export function ligaQueFicouDeFora(sugestao: Sugestao, semLiga: boolean): string | null {
  const citada = sugestao.ligaMencionada?.trim()
  // "-", "—", "?": o modelo dizendo "nenhuma". Não vira liga no núcleo, e a
  // tela não pode afirmar que uma liga ficou de fora (4ª rodada do #150).
  return semLiga && citada && chaveDaLiga(citada) !== null ? citada : null
}

/**
 * O selo de confiança só quando ela é o motivo da revisão (`A69`, 2B).
 *
 * Num item que veio para cá porque o CPF não confere, "92%" em verde ao lado
 * dizia "pode confiar" justamente do dado que a pessoa precisa conferir. A
 * confiança é a própria IA que dá e não prova nada sobre o valor (`A62`).
 */
export function mostraConfianca(motivo: string): boolean {
  return motivo === 'baixa_confianca'
}

/** O nome que a tela mostra para o campo apontado. */
export function rotuloDoCampo(campo: string): string {
  return campo === CAMPO_DA_LIGA ? ROTULO_DO_CAMPO_DA_LIGA : campo
}

/**
 * O corpo partido em volta do trecho marcado. Trecho que não cabe no texto não
 * marca nada: melhor nenhum destaque que um destaque no lugar errado.
 */
export function partesDoCorpo(
  corpo: string,
  trecho: { readonly inicio: number; readonly fim: number } | null,
): { antes: string; marcado: string | null; depois: string } {
  if (!trecho || trecho.inicio < 0 || trecho.fim > corpo.length || trecho.fim <= trecho.inicio) {
    return { antes: corpo, marcado: null, depois: '' }
  }
  return {
    antes: corpo.slice(0, trecho.inicio),
    marcado: corpo.slice(trecho.inicio, trecho.fim),
    depois: corpo.slice(trecho.fim),
  }
}

/**
 * Um bloco da lista: uma revisão sozinha, ou o cartão de um e-mail (`A69`, 1A).
 */
export type BlocoDaRevisao<T> = { tipo: 'item'; item: T } | { tipo: 'email'; emailId: string; itens: T[] }

/**
 * Junta num cartão as revisões do mesmo e-mail — só quando é seguro decidir
 * de uma vez:
 *
 * - a lista tem TODAS as pendentes do e-mail (`pendentesNoEmail`): "Aprovar
 *   os 3" de um e-mail com 5 decidiria sobre nomes que ninguém viu;
 * - são duas ou mais;
 * - nenhuma revisão pede um valor conferido ou é alerta de segurança, nem
 *   mesmo escondida sob o motivo `desdobramento` (`decidivelNoCartao`);
 * - a pessoa não pediu "Ver um por um".
 *
 * O cartão fica onde a primeira revisão do e-mail aparece: a ordem da fila
 * (menor confiança primeiro) continua valendo. O serviço confere tudo de novo.
 */
export function blocosDaRevisao<
  T extends {
    revisaoId: string
    emailId: string | null
    pendentesNoEmail: number
    motivo: string
    emailSuspeito: boolean
    campoIncerto: string | null
    sugestaoIa: string
    semLiga: boolean
  },
>(itens: readonly T[], separados: ReadonlySet<string>): BlocoDaRevisao<T>[] {
  const porEmail = new Map<string, T[]>()
  for (const item of itens) {
    if (item.emailId === null) continue
    porEmail.set(item.emailId, [...(porEmail.get(item.emailId) ?? []), item])
  }
  const juntavel = (emailId: string, doEmail: readonly T[]) =>
    !separados.has(emailId) &&
    doEmail.length >= 2 &&
    doEmail.every(
      (item) => item.pendentesNoEmail === doEmail.length && decidivelNoCartao(item),
    )

  const blocos: BlocoDaRevisao<T>[] = []
  const postos = new Set<string>()
  for (const item of itens) {
    const doEmail = item.emailId === null ? undefined : porEmail.get(item.emailId)
    if (item.emailId !== null && doEmail && juntavel(item.emailId, doEmail)) {
      if (postos.has(item.emailId)) continue
      postos.add(item.emailId)
      blocos.push({ tipo: 'email', emailId: item.emailId, itens: doEmail })
    } else {
      blocos.push({ tipo: 'item', item })
    }
  }
  return blocos
}

/**
 * O começo do título quando ele termina no nome ("Inclusão de ligante — "
 * de "Inclusão de ligante — Fulana"): corrigir o nome corrige o título.
 *
 * Só em fronteira de palavra — "Ana" não é o fim de "Mariana" — e nome vazio
 * só vale quando o título termina em espaço, que é a linha nova recém-criada
 * (revisão técnica do #167: `endsWith('')` casava com qualquer título).
 */
export function prefixoDoTitulo(titulo: string, nome: string | undefined): string | null {
  if (nome === undefined) return null
  if (nome === '') return /\s$/.test(titulo) ? titulo : null
  if (!titulo.endsWith(nome)) return null
  const prefixo = titulo.slice(0, titulo.length - nome.length)
  return prefixo === '' || /\s$/.test(prefixo) ? prefixo : null
}
