/**
 * Contrato do armazenamento de arquivos.
 *
 * Os BYTES de um anexo nunca entram no banco: o banco guarda o metadado e a
 * `chaveArmazenamento`, e os bytes vivem aqui. Isso mantém a tabela pequena,
 * permite retenção separada do arquivo e da linha, e deixa a troca de disco
 * local por S3/Azure ser a troca de um adapter.
 *
 * Implementações: `disco` (protótipo) · futuramente `s3` | `azure`.
 *
 * A chave é opaca para quem chama: quem a constrói é o adapter, e ninguém
 * deve deduzir caminho de arquivo a partir dela.
 */
export interface ArmazenamentoPort {
  readonly nome: string

  /** Guarda os bytes e devolve a chave para recuperá-los. */
  guardar(bytes: Uint8Array, extensao: string): Promise<string>

  /** Devolve os bytes, ou `null` se a chave não existe mais (expurgo, por exemplo). */
  ler(chave: string): Promise<Uint8Array | null>

  /** Remove os bytes. Idempotente: remover o que já não existe não é erro. */
  remover(chave: string): Promise<void>
}

export class FalhaDeArmazenamento extends Error {
  readonly codigo = 'FALHA_DE_ARMAZENAMENTO'

  constructor(operacao: string, causa: string) {
    super(`Falha ao ${operacao} arquivo no armazenamento: ${causa}`)
    this.name = 'FalhaDeArmazenamento'
  }
}
