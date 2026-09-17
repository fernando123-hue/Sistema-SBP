import type { EmailBruto } from '../core/esquemas'

/**
 * O que o adapter conta a quem pediu, além dos e-mails.
 *
 * - `recusado`: uma mensagem que não pôde virar e-mail do sistema. Ela NÃO
 *   derruba as outras (achado C-02); quem pediu registra a falha pelo nome,
 *   para uma pessoa tratá-la na caixa. O `motivo` nunca repete conteúdo.
 * - `adiados`: havia mais mensagens novas do que o teto de uma leitura; as
 *   mais antigas vieram agora, o resto vem na próxima (achado C-03).
 */
export type AvisoDaBusca =
  | { tipo: 'recusado'; messageId: string; recebidoEm: string | null; motivo: string }
  | { tipo: 'adiados'; quantidade: number }

export interface PedidoDeBusca {
  /** Mensagens recebidas antes disto não são lidas. */
  desde?: Date
  /**
   * Dos identificadores dados, quais já viraram trabalho.
   *
   * Existe para o adapter descartar o que já foi processado ANTES do teto e
   * antes de baixar anexo: sem isso, uma janela com mais mensagens antigas do
   * que o teto nunca chegaria às novas.
   */
  jaProcessados?: (messageIds: string[]) => Promise<ReadonlySet<string>>
  avisar?: (aviso: AvisoDaBusca) => void
}

/**
 * Contrato da camada de entrada.
 *
 * Implementações: `mock` (seed sintético, V1) · `imap` · `graph` (M365) ·
 * `gmail`. Onde os e-mails moram é uma decisão pendente do cliente — este port
 * garante que a resposta não muda nenhuma linha do resto do sistema.
 *
 * Idempotência é responsabilidade do serviço, não do adapter: o adapter pode
 * devolver o mesmo e-mail duas vezes sem quebrar nada, porque a gravação usa
 * `messageId` como chave única. `jaProcessados` é economia, não garantia.
 */
export interface IngestaoPort {
  readonly nome: string
  buscarNovos(pedido?: PedidoDeBusca): Promise<EmailBruto[]>
}
