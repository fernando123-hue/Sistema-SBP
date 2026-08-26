/**
 * Limitador de taxa em memória.
 *
 * Suficiente para um processo único, que é o caso do protótipo. Ao escalar para
 * múltiplas instâncias, trocar por Redis — a interface não muda.
 *
 * Existe principalmente para as rotas caras: sincronização de ingestão (chama
 * modelo de IA, custa dinheiro) e confirmação de distribuição (transação longa).
 * Um clique repetido de operador impaciente não pode virar dez rodadas.
 */

interface Janela {
  contagem: number
  reiniciaEm: number
}

const janelas = new Map<string, Janela>()

/**
 * Acima deste tamanho, uma limpeza oportunista roda antes de inserir.
 *
 * Hoje o espaço de chaves é raso (poucos colaboradores × poucas rotas), então o
 * mapa nunca chega perto disto. A trava existe para o dia em que alguma chave
 * passar a incluir algo ilimitado — IP de visitante, remetente de e-mail — e o
 * mapa virar vazamento de verdade num processo de vida longa.
 */
const TETO_DE_CHAVES = 1000

export interface ResultadoDoLimite {
  permitido: boolean
  restante: number
  reiniciaEmSegundos: number
}

export function verificarLimite(
  chave: string,
  maximo: number,
  janelaSegundos: number,
): ResultadoDoLimite {
  const agora = Date.now()
  const janela = janelas.get(chave)

  if (!janela || janela.reiniciaEm <= agora) {
    // Limpeza oportunista: sem isto, `limparJanelasExpiradas` nunca rodaria —
    // a função existia sem nenhum chamador.
    if (janelas.size >= TETO_DE_CHAVES) limparJanelasExpiradas()

    janelas.set(chave, { contagem: 1, reiniciaEm: agora + janelaSegundos * 1000 })
    return { permitido: true, restante: maximo - 1, reiniciaEmSegundos: janelaSegundos }
  }

  janela.contagem += 1
  const reiniciaEmSegundos = Math.ceil((janela.reiniciaEm - agora) / 1000)

  if (janela.contagem > maximo) {
    return { permitido: false, restante: 0, reiniciaEmSegundos }
  }

  return { permitido: true, restante: maximo - janela.contagem, reiniciaEmSegundos }
}

/** Evita crescimento sem limite do mapa em processo longo. */
export function limparJanelasExpiradas(): void {
  const agora = Date.now()
  for (const [chave, janela] of janelas) {
    if (janela.reiniciaEm <= agora) janelas.delete(chave)
  }
}
