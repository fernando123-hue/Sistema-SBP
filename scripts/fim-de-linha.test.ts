import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Migração com fim de linha do Windows (CRLF) na cópia de trabalho.
 *
 * O Prisma guarda em `_prisma_migrations` a assinatura dos BYTES de cada
 * `migration.sql`. Num clone do Windows com `core.autocrlf=true`, o arquivo
 * sai com CRLF; no CI e no servidor Linux, com LF. A mesma migração ganha duas
 * assinaturas, e `npx prisma migrate dev` passa a dizer que uma migração antiga
 * foi "modificada" e oferece APAGAR a base para recomeçar (`ESTADO` de 02/10,
 * armadilhas). Conferido na base de desenvolvimento desta máquina: sete
 * migrações com a assinatura do LF, duas com a do CRLF.
 *
 * A trava é o `.gitattributes` (`eol=lf`). Este teste é o que fica vermelho
 * num Windows se ela sumir — no Linux ele passa sempre, e tudo bem: é no
 * Windows que o defeito nasce.
 */

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRACOES = join(RAIZ, 'prisma', 'migrations')

const arquivos = readdirSync(MIGRACOES, { recursive: true, encoding: 'utf8' })
  .map((nome) => nome.replaceAll('\\', '/'))
  .filter((nome) => nome.endsWith('.sql') || nome.endsWith('.toml'))
  .sort()

describe('fim de linha das migrações', () => {
  it('a varredura acha as migrações', () => {
    expect(arquivos.filter((nome) => nome.endsWith('/migration.sql')).length).toBeGreaterThan(5)
  })

  it.each(arquivos)('%s está em LF na cópia de trabalho', (nome) => {
    const bytes = readFileSync(join(MIGRACOES, nome))
    expect(bytes.includes('\r')).toBe(false)
  })
})
