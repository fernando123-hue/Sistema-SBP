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

/**
 * Um mapa por compartimento — o trecho da chave antes do primeiro `:`.
 *
 * Com um mapa só, abrir espaço tirava as chaves mais antigas de QUALQUER rota:
 * um colaborador logado inundava `distribuir:<id>:<data>` (a data vem do
 * corpo) e expulsava `ingestao:<id>`, zerando o próprio limite de custo da IA,
 * ou o balde de `sessao` (revisão de segurança do #70). Separados, uma
 * inundação só despeja chaves do próprio compartimento.
 *
 * O compartimento precisa ser escrito no código, nunca vir de fora: é ele que
 * limita quantos mapas existem.
 */
const compartimentos = new Map<string, Map<string, Janela>>()

function compartimentoDe(chave: string): Map<string, Janela> {
  const nome = chave.split(':', 1)[0] ?? ''
  let janelas = compartimentos.get(nome)
  if (!janelas) {
    janelas = new Map<string, Janela>()
    compartimentos.set(nome, janelas)
  }
  return janelas
}

/**
 * Teto de chaves por compartimento. Acima dele, uma limpeza roda antes de inserir.
 *
 * Hoje o espaço de chaves é raso (poucos colaboradores × poucas rotas), então o
 * mapa nunca chega perto disto. A trava existe para o dia em que alguma chave
 * passar a incluir algo ilimitado — IP de visitante, remetente de e-mail — e o
 * mapa virar vazamento de verdade num processo de vida longa.
 */
export const TETO_DE_CHAVES = 1000

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
  const janelas = compartimentoDe(chave)
  const janela = janelas.get(chave)

  if (!janela || janela.reiniciaEm <= agora) {
    // Limpeza oportunista: sem isto, `limparJanelasExpiradas` nunca rodaria —
    // a função existia sem nenhum chamador.
    if (janelas.size >= TETO_DE_CHAVES) abrirEspaco(janelas)

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

/**
 * Tira as janelas vencidas. Sozinha, NÃO segura o tamanho do mapa: com chaves
 * ativas sempre novas ele crescia sem fim (N-37). Quem garante o teto é
 * `abrirEspaco`.
 */
function limparJanelasExpiradas(janelas: Map<string, Janela>): void {
  const agora = Date.now()
  for (const [chave, janela] of janelas) {
    if (janela.reiniciaEm <= agora) janelas.delete(chave)
  }
}

/**
 * Garante lugar para uma chave nova sem passar do teto (achado N-37).
 *
 * Tirar só as vencidas não bastava: com mais de mil janelas ATIVAS — chaves que
 * incluem algo escolhido de fora — o mapa crescia sem fim. Depois da limpeza,
 * saem as mais antigas (o `Map` guarda a ordem de inserção). O custo é a
 * chave antiga recomeçar a contagem; a alternativa, recusar chave nova, seria
 * trancar quem chega depois de uma inundação.
 */
function abrirEspaco(janelas: Map<string, Janela>): void {
  limparJanelasExpiradas(janelas)
  for (const chave of janelas.keys()) {
    if (janelas.size < TETO_DE_CHAVES) break
    janelas.delete(chave)
  }
}

/** Só para testes. */
export function chavesNoLimitador(compartimento: string): number {
  return compartimentos.get(compartimento)?.size ?? 0
}

/** Só para testes. */
export function esvaziarLimitador(): void {
  compartimentos.clear()
}
