import { ErroOperacional } from '../core/erros'
import { inicioDoDia } from '../core/util/datas'
import type { ArmazenamentoPort } from '../ports/armazenamento'
import type { AssistentePort } from '../ports/assistente'
import type { AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { ambiente } from '../servidor/ambiente'
import { ArmazenamentoEmDisco } from './armazenamento-disco'
import { AssistentePorBusca } from './assistente-busca'
import { AssistenteComModelo } from './assistente-modelo'
import { clienteAnthropic, IaAnthropic, PERFIL_ANTHROPIC } from './ia-anthropic'
import { clienteGemini, IaGemini, PERFIL_GEMINI } from './ia-gemini'
import { clienteLocal, IaLocal, PERFIL_LOCAL } from './ia-local'
import { IaMock } from './ia-mock'
import { clienteDoGraph, IngestaoGraph, IngestaoIndisponivelError } from './ingestao-graph'
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

export class AdapterIndisponivelError extends ErroOperacional {
  readonly codigo = 'ADAPTER_INDISPONIVEL'
  /** Configuração, não defeito: quem lê precisa saber que a variável está errada. */
  readonly statusHttp = 503

  constructor(tipo: string, nome: string) {
    super(
      `Adapter de ${tipo} "${nome}" ainda não foi implementado. ` +
        `Ajuste a variável de ambiente ou implemente o adapter.`,
    )
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
    case 'local':
      return new IaLocal()
    default:
      throw new AdapterIndisponivelError('IA', nome)
  }
}

/**
 * O assistente de ajuda, pelo MESMO `IA_ADAPTER`.
 *
 * Uma variável só para as duas tarefas de IA, e não uma segunda variável para
 * o assistente, porque a pergunta que ela responde é a mesma e tem consequência
 * de privacidade: **qual empresa processa o texto que sai desta casa.** Duas
 * chaves permitiriam configurar interpretação num fornecedor e ajuda em outro
 * sem ninguém decidir isso — e a autorização do dado sair da casa é por
 * fornecedor, não por funcionalidade (`DECISOES.md`, 27/08/2026).
 *
 * `mock` cai na busca no manual: determinística, sem rede, sem custo. Não é
 * degradação em silêncio — a resposta carrega o nome do adapter que a produziu,
 * e a tela mostra.
 */
export function criarAssistentePort(): AssistentePort {
  const nome = ambiente().IA_ADAPTER
  switch (nome) {
    case 'mock':
      return new AssistentePorBusca()
    case 'anthropic':
      return new AssistenteComModelo(PERFIL_ANTHROPIC, clienteAnthropic())
    case 'gemini':
      return new AssistenteComModelo(PERFIL_GEMINI, clienteGemini())
    case 'local':
      return new AssistenteComModelo(PERFIL_LOCAL, clienteLocal())
    default:
      throw new AdapterIndisponivelError('assistente', nome)
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

/**
 * De onde os e-mails vêm.
 *
 * As opções são do MOCK e o `graph` as ignora: o adapter real não inventa
 * datas nem semente, ele lê a caixa. Manter um parâmetro só evita mexer na
 * rota de ingestão para acrescentar um fornecedor — que é a mesma promessa que
 * `criarAiPort` cumpre desde o segundo modelo de IA.
 */
export function criarIngestaoPort(opcoes: OpcoesIngestaoMock): IngestaoPort {
  const nome = ambiente().INGESTAO_ADAPTER
  switch (nome) {
    case 'mock':
      return new IngestaoMock(opcoes)
    case 'graph': {
      const lerDesde = ambiente().GRAPH_LER_DESDE
      // Falha alta e nominal, como as credenciais: sem a data, a primeira
      // leitura pegaria tudo o que a planilha já tratou (`AT-35`).
      if (!lerDesde) {
        throw new IngestaoIndisponivelError(
          'INGESTAO_ADAPTER="graph" exige GRAPH_LER_DESDE (AAAA-MM-DD): o dia a partir do qual a caixa é lida.',
        )
      }
      return new IngestaoGraph(clienteDoGraph(), { lerDesde: inicioDoDia(lerDesde) })
    }
    default:
      throw new AdapterIndisponivelError('ingestão', nome)
  }
}
