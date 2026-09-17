import { ErroOperacional } from '../core/erros'

/**
 * Onde a contagem de uso da IA é guardada e lida.
 *
 * Existe como port porque o invólucro de consumo (`adapters/cliente-com-consumo.ts`)
 * é infraestrutura de fronteira e não deve saber o que é Prisma. Quem liga os
 * dois é `fabrica.ts`, que é o lugar do sistema onde a fiação mora.
 */
export interface RegistroDeConsumo {
  /** Quantas chamadas este fornecedor já fez hoje, somando modelos e tarefas. */
  chamadasDoDia(fornecedor: string): Promise<number>
  registrar(chamada: {
    fornecedor: string
    modelo: string
    tarefa: 'interpretacao' | 'assistente'
    resultado: 'ok' | 'falha'
    duracaoMs: number
  }): Promise<void>
}

/**
 * A chamada não foi feita: teto diário atingido ou disjuntor aberto (`A54`).
 *
 * É indisponibilidade da camada de IA, não defeito deste e-mail nem desta
 * pergunta — quem trata precisa PARAR o lote, não tentar o próximo. É por isso
 * que `ia-estruturada.ts` e `assistente-modelo.ts` traduzem este erro para o
 * "indisponível" de cada tarefa em vez de deixá-lo virar falha de uma unidade.
 *
 * A mensagem sai inteira para a tela, como a de credencial recusada: ela diz o
 * teto, a hora em que as chamadas voltam e o nome da variável de ambiente, que
 * é exatamente o que quem está na tela precisa saber. Nunca carrega conteúdo
 * de e-mail.
 */
export class LimiteDeConsumoAtingido extends ErroOperacional {
  readonly codigo = 'LIMITE_DE_CONSUMO_IA'
  readonly statusHttp = 503

  constructor(
    readonly motivo: 'teto_diario' | 'disjuntor_aberto',
    mensagem: string,
  ) {
    super(mensagem)
  }
}
