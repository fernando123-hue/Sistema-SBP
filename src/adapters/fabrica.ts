import { ErroOperacional } from '../core/erros'
import { LIMITES_PADRAO } from '../core/ia/consumo'
import { inicioDoDia } from '../core/util/datas'
import type { ArmazenamentoPort } from '../ports/armazenamento'
import type { AssistentePort } from '../ports/assistente'
import type { AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { chamadasDoDia, registrarChamada } from '../servicos/consumo-da-ia'
import { ambiente } from '../servidor/ambiente'
import { obterPrisma } from '../servidor/prisma'
import { ArmazenamentoEmDisco } from './armazenamento-disco'
import { comControleDeConsumo } from './cliente-com-consumo'
import { AssistentePorBusca } from './assistente-busca'
import { AssistenteComModelo } from './assistente-modelo'
import type { ClienteDeModelo } from './fornecedor'
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
      // Sem invólucro de propósito: o mock não chama ninguém e não custa nada.
      // Contá-lo inflaria o teto do fornecedor de verdade e encheria a tabela
      // de uso com o que a suíte faz.
      return new IaMock()
    case 'anthropic':
      return new IaAnthropic(controlar(clienteAnthropic(), 'anthropic', 'interpretacao'))
    case 'gemini':
      return new IaGemini(controlar(clienteGemini(), 'gemini', 'interpretacao'))
    case 'local':
      return new IaLocal(controlar(clienteLocal(), 'local', 'interpretacao'))
    default:
      throw new AdapterIndisponivelError('IA', nome)
  }
}

/**
 * O teto diário e o disjuntor em volta do cliente (`A54`, achado C-06).
 *
 * Aqui, e não dentro de cada adapter, porque esta é a fiação: o invólucro é
 * política do sistema, a contagem é banco, e nenhum dos dois pertence a um
 * fornecedor. É também o único lugar do sistema que importa `servicos/` para
 * dentro de `adapters/` — a fábrica é a raiz de composição, e é dela o
 * trabalho de juntar as duas metades.
 */
function controlar(
  cliente: ClienteDeModelo,
  fornecedor: string,
  tarefa: 'interpretacao' | 'assistente',
): ClienteDeModelo {
  const banco = obterPrisma()
  const tetoConfigurado = ambiente().IA_TETO_DIARIO

  return comControleDeConsumo(cliente, {
    fornecedor,
    tarefa,
    registro: {
      chamadasDoDia: (qual) => chamadasDoDia(banco, qual),
      registrar: (chamada) => registrarChamada(banco, chamada),
    },
    limites:
      tetoConfigurado === undefined
        ? LIMITES_PADRAO
        : { ...LIMITES_PADRAO, tetoDiarioDeChamadas: tetoConfigurado },
  })
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
      return new AssistenteComModelo(PERFIL_ANTHROPIC, controlar(clienteAnthropic(), 'anthropic', 'assistente'))
    case 'gemini':
      return new AssistenteComModelo(PERFIL_GEMINI, controlar(clienteGemini(), 'gemini', 'assistente'))
    case 'local':
      return new AssistenteComModelo(PERFIL_LOCAL, controlar(clienteLocal(), 'local', 'assistente'))
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
