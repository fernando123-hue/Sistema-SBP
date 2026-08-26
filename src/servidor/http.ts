import { ZodError } from 'zod'

import { ErroDominio } from '../core/erros'
import { PermissaoNegadaError } from './ator'
import { verificarLimite } from './limite-de-taxa'
import { mensagemDoErro, novaCorrelacao, registrarLog } from './observabilidade'
import { SemSessaoError } from './sessao'

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
 */
export function origemDaRequisicao(requisicao: Request): string {
  const encaminhado = requisicao.headers.get('x-forwarded-for')
  if (encaminhado) return encaminhado.split(',')[0]!.trim().slice(0, 64)
  return requisicao.headers.get('x-real-ip')?.slice(0, 64) ?? 'desconhecida'
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
