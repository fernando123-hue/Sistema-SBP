import type { ArmazenamentoPort } from '../ports/armazenamento'
import type { AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { ambiente } from '../servidor/ambiente'
import { ArmazenamentoEmDisco } from './armazenamento-disco'
import { IaAnthropic } from './ia-anthropic'
import { IaGemini } from './ia-gemini'
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

/**
 * O único lugar do sistema que sabe qual fornecedor de IA está atendendo.
 *
 * Acrescentar o Gemini em 07/09/2026 custou UMA linha aqui e um valor a mais no
 * enum de `IA_ADAPTER` — nenhum arquivo de `servicos/`, `app/` ou `core/` foi
 * tocado. Era o que a fronteira `AiPort` prometia, e passou a ser o que ela
 * comprovadamente entrega.
 *
 * A regra que mantém isso verdadeiro: ninguém importa `IaAnthropic` ou
 * `IaGemini` fora daqui. Quem precisa de interpretação pede `AiPort`.
 */
export function criarAiPort(): AiPort {
  const nome = ambiente().IA_ADAPTER
  switch (nome) {
    case 'mock':
      return new IaMock()
    case 'anthropic':
      return new IaAnthropic()
    case 'gemini':
      return new IaGemini()
    default:
      throw new AdapterIndisponivelError('IA', nome)
  }
}

/**
 * Armazenamento dos arquivos de anexo.
 *
 * Só existe a implementação em disco hoje. Quando entrar nuvem, este é o único
 * lugar que escolhe — o serviço de ingestão fala com o port.
 */
export function criarArmazenamentoPort(): ArmazenamentoPort {
  return new ArmazenamentoEmDisco()
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
