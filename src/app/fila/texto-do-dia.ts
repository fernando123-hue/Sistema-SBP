/**
 * A frase do "hoje você concluiu N" da Minha fila (`A69`, 5A).
 *
 * Com zero, nada: "você ainda não concluiu nenhum" no começo da manhã é
 * cobrança, e o dono pediu que o sistema não pressione ninguém (`A71`). O
 * número aparece quando há o que mostrar, como sensação de avanço do dia.
 * `null` é a contagem que falhou: a fila segue sem a frase.
 */
export function textoDoDia(concluidos: number | null): string | null {
  if (concluidos === null || concluidos <= 0) return null
  return concluidos === 1 ? 'Hoje você concluiu 1 item.' : `Hoje você concluiu ${concluidos} itens.`
}
