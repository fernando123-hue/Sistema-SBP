/**
 * Imprime o SQL da concessão mínima ao usuário da aplicação, tabela a tabela
 * (pendência 41, `docs/03-SPEC.md § 14`).
 *
 *   npm run db:sql-privilegios -- --usuario sbp_app --host localhost
 *
 * Rode com a credencial de MANUTENÇÃO (a que migra), depois das migrações:
 * ele lê as tabelas que existem na base e não escreve nada. O usuário da
 * aplicação é criado antes, pelo TI, com a senha que só o servidor conhece;
 * a senha não passa por aqui.
 */

import { encerrarBanco, obterPrisma } from '../src/servidor/prisma'
import { sqlDeConcessaoMinima } from '../src/servidor/privilegios'

/** O valor depois de `--nome`. Outra opção no lugar do valor conta como ausente. */
function argumento(nome: string): string | undefined {
  const posicao = process.argv.indexOf(`--${nome}`)
  const valor = posicao === -1 ? undefined : process.argv[posicao + 1]
  return valor === undefined || valor.startsWith('--') ? undefined : valor
}

async function principal(): Promise<void> {
  const usuario = argumento('usuario')
  const host = argumento('host')
  if (!usuario || !host) {
    throw new Error('Uso: npm run db:sql-privilegios -- --usuario sbp_app --host localhost')
  }

  const banco = obterPrisma()
  const [linhaDaBase] = await banco.$queryRawUnsafe<{ base: string | null }[]>('SELECT DATABASE() AS base')
  const base = linhaDaBase?.base
  if (!base) throw new Error('A DATABASE_URL não aponta para uma base.')
  const linhas = await banco.$queryRawUnsafe<Record<string, string>[]>('SHOW TABLES')
  const tabelas = linhas.map((linha) => Object.values(linha)[0] ?? '')

  process.stdout.write(`${sqlDeConcessaoMinima(tabelas, { base, usuario, host })}\n`)
}

principal()
  .catch((erro: unknown) => {
    process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`)
    process.exitCode = 1
  })
  .finally(encerrarBanco)
