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
