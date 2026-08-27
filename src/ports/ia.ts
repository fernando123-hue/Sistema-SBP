import type { EmailBruto, Interpretacao } from '../core/esquemas'

/**
 * Contrato da camada de interpretação.
 *
 * A IA lê linguagem natural e devolve estrutura. Ela NUNCA:
 *   - calcula divisão
 *   - escolhe quem recebe
 *   - trata o resto
 *   - soma, agrega ou calcula percentual
 *   - grava qualquer coisa
 *
 * O retorno passa obrigatoriamente por `InterpretacaoSchema`. Uma resposta que
 * não valida é falha de interpretação — o e-mail vai para revisão humana, não
 * para o motor.
 */
export interface AiPort {
  readonly nome: string
  interpretar(email: EmailBruto): Promise<Interpretacao>
}

export class FalhaDeInterpretacao extends Error {
  constructor(
    readonly messageId: string,
    readonly causa: string,
  ) {
    super(`Falha ao interpretar o e-mail "${messageId}": ${causa}`)
    this.name = 'FalhaDeInterpretacao'
  }
}

/**
 * A camada de interpretação está fora — e o problema NÃO é deste e-mail.
 *
 * Chave recusada, permissão negada, conta sem crédito. Tratar isso como
 * falha de um e-mail faria o lote inteiro morrer um a um: mil chamadas
 * condenadas, mil linhas de log idênticas, e a causa real — uma variável de
 * ambiente errada — enterrada no meio delas. Este erro sobe ACIMA do laço de
 * ingestão: o lote para na primeira ocorrência e a mensagem diz o que arrumar.
 */
export class InterpretacaoIndisponivelError extends Error {
  constructor(readonly causa: string) {
    super(`Camada de interpretação indisponível: ${causa}`)
    this.name = 'InterpretacaoIndisponivelError'
  }
}
