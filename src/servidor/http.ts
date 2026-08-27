import { ZodError } from 'zod'

import { ErroDominio } from '../core/erros'
import { ambiente } from './ambiente'
import { PermissaoNegadaError } from './ator'
import { verificarLimite } from './limite-de-taxa'
import { mensagemDoErro, novaCorrelacao, registrarLog } from './observabilidade'
import { SemSessaoError, SenhaProvisoriaError } from './sessao'

/**
 * Camada HTTP.
 *
 * Envelope único para toda resposta e mapeamento de erro em um lugar só.
 *
 * Regra de vazamento: erros de DOMÍNIO têm mensagem escrita para humano e vão
 * inteiros para o cliente. Erros INESPERADOS viram mensagem genérica com um id
 * de correlação — o detalhe fica no log do servidor. Stack trace nunca cruza a
 * fronteira: é mapa da aplicação para quem estiver sondando.
 */

export interface Envelope<T> {
  sucesso: boolean
  dados: T | null
  erro: string | null
  correlacaoId?: string
}

export function responder<T>(dados: T, status = 200): Response {
  return Response.json({ sucesso: true, dados, erro: null } satisfies Envelope<T>, { status })
}

export function responderErro(mensagem: string, status: number, correlacaoId?: string): Response {
  return Response.json(
    {
      sucesso: false,
      dados: null,
      erro: mensagem,
      ...(correlacaoId ? { correlacaoId } : {}),
    } satisfies Envelope<never>,
    { status },
  )
}

function statusDoErro(erro: unknown): number | null {
  if (erro instanceof SemSessaoError) return 401
  if (erro instanceof SenhaProvisoriaError) return 403
  if (erro instanceof PermissaoNegadaError) return 403
  if (erro instanceof ZodError) return 400
  if (erro instanceof ErroDominio) {
    // Conservação violada é defeito do sistema, não erro do usuário.
    return erro.codigo === 'CONSERVACAO_VIOLADA' ? 500 : 422
  }
  return null
}

function mensagemDeValidacao(erro: ZodError): string {
  return erro.issues
    .map((problema) => `${problema.path.join('.') || 'corpo'}: ${problema.message}`)
    .join('; ')
}

/**
 * Envolve um handler de rota.
 *
 * Todo `route.ts` passa por aqui — assim nenhuma rota esquece de tratar erro,
 * e o formato da resposta é o mesmo em todas.
 */
export async function rota(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler()
  } catch (erro) {
    const status = statusDoErro(erro)

    if (status !== null && status < 500) {
      const mensagem = erro instanceof ZodError ? mensagemDeValidacao(erro) : mensagemDoErro(erro)
      return responderErro(mensagem, status)
    }

    // Daqui para baixo é falha do servidor: registra tudo, devolve quase nada.
    //
    // SEM EXCEÇÃO, nem para erro de domínio. `ConservacaoVioladaError` carrega
    // a alocação inteira na mensagem — o id de cada colega da rodada. Havia um
    // ramo especial que devolvia essa mensagem ao cliente, então justamente o
    // caso mais grave (defeito do motor de conservação) era o mais falante.
    const correlacaoId = novaCorrelacao()
    registrarLog('erro', 'falha não tratada em rota', {
      correlacaoId,
      erro: mensagemDoErro(erro),
      pilha: erro instanceof Error ? erro.stack : undefined,
    })

    return responderErro(
      'Erro interno. O identificador abaixo permite rastrear a falha no log.',
      500,
      correlacaoId,
    )
  }
}

