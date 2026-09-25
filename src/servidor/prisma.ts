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

/**
 * Fecha a conexão — SÓ para scripts de linha de comando, no fim.
 *
 * A conexão aberta segura o processo: sem isto, todo script que tocava o banco
 * imprimia o resultado e ficava vivo para sempre (medido em 25/09/2026 — a
 * rotina agendada do Gemini deixou dois processos pendurados por horas, e a
 * limpeza diária agendada num servidor deixaria um por dia). O servidor web
 * nunca chama: lá o cliente vive o processo inteiro.
 *
 * Falha ao fechar não muda o resultado do script: vai ao stderr, alto, e o
 * código de saída continua o que o script decidiu.
 */
export async function encerrarBanco(): Promise<void> {
  const aberta = instancia
  instancia = undefined
  try {
    await aberta?.$disconnect()
  } catch (erro) {
    process.stderr.write(`não foi possível fechar a conexão com o banco: ${erro instanceof Error ? erro.message : String(erro)}\n`)
  }
}

export type Banco = PrismaClient
/** Tipo do handle dentro de `prisma.$transaction`. */
export type Transacao = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]
