import path from 'node:path'
import { defineConfig } from 'prisma/config'

// Prisma 7 não carrega `.env` sozinho. Node 24+ resolve isso sem dependência extra.
try {
  process.loadEnvFile()
} catch {
  // `.env` ausente: `DATABASE_URL` fica vazia e os comandos que precisam de
  // banco recusam — ver abaixo.
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // SEM valor inventado. Era `?? 'file:./prisma/dev.db'`, e a aplicação
    // (`servidor/ambiente.ts`) recusa subir sem `DATABASE_URL`: quem rodava
    // `db:migrate` antes de criar o `.env` migrava um banco órfão em
    // `prisma/dev.db` — que nem é o caminho do `.env.example` —, e depois o
    // `npm run dev` recusava subir. Vazio, `migrate` e `db` falham na hora.
    //
    // `?? ''` e não o `env()` de `prisma/config`: o `env()` lança ao CARREGAR
    // este arquivo, o que derrubaria também `prisma generate`, que não precisa
    // de banco nenhum.
    url: process.env['DATABASE_URL'] ?? '',
  },
})
