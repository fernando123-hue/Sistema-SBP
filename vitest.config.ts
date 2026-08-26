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
    // Margem folgada de propósito. A simulação de 30 dias grava centenas de
    // linhas e cada teste limpa o banco antes de rodar; em máquina mais lenta
    // que a de desenvolvimento isso passa de 30s e o teste falha por tempo,
    // não por defeito — o pior tipo de vermelho, porque ensina a ignorar.
    testTimeout: 90_000,
    hookTimeout: 60_000,
  },
})
