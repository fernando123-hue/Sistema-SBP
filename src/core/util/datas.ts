/**
 * Datas.
 *
 * A planilha usa `1..31` na coluna A — sem mês, sem ano, sem dia da semana.
 * Aqui a chave temporal é sempre ISO `YYYY-MM-DD`, ordenável como texto, e o
 * "mês" deixa de ser uma aba para virar um filtro.
 */

export function paraDataIso(momento: Date): string {
  return momento.toISOString().slice(0, 10)
}

export function hojeIso(): string {
  return paraDataIso(new Date())
}

export function inicioDoMes(dataIso: string): string {
  return `${dataIso.slice(0, 7)}-01`
}

export function deslocarDias(dataIso: string, dias: number): string {
  const base = new Date(`${dataIso}T00:00:00.000Z`)
  base.setUTCDate(base.getUTCDate() + dias)
  return paraDataIso(base)
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
