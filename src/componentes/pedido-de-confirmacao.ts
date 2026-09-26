/**
 * O que o leitor de tela ouve quando "Concluir" ou "Descartar" pede o segundo
 * clique (pendência 5).
 *
 * Posição e título não são enfeite: armar um segundo item com a mesma frase
 * não muda a região viva, e o leitor fica calado (revisão do #128). Só o
 * título não basta — a fila repete títulos ("Ficha de atualização cadastral"
 * várias vezes); a posição na lista é única.
 */
export function pedidoDeConfirmacao(
  acao: 'concluir' | 'descartar',
  titulo: string | undefined,
  posicao: number,
): string {
  const qual = posicao < 0 || titulo === undefined ? 'o item' : `o ${posicao + 1}º item, «${titulo}»`
  const nome = acao === 'concluir' ? 'Concluir' : 'Descartar'
  return `Para ${acao} ${qual}, aperte o mesmo botão de novo. ${nome} não tem volta.`
}
