import { PrismaMariaDb } from '@prisma/adapter-mariadb'

import { PrismaClient } from '../generated/prisma/client'
import { ambiente } from './ambiente'

/**
 * Cliente Prisma.
 *
 * O banco é **MySQL** (`A42`), e `PrismaMariaDb` é o adapter do Prisma para a
 * família MySQL/MariaDB. Trocar de banco continua sendo duas linhas — o
 * `provider` no schema e o adapter aqui —, e nenhum model, serviço ou consulta
 * muda: é a mesma fronteira que permitiu acrescentar o segundo fornecedor de IA
 * sem tocar em `servicos/`.
 *
 * A URL inteira vem do ambiente. Nada de host, porta ou senha escrito aqui:
 * é o que deixa a mesma imagem rodar na máquina de desenvolvimento, no servidor
 * da associação e, um dia, na nuvem (`A46`).
 */

let instancia: PrismaClient | undefined

export function obterPrisma(): PrismaClient {
  if (!instancia) {
    const adapter = new PrismaMariaDb(ambiente().DATABASE_URL)
    instancia = new PrismaClient({ adapter })
  }
  return instancia
}

export type Banco = PrismaClient
/** Tipo do handle dentro de `prisma.$transaction`. */
export type Transacao = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]
