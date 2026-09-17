import type { EmailBruto } from '../core/esquemas'

/**
 * O que o adapter conta a quem pediu, além dos e-mails.
 *
 * - `recusado`: uma mensagem que não pôde virar e-mail do sistema. Ela NÃO
 *   derruba as outras (achado C-02); quem pediu registra a falha pelo nome,
 *   para uma pessoa tratá-la na caixa. O `motivo` nunca repete conteúdo.
 * - `adiados`: havia mais mensagens novas do que o teto de uma leitura; as
 *   mais antigas vieram agora, o resto vem na próxima (achado C-03).
 * - `colisao`: a mensagem tem o identificador de um e-mail já processado, mas
 *   chegou em outra data. Pode ser cópia legítima (lista, reentrega) ou
 *   falsificação — o identificador é escrito por quem manda. Não é lida (a
 *   chave é a mesma), e não conta no teto; quem pediu deixa registrado.
 */
export type AvisoDaBusca =
  | { tipo: 'recusado'; messageId: string; recebidoEm: string | null; motivo: string }
  | { tipo: 'adiados'; quantidade: number }
  | { tipo: 'colisao'; messageId: string; recebidoEm: string | null }

export interface PedidoDeBusca {
  /** Mensagens recebidas antes disto não são lidas. */
  desde?: Date
  /**
   * Dos identificadores dados, quais já viraram trabalho — e com que data de
   * chegada foram gravados.
   *
   * Existe para o adapter descartar o que já foi processado ANTES do teto e
   * antes de baixar anexo: sem isso, uma janela com mais mensagens antigas do
   * que o teto nunca chegaria às novas. A data separa a mesma mensagem lida de
   * novo (descarte calado) de outra mensagem com a mesma chave (`colisao`).
   */
  jaProcessados?: (messageIds: string[]) => Promise<ReadonlyMap<string, Date>>
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
