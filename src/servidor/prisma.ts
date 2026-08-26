import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

import { PrismaClient } from '../generated/prisma/client'
import { ambiente } from './ambiente'

/**
 * Cliente Prisma.
 *
 * Para migrar para PostgreSQL: trocar `provider` em `schema.prisma` e o adapter
 * abaixo por `@prisma/adapter-pg`. Nenhum model, serviço ou query muda.
 */

let instancia: PrismaClient | undefined

export function obterPrisma(): PrismaClient {
  if (!instancia) {
    const adapter = new PrismaBetterSqlite3({ url: ambiente().DATABASE_URL })
    instancia = new PrismaClient({ adapter })
  }
  return instancia
}

export type Banco = PrismaClient
/** Tipo do handle dentro de `prisma.$transaction`. */
export type Transacao = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]
