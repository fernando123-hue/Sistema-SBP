import type { EmailBruto } from '../core/esquemas'

/**
 * Contrato da camada de entrada.
 *
 * Implementações: `mock` (seed sintético, V1) · `imap` · `graph` (M365) ·
 * `gmail`. Onde os e-mails moram é uma decisão pendente do cliente — este port
 * garante que a resposta não muda nenhuma linha do resto do sistema.
 *
 * Idempotência é responsabilidade do serviço, não do adapter: o adapter pode
 * devolver o mesmo e-mail duas vezes sem quebrar nada, porque a gravação usa
 * `messageId` como chave única.
 */
export interface IngestaoPort {
  readonly nome: string
  buscarNovos(desde?: Date): Promise<EmailBruto[]>
}
