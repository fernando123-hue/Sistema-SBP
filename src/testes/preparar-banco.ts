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

  // `pipe`, não `ignore`: a falha já subia, mas sem a única coisa que o Prisma
  // tinha a dizer — o CI ficava vermelho com `Command failed` e nada mais, e
  // descobrir que era uma migração quebrada exigia reproduzir na máquina.
  try {
    execSync('npx prisma migrate deploy', {
      stdio: 'pipe',
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: `file:${CAMINHO_RELATIVO}` },
    })
  } catch (erro) {
    const saida = (campo: 'stdout' | 'stderr') =>
      erro !== null && typeof erro === 'object' && campo in erro
        ? String((erro as Record<typeof campo, unknown>)[campo] ?? '')
        : ''
    throw new Error(
      `Não foi possível preparar o banco de teste: \`prisma migrate deploy\` falhou.\n` +
        `${saida('stderr')}${saida('stdout')}`.trim(),
      { cause: erro },
    )
  }
}
