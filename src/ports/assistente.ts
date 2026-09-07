import type { QuemPergunta } from '../core/assistente/prompt'
import type { RespostaDoModeloAssistente } from '../core/assistente/esquemas'

/**
 * Contrato do assistente de ajuda.
 *
 * Deliberadamente SEPARADO de `AiPort`. As duas tarefas usam modelo de
 * linguagem, e é só o que têm em comum: `AiPort` lê e-mail de terceiro e
 * devolve item de trabalho; o assistente lê a pergunta de quem está logado e
 * devolve texto de ajuda. Fundir as duas num port só obrigaria quem
 * implementasse um a implementar o outro, e faria uma mudança na interpretação
 * de e-mail atravessar o assistente sem motivo.
 *
 * O que os dois compartilham de verdade é a camada de baixo — `ClienteDeModelo`
 * em `adapters/fornecedor.ts`, o "como falar com a API deste fornecedor". É lá
 * que a independência de fornecedor mora, e é por isso que ela vale para os
 * dois de graça.
 *
 * O RETORNO NÃO TEM AÇÃO, e não é esquecimento. O assistente não distribui, não
 * conclui, não transfere, não aprova revisão e não mexe em cadastro. Ele
 * responde texto e, no máximo, aponta uma tela. Toda operação continua
 * acontecendo pela rota da operação, com papel conferido e trilha gravada.
 */
export interface AssistentePort {
  readonly nome: string
  responder(quem: QuemPergunta, pergunta: string): Promise<RespostaDoModeloAssistente>
}

/**
 * A pergunta não pôde ser respondida — problema DESTA pergunta.
 *
 * Modelo devolveu formato inválido duas vezes, resposta vazia, geração
 * truncada. A pessoa recebe um aviso e pode tentar de novo; nada mais no
 * sistema é afetado.
 */
export class FalhaDoAssistente extends Error {
  readonly codigo = 'FALHA_DO_ASSISTENTE'

  constructor(readonly causa: string) {
    super(`Não consegui responder agora: ${causa}`)
    this.name = 'FalhaDoAssistente'
  }
}

/**
 * A camada de ajuda está fora — e o problema NÃO é desta pergunta.
 *
 * Chave recusada, permissão negada, conta sem crédito. Distinto de
 * `FalhaDoAssistente` pelo mesmo motivo que `InterpretacaoIndisponivelError` é
 * distinto de `FalhaDeInterpretacao`: a mensagem tem de mandar arrumar a
 * configuração, não sugerir que a pessoa reformule a pergunta e tente de novo.
 */
export class AssistenteIndisponivelError extends Error {
  readonly codigo = 'ASSISTENTE_INDISPONIVEL'

  constructor(readonly causa: string) {
    super(`Assistente indisponível: ${causa}`)
    this.name = 'AssistenteIndisponivelError'
  }
}
