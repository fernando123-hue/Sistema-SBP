import { execSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'

/**
 * `globalSetup` do Vitest.
 *
 * Cria um banco de teste do zero antes da suíte. Nunca toca no `dev.db`:
 * `DATABASE_URL` de teste vem de `vitest.config.ts` e aponta para outro arquivo.
 */

const CAMINHO_RELATIVO = './prisma/teste.db'

export async function setup(): Promise<void> {
  const arquivo = path.resolve('prisma/teste.db')
  for (const sufixo of ['', '-journal', '-wal', '-shm']) {
    const alvo = `${arquivo}${sufixo}`
    if (existsSync(alvo)) rmSync(alvo)
  }

  execSync('npx prisma migrate deploy', {
    stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: `file:${CAMINHO_RELATIVO}` },
  })
}
