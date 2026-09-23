import {
  aposChamada,
  DISJUNTOR_FECHADO,
  impedimentoParaChamar,
  LIMITES_PADRAO,
  type EstadoDoDisjuntor,
  type LimitesDeConsumo,
} from '../core/ia/consumo'
import { LimiteDeConsumoAtingido, type RegistroDeConsumo } from '../ports/consumo'
import { registrarLog } from '../servidor/observabilidade'
import { especieDoErro, type ClienteDeModelo } from './fornecedor'

/**
 * Teto diário e disjuntor em volta de qualquer `ClienteDeModelo` (`A54`, C-06).
 *
 * ═══ POR QUE AQUI, E NÃO DENTRO DE CADA ADAPTER ═══
 *
 * "Quanto se aceita gastar" e "o fornecedor está fora do ar" são decisões
 * DESTE sistema, não de um fornecedor — a mesma razão que mantém as três
 * camadas contra injeção em `ia-estruturada.ts`. Escrito uma vez, em volta do
 * cliente, vale para Anthropic, Gemini e servidor local, e para as duas
 * tarefas de IA (interpretar e-mail e responder pergunta), sem que nenhum
 * adapter saiba que isto existe.
 *
 * ═══ O DISJUNTOR MORA NA MEMÓRIA, E ISSO É ESCOLHA ═══
 *
 * Ele responde "o fornecedor está fora do ar AGORA", que dura minutos. Guardá-lo
 * no banco custaria uma escrita por chamada para uma informação que morre
 * sozinha, e um servidor reiniciado descobre a queda na primeira chamada. Com
 * mais de um processo servindo, cada um o descobre uma vez — o custo assumido
 * é N chamadas a mais, não um lote inteiro.
 *
 * O teto diário é o oposto: é sobre a conta do mês, precisa sobreviver a
 * reinício e valer para todos os processos. Por isso ele é contado no banco
 * (`servicos/consumo-da-ia.ts`).
 */

/**
 * Um disjuntor POR FORNECEDOR, compartilhado pelas tarefas.
 *
 * O que está fora do ar é o fornecedor. Se cada tarefa tivesse o seu, o
 * assistente redescobriria, pagando, a queda que a ingestão acabou de
 * encontrar.
 */
const disjuntores = new Map<string, EstadoDoDisjuntor>()

/** Só para testes: o estado é de processo e não deve vazar de um caso para o outro. */
export function esquecerDisjuntores(): void {
  disjuntores.clear()
}

export interface OpcoesDeConsumo {
  fornecedor: string
  tarefa: 'interpretacao' | 'assistente'
  registro: RegistroDeConsumo
  limites?: LimitesDeConsumo
}

export function comControleDeConsumo(cliente: ClienteDeModelo, opcoes: OpcoesDeConsumo): ClienteDeModelo {
  const limites = opcoes.limites ?? LIMITES_PADRAO

  return {
    async gerar(pedido) {
      const estado = disjuntores.get(opcoes.fornecedor) ?? DISJUNTOR_FECHADO
      const impedimento = impedimentoParaChamar({
        estado,
        chamadasHoje: await contarSemDerrubar(opcoes),
        agora: new Date(),
        limites,
      })

      if (impedimento) {
        // Não é registrado como chamada: nada foi pedido ao fornecedor, e
        // contar isto inflaria justamente o número que decide o teto.
        registrarLog('aviso', 'chamada à IA impedida pelo controle de consumo', {
          fornecedor: opcoes.fornecedor,
          tarefa: opcoes.tarefa,
          motivo: impedimento.motivo,
        })
        throw new LimiteDeConsumoAtingido(impedimento.motivo, impedimento.mensagem)
      }

      const inicio = Date.now()
      try {
        const resultado = await cliente.gerar(pedido)
        anotarNoDisjuntor(opcoes.fornecedor, 'ok', limites)
        // O modelo REAL usado, não o apelido pedido: é ele que tem preço.
        await anotar(opcoes, resultado.modeloUsado, 'ok', Date.now() - inicio)
        return resultado
      } catch (erro) {
        // Falha de FORMA não abre o disjuntor: o fornecedor respondeu, quem
        // errou foi a resposta. Suspender a IA inteira por dois e-mails
        // difíceis seguidos seria trocar um problema pequeno por um grande.
        const conta = especieDoErro(erro) === 'transporte' ? 'falha' : 'ok'
        anotarNoDisjuntor(opcoes.fornecedor, conta, limites)
        await anotar(opcoes, pedido.modelo, 'falha', Date.now() - inicio)
        throw erro
      }
    },
  }
}

