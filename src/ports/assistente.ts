import { ErroOperacional } from '../core/erros'
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
export class FalhaDoAssistente extends ErroOperacional {
  readonly codigo = 'FALHA_DO_ASSISTENTE'
  /** Transitório: a mesma pergunta costuma funcionar na tentativa seguinte. */
  readonly statusHttp = 503

  constructor(readonly causa: string) {
    super(`Não consegui responder agora: ${causa}`)
  }

  /**
   * A causa técnica fica no log.
   *
   * Aqui, ao contrário da ingestão, quem recebe a mensagem pode ser qualquer
   * pessoa da equipe — a ajuda não exige papel. "invalid_type em
   * itens.0.confianca" não diz nada a quem só queria tirar uma dúvida, e um
   * texto que a pessoa não entende a faz achar que fez algo errado.
   */
  override get mensagemPublica(): string {
    return 'Não consegui responder agora. Tente de novo em alguns instantes.'
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
export class AssistenteIndisponivelError extends ErroOperacional {
  readonly codigo = 'ASSISTENTE_INDISPONIVEL'
  readonly statusHttp = 503

  constructor(readonly causa: string) {
    super(`Assistente indisponível: ${causa}`)
  }

  /**
   * "API key not valid" NÃO sai daqui.
   *
   * A ajuda é aberta a qualquer pessoa autenticada, e a causa crua conta sobre
   * a infraestrutura mais do que quem tirou uma dúvida precisa saber. É a
   * diferença deliberada em relação a `InterpretacaoIndisponivelError`, cuja
   * rota exige operador ou gestor e cuja mensagem inteira é justamente o que
   * essa pessoa precisa ler. A causa completa continua no log.
   */
  override get mensagemPublica(): string {
    return 'A ajuda está indisponível no momento. Avise quem cuida do sistema.'
  }
}
