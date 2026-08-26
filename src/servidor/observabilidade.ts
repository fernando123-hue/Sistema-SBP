import { randomUUID } from 'node:crypto'

import { serializar } from '../core/esquemas'
import type { Transacao } from './prisma'

/**
 * Logs estruturados e trilha de processamento.
 *
 * Responde as cinco perguntas do requisito de observabilidade: o que falhou,
 * onde, quando, qual operação estava em curso, e se pode ser reprocessada.
 *
 * Todo fluxo carrega um `correlacaoId` do início ao fim — ingestão, IA, revisão
 * e distribuição de um mesmo ciclo compartilham o mesmo id, e a
 * `RodadaDistribuicao` o persiste. Dado um número errado no painel, é possível
 * puxar a linha inteira.
 */

export type Nivel = 'debug' | 'info' | 'aviso' | 'erro'

/** Chaves cujo valor nunca aparece em log, mesmo que alguém as passe por engano. */
const CHAVES_SENSIVEIS = new Set([
  'senha',
  'senhahash',
  'token',
  'authorization',
  'apikey',
  'api_key',
  'anthropic_api_key',
  'sessao_secret',
  'secret',
  'cpf',
  'crm',
  'corpo',
])

function redigir(contexto: Record<string, unknown>): Record<string, unknown> {
  const saida: Record<string, unknown> = {}
  for (const [chave, valor] of Object.entries(contexto)) {
    saida[chave] = CHAVES_SENSIVEIS.has(chave.toLowerCase()) ? '[redigido]' : valor
  }
  return saida
}

export function novaCorrelacao(): string {
  return randomUUID()
}

export function registrarLog(
  nivel: Nivel,
  mensagem: string,
  contexto: Record<string, unknown> = {},
): void {
  const linha = serializar({
    nivel,
    mensagem,
    instante: new Date().toISOString(),
    ...redigir(contexto),
  })

  if (nivel === 'erro') process.stderr.write(`${linha}\n`)
  else process.stdout.write(`${linha}\n`)
}

export interface EventoEntrada {
  correlacaoId: string
  etapa: string
  situacao: 'iniciado' | 'sucesso' | 'falha' | 'reprocessavel'
  referencia?: string | null
  mensagem?: string | null
  detalhe?: unknown
  duracaoMs?: number | null
}

export async function registrarEvento(banco: Transacao, evento: EventoEntrada): Promise<void> {
  await banco.eventoProcessamento.create({
    data: {
      correlacaoId: evento.correlacaoId,
      etapa: evento.etapa,
      situacao: evento.situacao,
      referencia: evento.referencia ?? null,
      mensagem: evento.mensagem ?? null,
      detalhe: evento.detalhe === undefined ? null : serializar(evento.detalhe),
      duracaoMs: evento.duracaoMs ?? null,
    },
  })
}

export function mensagemDoErro(erro: unknown): string {
  if (erro instanceof Error) return erro.message
  return 'Erro inesperado'
}
