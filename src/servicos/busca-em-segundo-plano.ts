import { ErroOperacional } from '../core/erros'
import type { EstadoDaBusca } from '../core/tipos'
import { exigirPapel, type Ator } from '../servidor/ator'
import {
  mensagemDoErro,
  mensagemPersistivel,
  novaCorrelacao,
  registrarEvento,
  registrarLog,
} from '../servidor/observabilidade'
import { sincronizar, type DependenciasIngestao } from './ingestao'

export type { EstadoDaBusca }

/**
 * A busca de e-mails roda no servidor, e a tela só acompanha.
 *
 * ═══ POR QUE ═══
 *
 * `POST /api/ingestao` fazia a busca inteira dentro da requisição. Com a IA
 * local, a mediana medida foi de 11,3 s por e-mail (`ESTADO.md`, 01/10/2026):
 * 30 e-mails seguravam a tela por seis minutos, 200 por quase quarenta, e um
 * proxy reverso corta a resposta em 60 s. A tela mostrava erro com o servidor
 * ainda trabalhando, e um segundo clique começava outra busca por cima.
 *
 * ═══ O DESENHO ═══
 *
 * - **No mesmo processo, sem fila.** O sistema roda num servidor só (`A61`),
 *   e uma fila seria infraestrutura nova para instalar e vigiar. A busca é a
 *   mesma `sincronizar` de antes; só deixa de ser esperada pela requisição.
 * - **Uma por vez.** Pedir de novo enquanto roda devolve a que está rodando,
 *   em vez de começar outra que chamaria a IA para os mesmos e-mails.
 * - **Reinício do servidor no meio** perde só o andamento em memória. O que
 *   já foi gravado fica, e o resto volta na próxima busca: e-mail processado
 *   não é lido de novo (`messageId`).
 * - **O estado só tem números**, nunca texto de e-mail, e só operador e
 *   gestor o veem, os mesmos papéis que podem buscar.
 *
 * LIMITE CONHECIDO: com mais de um processo atrás de um balanceador, cada um
 * teria a própria "busca em andamento". Não é o desenho do `A61`, e mesmo
 * nesse caso nada duplica: a busca concorrente já é segura no banco.
 */

interface Registro {
  estado: EstadoDaBusca
  /** Qual busca é a atual. Só ela escreve no estado. */
  numero: number
  /** Quando a busca atual deu o último sinal de vida: começou ou avançou um e-mail. */
  ultimoAvancoEm: number
  /** Só para os testes esperarem o fim de TODAS as buscas, inclusive a dada como parada. */
  andamento: Promise<void> | null
}

/**
 * Sem avançar um e-mail por este tempo, a busca é dada como parada.
 *
 * Uma pergunta à IA local tem prazo de 300 s e pode ser repetida uma vez, e a
 * segunda opinião faz até três perguntas de 60 s: um e-mail difícil leva até
 * ~13 min. Vinte minutos sem avançar não é e-mail lento, é algo pendurado, e
 * sem este teto a busca ficaria "rodando" até o servidor reiniciar, recusando
 * toda busca nova (revisões do #178).
 */
export const LIMITE_SEM_AVANCO_MS = 20 * 60_000

/**
 * No `globalThis`, e não num `let` do módulo: o modo de desenvolvimento
 * recarrega módulos, e cada recarga teria um registro novo enquanto a busca
 * antiga ainda roda (mesma razão das marcas de `instrumentation-node.ts`).
 */
function registro(): Registro {
  const global = globalThis as typeof globalThis & { buscaDeEmails?: Registro }
  global.buscaDeEmails ??= { estado: { situacao: 'nenhuma' }, numero: 0, ultimoAvancoEm: 0, andamento: null }
  return global.buscaDeEmails
}

export interface PedidoDeBusca {
  /** `false` quando já havia uma rodando: o estado devolvido é o dela. */
  iniciada: boolean
  estado: EstadoDaBusca
}

/**
 * Começa a busca e volta na hora.
 *
 * As dependências chegam já montadas: um adapter mal configurado falha AQUI,
 * dentro da requisição, com a frase que diz o que arrumar, e não minutos
 * depois como "a busca falhou".
 */
