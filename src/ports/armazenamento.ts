import { ErroOperacional } from '../core/erros'
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

  /**
   * Confere, antes de qualquer trabalho, que a chave em uso é a que cifrou os
   * anexos existentes. Lança `ChaveDosAnexosMudouError` quando não é.
   *
   * Opcional porque só faz sentido para quem cifra — o duble em memória dos
   * testes não tem o que conferir. Quem vai fazer trabalho CARO antes de
   * guardar (a ingestão chama a IA antes) deve chamar isto primeiro: conferir
   * dentro de `guardar` só descobriria a chave errada depois de pagar cada
   * chamada.
   */
  conferirChave?(): Promise<void>
}

export class FalhaDeArmazenamento extends ErroOperacional {
  readonly codigo = 'FALHA_DE_ARMAZENAMENTO'
  /** Disco cheio, permissão negada, caminho inválido: repetir sozinho não resolve. */
  readonly statusHttp = 503

  constructor(operacao: string, causa: string) {
    super(`Falha ao ${operacao} arquivo no armazenamento: ${causa}`)
  }

  /**
   * A causa crua fica no log; a tela recebe só o fato.
   *
   * A mensagem embute o `erro.message` do sistema de arquivos, que traz o
   * caminho absoluto do servidor (`ENOENT: ... open 'C:\...\armazenamento\ab\...'`).
   * Hoje nenhuma rota serve anexo e a ingestão captura a falha antes da
   * fronteira, então isso não chegava a ninguém — mas passaria a chegar no dia
   * da rota de download (`DECISOES.md § H.4` item 15). Revisão do PR #35.
   */
  override get mensagemPublica(): string {
    return 'Falha ao acessar o armazenamento de anexos. O detalhe está no log do servidor.'
  }
}

const CHAVE_DOS_ANEXOS_MUDOU =
  'A chave em uso NÃO é a que cifrou os anexos desta pasta — ANEXOS_SECRET (ou SESSAO_SECRET, ' +
  'quando ANEXOS_SECRET não está definido) mudou. Nada foi lido nem gravado. Volte a chave ' +
  'anterior, ou fixe ANEXOS_SECRET com o valor antigo antes de trocar o segredo de sessão.'

/**
 * A chave em uso não é a que cifrou os anexos.
 *
 * Classe própria porque, ao contrário da falha genérica de disco, a mensagem
 * inteira É o que quem opera precisa ler — e ela não tem caminho de arquivo nem
 * segredo, só o nome das variáveis. A genérica esconde a causa; esta a mostra.
 */
export class ChaveDosAnexosMudouError extends FalhaDeArmazenamento {
  constructor() {
    super('conferir a chave de', CHAVE_DOS_ANEXOS_MUDOU)
  }

  override get mensagemPublica(): string {
    return CHAVE_DOS_ANEXOS_MUDOU
  }
}
