/**
 * O que o leitor de tela ouve quando "Concluir" ou "Descartar" pede o segundo
 * clique (pendência 5).
 *
 * "Item 8 de 48", e não o título. Duas razões (revisões do #128):
 *
 * 1. A frase tem de MUDAR de um item para outro — região viva com o mesmo
 *    texto não é lida de novo, e armar o segundo item ficava em silêncio. O
 *    título não garante isso (a fila repete títulos); a posição garante, e
 *    "8 de 48" é o formato que o próprio leitor usa numa lista.
 * 2. O título vem da IA, que o escreveu lendo o e-mail. Falado no meio de uma
 *    frase do sistema, ele soaria como o sistema — as aspas não são
 *    pronunciadas —, e um e-mail poderia ditar o aviso de um ato sem volta.
 *    Anúncio por voz não lê texto que veio de fora (`DECISOES.md § AT-48`).
 */
export function pedidoDeConfirmacao(acao: 'concluir' | 'descartar', posicao: number, total: number): string {
  const qual = posicao < 0 || total < 1 ? 'o item' : `o item ${posicao + 1} de ${total}`
  const nome = acao === 'concluir' ? 'Concluir' : 'Descartar'
  return `Para ${acao} ${qual}, aperte o mesmo botão de novo. ${nome} não tem volta.`
}
