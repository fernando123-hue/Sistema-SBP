import type { ArmazenamentoPort, ArquivoGuardado } from '../ports/armazenamento'

/**
 * Armazenamento em memória para os testes que precisam de UM, mas não testam
 * o disco — o adapter de disco tem testes próprios contra o disco de verdade.
 *
 * A limpeza diária exige armazenamento desde o `A78`: sem ele, a varredura de
 * anexo sem registro falha alto. Os testes da rotina passam este.
 */
export class ArmazenamentoEmMemoria implements ArmazenamentoPort {
  readonly nome = 'memoria'
  private readonly arquivos = new Map<string, { bytes: Uint8Array; gravadoEm: Date }>()
  private proxima = 0

  async guardar(bytes: Uint8Array, extensao = ''): Promise<string> {
    this.proxima += 1
    const chave = `memoria/${this.proxima}${extensao}`
    this.arquivos.set(chave, { bytes, gravadoEm: new Date() })
    return chave
  }

  /** Um arquivo gravado em `gravadoEm` — é por essa data que a limpeza decide. */
  colocar(chave: string, gravadoEm: Date): void {
    this.arquivos.set(chave, { bytes: new Uint8Array([1, 2, 3]), gravadoEm })
  }

  async ler(chave: string): Promise<Uint8Array | null> {
    return this.arquivos.get(chave)?.bytes ?? null
  }

  async remover(chave: string): Promise<void> {
    this.arquivos.delete(chave)
  }

  async listar(): Promise<ArquivoGuardado[]> {
    return [...this.arquivos].map(([chave, arquivo]) => ({ chave, gravadoEm: arquivo.gravadoEm }))
  }
}
