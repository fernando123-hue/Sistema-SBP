import { DOMINIO_ATUAL, serializar, type AcaoAuditavel } from '../core/esquemas'
import type { Transacao } from '../servidor/prisma'

/**
 * Trilha de auditoria append-only.
 *
 * Responde, para qualquer registro: quem fez, quando, o quê, valor antes, valor
 * depois, e sob qual correlação. Nunca é atualizada nem apagada — corrigir um
 * dado gera uma nova linha, não reescreve a anterior.
 *
 * Distinta do log técnico de propósito: log some na rotação, auditoria não.
 */

export interface EntradaAuditoria {
  entidade: string
  entidadeId: string
  /**
   * Fechada de propósito. Era `string`, e um typo entrava calado numa tabela
   * que o projeto promete nunca reescrever — a linha errada ficaria para
   * sempre, e a consulta que a procurasse não a acharia.
   */
  acao: AcaoAuditavel
  antes?: unknown
  depois?: unknown
  usuario: string
  correlacaoId?: string | null
}

export async function auditar(banco: Transacao, entrada: EntradaAuditoria): Promise<void> {
  await banco.logAuditoria.create({
    data: {
      dominio: DOMINIO_ATUAL,
      entidade: entrada.entidade,
      entidadeId: entrada.entidadeId,
      acao: entrada.acao,
      antes: entrada.antes === undefined ? null : serializar(entrada.antes),
      depois: entrada.depois === undefined ? null : serializar(entrada.depois),
      usuario: entrada.usuario,
      correlacaoId: entrada.correlacaoId ?? null,
    },
  })
}

export async function auditarLote(
  banco: Transacao,
  entradas: readonly EntradaAuditoria[],
): Promise<void> {
  if (entradas.length === 0) return

  await banco.logAuditoria.createMany({
    data: entradas.map((entrada) => ({
      dominio: DOMINIO_ATUAL,
      entidade: entrada.entidade,
      entidadeId: entrada.entidadeId,
      acao: entrada.acao,
      antes: entrada.antes === undefined ? null : serializar(entrada.antes),
      depois: entrada.depois === undefined ? null : serializar(entrada.depois),
      usuario: entrada.usuario,
      correlacaoId: entrada.correlacaoId ?? null,
    })),
  })
}
