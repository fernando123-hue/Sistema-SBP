/**
 * Datas.
 *
 * A planilha usa `1..31` na coluna A — sem mês, sem ano, sem dia da semana.
 * Aqui a chave temporal é sempre ISO `YYYY-MM-DD`, ordenável como texto, e o
 * "mês" deixa de ser uma aba para virar um filtro.
 *
 * FUSO HORÁRIO — a correção mais importante deste arquivo.
 *
 * A primeira versão usava `toISOString()`, que devolve a data em UTC. Como a
 * operação acontece em Brasília (UTC−3), **a partir das 21h o sistema achava
 * que já era o dia seguinte**: a tela de Distribuição abria na data errada, a
 * sincronização gerava itens datados de amanhã, e um e-mail recebido às 22h
 * caía FORA do corte de "hoje" na hora de distribuir.
 *
 * `Escala.data`, `SaldoCarga.data` e `RodadaDistribuicao.data` são todas esta
 * mesma chave. Corrigir depois de meses de operação seria reinterpretar o
 * livro-razão inteiro.
 */

export const FUSO_HORARIO = 'America/Sao_Paulo'

/**
 * O Brasil aboliu o horário de verão em 2019, então o deslocamento é fixo.
 * Se voltar, troque este literal por uma biblioteca de fuso — o resto do
 * arquivo não muda.
 */
const DESLOCAMENTO_LOCAL = '-03:00'

// `en-CA` formata como `YYYY-MM-DD`, que é exatamente a chave que usamos.
const FORMATADOR = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO_HORARIO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Data ISO do instante, no fuso da operação — não em UTC. */
export function paraDataIso(momento: Date): string {
  return FORMATADOR.format(momento)
}

export function hojeIso(): string {
  return paraDataIso(new Date())
}

/** Instante em que o dia começa, no fuso da operação. */
export function inicioDoDia(dataIso: string): Date {
  return new Date(`${dataIso}T00:00:00.000${DESLOCAMENTO_LOCAL}`)
}

/** Instante em que o dia termina, no fuso da operação. */
export function fimDoDia(dataIso: string): Date {
  return new Date(`${dataIso}T23:59:59.999${DESLOCAMENTO_LOCAL}`)
}

export function inicioDoMes(dataIso: string): string {
  return `${dataIso.slice(0, 7)}-01`
}

/**
 * Aritmética sobre a CHAVE, não sobre o instante.
 *
 * Opera em meia-noite UTC de propósito: somar dias a uma data-calendário não
 * deve depender de fuso nenhum, e assim `2026-03-01` menos um dia é sempre
 * `2026-02-28`, independentemente de onde o servidor esteja.
 */
export function deslocarDias(dataIso: string, dias: number): string {
  const base = new Date(`${dataIso}T00:00:00.000Z`)
  base.setUTCDate(base.getUTCDate() + dias)
  return base.toISOString().slice(0, 10)
}

/** Sequência de datas ISO a partir de um início. Útil para simulação e seed. */
export function sequenciaDeDatas(inicio: string, total: number): string[] {
  return Array.from({ length: total }, (_, indice) => deslocarDias(inicio, indice))
}

/** Segunda-feira da semana ISO da data. Usado só na leitura do painel. */
export function inicioDaSemana(dataIso: string): string {
  const base = new Date(`${dataIso}T00:00:00.000Z`)
  const diaDaSemana = base.getUTCDay()
  const recuo = diaDaSemana === 0 ? 6 : diaDaSemana - 1
  return deslocarDias(dataIso, -recuo)
}