export function iniciarBusca(deps: DependenciasIngestao, ator: Ator): PedidoDeBusca {
  exigirPapel(ator, 'sincronizar ingestão', 'operador', 'gestor')
  const atual = registro()
  if (atual.estado.situacao === 'rodando') {
    if (Date.now() - atual.ultimoAvancoEm < LIMITE_SEM_AVANCO_MS) {
      return { iniciada: false, estado: { ...atual.estado } }
    }
    // Parada há tempo demais. A busca antiga pode até terminar um dia, mas não
    // escreve mais no estado: o número dela deixou de ser o atual.
    registrarLog('erro', 'busca de e-mails sem avançar; dada como parada para deixar outra começar', {
      iniciadaEm: atual.estado.iniciadaEm,
      lidos: atual.estado.lidos,
      total: atual.estado.total,
    })
  }

  const numero = atual.numero + 1
  const iniciadaEm = new Date().toISOString()
  const rodando: EstadoDaBusca = { situacao: 'rodando', iniciadaEm, total: null, lidos: 0 }
  atual.numero = numero
  atual.estado = rodando
  atual.ultimoAvancoEm = Date.now()

  /** Só a busca atual escreve: uma antiga que termine atrasada não apaga a nova. */
  const escrever = (estado: EstadoDaBusca): void => {
    if (atual.numero === numero) atual.estado = estado
  }

  const aoProgredir = ({ total, lidos }: { total: number; lidos: number }): void => {
    if (atual.numero !== numero || atual.estado.situacao !== 'rodando') return
    atual.ultimoAvancoEm = Date.now()
    atual.estado = { situacao: 'rodando', iniciadaEm, total, lidos }
  }

  const desta = sincronizar({ ...deps, aoProgredir }, ator)
    .then(
      (resumo) => {
        escrever({ situacao: 'concluida', iniciadaEm, terminadaEm: new Date().toISOString(), resumo })
      },
      async (erro: unknown) => {
        // A frase é montada com cuidado, mas o estado SEMPRE sai de "rodando":
        // um erro aqui dentro deixava a busca presa e recusava toda busca nova
        // até o servidor reiniciar (revisões do #178).
        let frase = FRASE_DE_ULTIMO_RECURSO
        try {
          frase = await mensagemDaFalha(deps, erro)
        } finally {
          escrever({ situacao: 'falhou', iniciadaEm, terminadaEm: new Date().toISOString(), erro: frase })
        }
      },
    )
    .catch((erro: unknown) => {
      // Só chega aqui o que falhou ao montar a frase. O estado já saiu de
      // "rodando" no `finally`; resta não deixar a promessa sem dono.
      process.stderr.write(`a busca de e-mails falhou ao registrar a própria falha: ${String(erro)}\n`)
    })
  atual.andamento = Promise.all([atual.andamento, desta]).then(() => undefined)

  return { iniciada: true, estado: { ...rodando } }
}

const FRASE_DE_ULTIMO_RECURSO = 'A busca parou por um erro do sistema, e nem o registro dele foi possível. Avise a gestão com o horário.'

/** O estado da busca atual, ou da última. Só números: nada de texto de e-mail. */
export function estadoDaBusca(ator: Ator): EstadoDaBusca {
  exigirPapel(ator, 'acompanhar a busca de e-mails', 'operador', 'gestor')
  return { ...registro().estado }
}

/**
 * A frase que a tela mostra quando a busca parou.
 *
 * O mesmo critério de `rota()`: falha esperada de fronteira (IA fora do ar,
 * chave recusada, caixa inacessível) traz a frase que a própria classe declara
 * segura para sair; qualquer outra coisa é defeito, vai inteira para o log e a
 * memória, e a tela recebe só o código para rastrear.
 */
async function mensagemDaFalha(deps: DependenciasIngestao, erro: unknown): Promise<string> {
  if (erro instanceof ErroOperacional) {
    registrarLog('aviso', 'a busca de e-mails parou numa falha esperada', { codigo: erro.codigo, erro: erro.message })
    // Na trilha também: o estado vive só em memória, e uma busca que parou
    // antes de ler a caixa (credencial recusada) não deixava rastro nenhum
    // (revisão de segurança do #178). A mesma frase da tela, nunca a crua.
    try {
      await registrarEvento(deps.banco, {
        correlacaoId: novaCorrelacao(),
        etapa: 'ingestao',
        situacao: 'reprocessavel',
        mensagem: erro.mensagemPublica,
        detalhe: { codigo: erro.codigo },
      })
    } catch (aoGravar) {
      registrarLog('erro', 'falha ao registrar o evento da busca que parou', { erro: mensagemDoErro(aoGravar) })
    }
    return erro.mensagemPublica
  }

  const correlacaoId = novaCorrelacao()
  registrarLog('erro', 'a busca de e-mails parou numa falha não tratada', {
    correlacaoId,
    erro: mensagemDoErro(erro),
    pilha: erro instanceof Error ? erro.stack : undefined,
  })
  try {
    await registrarEvento(deps.banco, {
      correlacaoId,
      etapa: 'ingestao',
      situacao: 'falha',
      mensagem: mensagemPersistivel(erro),
    })
  } catch (aoGravar) {
    registrarLog('erro', 'falha ao registrar o evento da busca que parou', {
      correlacaoId,
      erro: mensagemDoErro(aoGravar),
    })
    return 'A busca parou por um erro do sistema. O registro não foi gravado; avise a gestão com o horário.'
  }
  return `A busca parou por um erro do sistema. Avise a gestão com o código ${correlacaoId}.`
}

/** Só para testes: espera todas as buscas iniciadas terminarem. */
export async function esperarBuscaParaTeste(): Promise<void> {
  await registro().andamento
}

export function zerarBuscaParaTeste(): void {
  const global = globalThis as typeof globalThis & { buscaDeEmails?: Registro }
  delete global.buscaDeEmails
}