/**
 * Origem da requisição, para chavear o limite de taxa.
 *
 * Uma chave FIXA numa rota pré-autenticação é um DoS de graça: bastava alguém
 * estourar o balde global de `/api/sessao` para deixar a equipe inteira sem
 * conseguir entrar. A chave tem de separar quem chama.
 *
 * MAS SÓ DÁ PARA SEPARAR SE O VALOR NÃO FOR ESCOLHIDO POR QUEM CHAMA.
 *
 * Medido no servidor de desenvolvimento: quando o cliente não manda
 * `x-forwarded-for`, o Next preenche com o endereço do socket; quando manda,
 * o Next repassa o valor do cliente inteiro, sem acrescentar nada. Sem proxy
 * confiável declarado, então, o cabeçalho é texto livre — e a versão antiga
 * desta função lia a PRIMEIRA entrada dele, que é exatamente o que o
 * atacante escreveu. Variar um cabeçalho dava um balde novo por requisição, e
 * o limite de taxa deixava de existir.
 *
 * Com `PROXIES_CONFIAVEIS = N > 0`, a origem é a entrada N posições antes do
 * fim: a que o proxy mais externo acrescentou. Cadeia mais curta que N
 * significa configuração divergente da realidade — ou alguém alcançou o
 * servidor por fora do proxy —, e aí o valor não prova nada.
 */
export interface Origem {
  /** Chave do balde de limite. */
  chave: string
  /**
   * `false` quando a chave NÃO separa quem chama.
   *
   * Quem chama precisa saber disto para não aplicar um limite apertado sobre
   * um balde que é de todo mundo — seria trancar a equipe inteira por causa
   * de um atacante.
   */
  confiavel: boolean
}

/** Balde único de quando não dá para identificar a origem. Nome explícito de propósito. */
const ORIGEM_INDISTINGUIVEL = 'origem-indistinguivel'

export function origemDaRequisicao(requisicao: Request): Origem {
  const proxies = ambiente().PROXIES_CONFIAVEIS
  if (proxies === 0) return { chave: ORIGEM_INDISTINGUIVEL, confiavel: false }

  const cadeia = (requisicao.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((parte) => parte.trim())
    .filter((parte) => parte.length > 0)

  const posicao = cadeia.length - proxies
  if (posicao < 0) return { chave: ORIGEM_INDISTINGUIVEL, confiavel: false }

  return { chave: cadeia[posicao]!.slice(0, 64), confiavel: true }
}

/**
 * Quanto o limite afrouxa quando a origem é indistinguível.
 *
 * Sem proxy confiável, o balde é de todo mundo. Manter o número apertado
 * trancaria a equipe inteira assim que um atacante o estourasse — o DoS de
 * graça. O que resta proteger é CPU (cada tentativa de senha custa uma
 * derivação scrypt), então o teto sobe o bastante para uma equipe de dezenas
 * de pessoas nunca encostar nele, e ainda assim conter um laço automatizado.
 *
 * Isto NÃO substitui identificar a origem. É o que dá para fazer sem ela, e a
 * defesa que de fato contém força bruta continua sendo a trava por conta.
 */
export const FATOR_SEM_ORIGEM = 30

/**
 * Limite de taxa por origem, honesto sobre o que dá para saber.
 */
export function limitarPorOrigem(
  requisicao: Request,
  prefixo: string,
  porOrigem: number,
  janelaSegundos: number,
): Response | null {
  const origem = origemDaRequisicao(requisicao)
  const maximo = origem.confiavel ? porOrigem : porOrigem * FATOR_SEM_ORIGEM
  return limitar(`${prefixo}:${origem.chave}`, maximo, janelaSegundos)
}

/** Aplica limite de taxa e devolve a resposta de recusa, ou `null` se liberado. */
export function limitar(
  chave: string,
  maximo: number,
  janelaSegundos: number,
): Response | null {
  const resultado = verificarLimite(chave, maximo, janelaSegundos)
  if (resultado.permitido) return null

  return Response.json(
    {
      sucesso: false,
      dados: null,
      erro: `Muitas requisições. Tente de novo em ${resultado.reiniciaEmSegundos}s.`,
    } satisfies Envelope<never>,
    { status: 429, headers: { 'Retry-After': String(resultado.reiniciaEmSegundos) } },
  )
}

export async function corpoJson(requisicao: Request): Promise<unknown> {
  try {
    return await requisicao.json()
  } catch {
    return {}
  }
}
