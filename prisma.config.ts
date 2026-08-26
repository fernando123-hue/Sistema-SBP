import path from 'node:path'
import { defineConfig } from 'prisma/config'

// Prisma 7 não carrega `.env` sozinho. Node 24+ resolve isso sem dependência extra.
try {
  process.loadEnvFile()
} catch {
  // `.env` ausente: seguimos com o default de desenvolvimento abaixo.
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL'] ?? 'file:./prisma/dev.db',
  },
})
