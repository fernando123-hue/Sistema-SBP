import type { AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { ambiente } from '../servidor/ambiente'
import { IaMock } from './ia-mock'
import { IngestaoMock, type OpcoesIngestaoMock } from './ingestao-mock'

/**
 * Escolha do adapter a partir do ambiente.
 *
 * Existe porque `IA_ADAPTER` era validado em `ambiente.ts` — inclusive exigindo
 * `ANTHROPIC_API_KEY` quando valia `"anthropic"` — e a rota de ingestão
 * instanciava `new IaMock()` incondicionalmente. Configurar o adapter real
 * passava em toda a validação e continuava rodando o mock em silêncio: a
 * classe de erro que este sistema existe para eliminar.
 *
 * Agora, pedir um adapter não implementado FALHA, e falha dizendo o que falta.
 */

export class AdapterIndisponivelError extends Error {
  readonly codigo = 'ADAPTER_INDISPONIVEL'

  constructor(tipo: string, nome: string) {
    super(
      `Adapter de ${tipo} "${nome}" ainda não foi implementado. ` +
        `Ajuste a variável de ambiente ou implemente o adapter.`,
    )
    this.name = 'AdapterIndisponivelError'
  }
}

export function criarAiPort(): AiPort {
  const nome = ambiente().IA_ADAPTER
  switch (nome) {
    case 'mock':
      return new IaMock()
    default:
      throw new AdapterIndisponivelError('IA', nome)
  }
}

export function criarIngestaoPort(opcoes: OpcoesIngestaoMock): IngestaoPort {
  const nome = ambiente().INGESTAO_ADAPTER
  switch (nome) {
    case 'mock':
      return new IngestaoMock(opcoes)
    default:
      throw new AdapterIndisponivelError('ingestão', nome)
  }
}
