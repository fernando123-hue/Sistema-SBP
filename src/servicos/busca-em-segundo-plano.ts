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
  /** Só para os testes esperarem o fim; ninguém mais a aguarda. */
  andamento: Promise<void> | null
}

/**
 * No `globalThis`, e não num `let` do módulo: o modo de desenvolvimento
 * recarrega módulos, e cada recarga teria um registro novo enquanto a busca
 * antiga ainda roda (mesma razão das marcas de `instrumentation-node.ts`).
 */
function registro(): Registro {
  const global = globalThis as typeof globalThis & { buscaDeEmails?: Registro }
  global.buscaDeEmails ??= { estado: { situacao: 'nenhuma' }, andamento: null }
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
  if (atual.estado.situacao === 'rodando') return { iniciada: false, estado: { ...atual.estado } }

  const iniciadaEm = new Date().toISOString()
  const rodando: EstadoDaBusca = { situacao: 'rodando', iniciadaEm, total: null, lidos: 0 }
  atual.estado = rodando

  const aoProgredir = ({ total, lidos }: { total: number; lidos: number }): void => {
    // Só enquanto ESTA busca é a que roda: um aviso atrasado nunca apaga o
    // resultado que já foi gravado no estado.
    if (atual.estado.situacao === 'rodando' && atual.estado.iniciadaEm === iniciadaEm) {
      atual.estado = { situacao: 'rodando', iniciadaEm, total, lidos }
    }
  }

  atual.andamento = sincronizar({ ...deps, aoProgredir }, ator).then(
    (resumo) => {
      atual.estado = { situacao: 'concluida', iniciadaEm, terminadaEm: new Date().toISOString(), resumo }
    },
    async (erro: unknown) => {
      atual.estado = {
        situacao: 'falhou',
        iniciadaEm,
        terminadaEm: new Date().toISOString(),
        erro: await mensagemDaFalha(deps, erro),
      }
    },
  )

  return { iniciada: true, estado: { ...rodando } }
}

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

/** Só para testes: espera a busca atual terminar e zera o registro. */
export async function esperarBuscaParaTeste(): Promise<void> {
  await registro().andamento
}

export function zerarBuscaParaTeste(): void {
  const global = globalThis as typeof globalThis & { buscaDeEmails?: Registro }
  delete global.buscaDeEmails
}
