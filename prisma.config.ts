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
    /**
     * Base SOMBRA — exigida para comparar o diretório de migrações com o
     * schema (`prisma migrate diff --from-migrations`), que é o passo do CI que
     * pega o caso clássico: alguém edita o schema e esquece de gerar a
     * migração.
     *
     * Em SQLite o Prisma usava um arquivo temporário e ninguém precisava saber
     * que isso existia. Em MySQL (`A42`) ele precisa de um banco de verdade
     * onde aplicar as migrações e jogar fora — e a configuração é AQUI, não na
     * linha de comando: `migrate diff` não aceita `--shadow-database-url`.
     *
     * ═══ A CHAVE SOME QUANDO NÃO HÁ VALOR, E ISSO NÃO É ESTILO ═══
     *
     * A primeira versão punha `?? ''`. O Prisma recusa string vazia com `P1013`
     * — e a recusa vale para QUALQUER comando, não só o `diff`: o preparador da
     * suíte parou de conseguir tocar o banco, e a suíte inteira deixou de rodar
     * numa máquina que não define a variável. Ausente é diferente de vazio, e
     * aqui a diferença derruba tudo.
     */
    ...(process.env['SHADOW_DATABASE_URL']
      ? { shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'] }
      : {}),
  },
})
