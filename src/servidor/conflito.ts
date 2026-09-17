import type { Banco, Transacao } from './prisma'

/**
 * Conflito de escrita entre transações.
 *
 * No InnoDB, duas transações que travam as mesmas linhas podem terminar em
 * impasse (deadlock) mesmo com a ordem de travas cuidada — e o banco pede
 * exatamente isto: tente de novo. A transação inteira volta atrás, então
 * repetir é seguro.
 */

export function codigoDoPrisma(erro: unknown): unknown {
  return erro !== null && typeof erro === 'object' && 'code' in erro
    ? (erro as { code?: unknown }).code
    : undefined
}

/**
 * O Prisma sinaliza o impasse de dois jeitos: `P2034` nas operações do
 * cliente, e `P2010` (consulta crua falhou) com a causa do adaptador quando o
 * impasse acontece num `$queryRaw` — medido em 17/09/2026, com o MySQL
 * respondendo 1213. Olhar só o `P2034` deixava o segundo caso subir cru.
 */
export function ehConflitoDeEscrita(erro: unknown): boolean {
  const codigo = codigoDoPrisma(erro)
  if (codigo === 'P2034') return true
  if (codigo !== 'P2010') return false
  const causa = (erro as { meta?: { driverAdapterError?: { cause?: { kind?: unknown; originalCode?: unknown } } } })
    .meta?.driverAdapterError?.cause
  return causa?.kind === 'TransactionWriteConflict' || causa?.originalCode === '1213'
}

export const TENTATIVAS_EM_CONFLITO = 3

/**
 * Roda a operação de novo quando o banco acusa impasse. Persistindo, falha
 * alto com o erro do banco: esconder o conflito seria degradar calado.
 */
export async function comNovaTentativaEmConflito<T>(operacao: () => Promise<T>): Promise<T> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await operacao()
    } catch (erro) {
      if (!ehConflitoDeEscrita(erro) || tentativa >= TENTATIVAS_EM_CONFLITO) throw erro
    }
  }
}

/** `banco.$transaction(corpo)`, repetida em impasse. */
export function transacaoComNovaTentativa<T>(
  banco: Banco,
  corpo: (tx: Transacao) => Promise<T>,
): Promise<T> {
  return comNovaTentativaEmConflito(() => banco.$transaction(corpo))
}
