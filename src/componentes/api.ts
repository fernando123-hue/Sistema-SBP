'use client'

/**
 * Cliente da API.
 *
 * As telas conversam com o sistema pelos MESMOS endpoints que o sistema legado
 * do cliente vai usar. Nenhuma tela fala com o banco direto — é o que garante
 * que a integração não vira um caminho paralelo com regras próprias.
 */

export interface Envelope<T> {
  sucesso: boolean
  dados: T | null
  erro: string | null
  correlacaoId?: string
}

export class ErroDaApi extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
    readonly correlacaoId?: string,
  ) {
    super(mensagem)
    this.name = 'ErroDaApi'
  }
}

async function requisitar<T>(
  caminho: string,
  opcoes: { metodo?: string; corpo?: unknown } = {},
): Promise<T> {
  const inicializacao: RequestInit = {
    method: opcoes.metodo ?? 'GET',
    // O cookie de sessão é httpOnly; precisa ir junto.
    credentials: 'same-origin',
  }

  if (opcoes.corpo !== undefined) {
    inicializacao.headers = { 'Content-Type': 'application/json' }
    inicializacao.body = JSON.stringify(opcoes.corpo)
  }

  const resposta = await fetch(`/api${caminho}`, inicializacao)

  const envelope = (await resposta.json().catch(() => null)) as Envelope<T> | null

  if (!resposta.ok || !envelope?.sucesso) {
    throw new ErroDaApi(
      envelope?.erro ?? `Falha na requisição (${resposta.status}).`,
      resposta.status,
      envelope?.correlacaoId,
    )
  }

  return envelope.dados as T
}

export const api = {
  buscar: <T,>(caminho: string) => requisitar<T>(caminho),
  enviar: <T,>(caminho: string, corpo?: unknown) => requisitar<T>(caminho, { metodo: 'POST', corpo }),
  atualizar: <T,>(caminho: string, corpo?: unknown) => requisitar<T>(caminho, { metodo: 'PUT', corpo }),
  remover: <T,>(caminho: string) => requisitar<T>(caminho, { metodo: 'DELETE' }),
}

export function mensagemDoErro(erro: unknown): string {
  if (erro instanceof ErroDaApi) {
    return erro.correlacaoId ? `${erro.message} (ref. ${erro.correlacaoId.slice(0, 8)})` : erro.message
  }
  if (erro instanceof Error) return erro.message
  return 'Erro inesperado.'
}
