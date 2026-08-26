import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    // Banco de teste separado do `dev.db`. Nenhum teste toca dado de desenvolvimento.
    env: {
      DATABASE_URL: 'file:./prisma/teste.db',
      NODE_ENV: 'test',
    },
    globalSetup: ['./src/testes/preparar-banco.ts'],
    // Um banco SQLite compartilhado: arquivos de teste rodam em série.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