/**
 * Guarda o resultado no disjuntor LENDO O ESTADO NA HORA DE GRAVAR.
 *
 * O estado usado para DECIDIR é lido antes da chamada ao fornecedor, e entre
 * essa leitura e a gravação existe um `await` que dura segundos. Gravar a
 * partir da cópia velha perdia falha: duas chamadas simultâneas liam "1", as
 * duas falhavam, as duas gravavam "2", e o disjuntor abria uma rodada depois
 * do prometido. O contrário também acontecia — uma chamada lenta que falhava
 * reabria, com informação vencida, um disjuntor que outra acabara de fechar.
 *
 * `Map` do JavaScript não é atômico, mas um `get`+`set` sem `await` no meio
 * roda inteiro dentro do mesmo passo do laço de eventos: é o bastante aqui,
 * onde não há paralelismo real de memória.
 */
function anotarNoDisjuntor(fornecedor: string, resultado: 'ok' | 'falha', limites: LimitesDeConsumo): void {
  const atual = disjuntores.get(fornecedor) ?? DISJUNTOR_FECHADO
  disjuntores.set(fornecedor, aposChamada(atual, resultado, new Date(), limites))
}

/**
 * A contagem do dia, ou `null` quando o banco não respondeu.
 *
 * ═══ POR QUE ISTO EXISTE ═══
 *
 * A regra "a contabilidade nunca derruba a chamada" estava escrita logo
 * abaixo, no caminho de GRAVAÇÃO, e valia só lá. A LEITURA — que roda antes
 * de falar com o fornecedor — era aguardada crua: bastava o banco piscar para
 * o erro do Prisma subir inteiro e matar a chamada. O sistema ficava sem IA
 * porque a contabilidade caiu, que é o contrário do que o teto existe para
 * fazer.
 *
 * Medido, não suposto: com o MySQL fora, `npm run ia:avaliar` falhou nos 17
 * casos do gabarito, e a planilha de notas imprimia um pedaço de stack do
 * Prisma no lugar do motivo — quem lesse concluiria que o MODELO falhou, e
 * escolheria modelo com base em ruído de infraestrutura.
 *
 * Em produção era pior: uma oscilação do banco durante a ingestão derrubaria
 * e-mail por e-mail, cada um virando `reprocessavel` para a próxima
 * sincronização tentar de novo.
 *
 * `null`, e não `0`: zero significaria "nenhuma chamada hoje" e desligaria o
 * teto por baixo do pano. Quem decide o que fazer sem a contagem é a política
 * pura em `core/ia/consumo.ts`, onde a escolha está escrita.
 */
async function contarSemDerrubar(opcoes: OpcoesDeConsumo): Promise<number | null> {
  try {
    return await opcoes.registro.chamadasDoDia(opcoes.fornecedor)
  } catch (erro) {
    registrarLog('erro', 'não foi possível contar o uso da IA de hoje — o teto diário fica sem valer nesta chamada', {
      fornecedor: opcoes.fornecedor,
      tarefa: opcoes.tarefa,
      causa: erro instanceof Error ? erro.message : String(erro),
    })
    return null
  }
}

/**
 * A contabilidade nunca derruba a chamada.
 *
 * Perder uma resposta já paga porque o banco piscou seria trocar trabalho por
 * contagem. A falha vai para o log — alto o bastante para alguém ver, baixo o
 * bastante para não custar o que ela deveria proteger.
 */
async function anotar(
  opcoes: OpcoesDeConsumo,
  modelo: string,
  resultado: 'ok' | 'falha',
  duracaoMs: number,
): Promise<void> {
  try {
    await opcoes.registro.registrar({
      fornecedor: opcoes.fornecedor,
      modelo,
      tarefa: opcoes.tarefa,
      resultado,
      duracaoMs,
    })
  } catch (erro) {
    registrarLog('erro', 'não foi possível registrar o uso da IA', {
      fornecedor: opcoes.fornecedor,
      tarefa: opcoes.tarefa,
      causa: erro instanceof Error ? erro.message : String(erro),
    })
  }
}
