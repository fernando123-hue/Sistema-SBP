import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    // `scripts/` também: o portão do processo (`scripts/processo`) é código que decide
    // o que um PR precisa provar, e precisa de prova ele mesmo.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // Base de teste separada da de desenvolvimento. Nenhum teste toca dado de
    // desenvolvimento — e a suíte roda no MESMO banco da implantação (`A42`),
    // porque testar em banco diferente esconde a classe de erro que só aparece
    // com dado real (`AT-30`). Exige um MySQL de pé; ver README.
    env: {
      // A do ambiente TEM PRECEDÊNCIA: o CI sobe o MySQL dele, em outra porta,
      // e uma URL fixa aqui mandaria a suíte procurar um banco que não existe
      // lá — vermelho que não é defeito, o pior tipo. O valor abaixo é só o
      // padrão da máquina de desenvolvimento.
      DATABASE_URL: process.env['DATABASE_URL'] ?? 'mysql://root@127.0.0.1:3307/sbp_teste',
      NODE_ENV: 'test',
      // Valor público de propósito, como o `SESSAO_SECRET` do CI: protege CPF
      // sintético num banco que nasce e morre com a suíte. Sem ele, quem clona
      // o repositório e roda os testes sem este segredo no `.env` vê tudo
      // vermelho por um motivo que não é defeito.
      BUSCA_SECRET: 'teste-nao-e-segredo-so-para-cpf-sintetico',
    },
    globalSetup: ['./src/testes/preparar-banco.ts'],
    // Uma base compartilhada por toda a suíte: arquivos de teste rodam em
    // série. Cada arquivo limpa as tabelas antes de rodar, e paralelizar faria
    // um teste apagar o cenário do outro.
    fileParallelism: false,
    // Margem folgada de propósito. A simulação de 30 dias grava centenas de
    // linhas e cada teste limpa o banco antes de rodar; em máquina mais lenta
    // que a de desenvolvimento isso passa de 30s e o teste falha por tempo,
    // não por defeito — o pior tipo de vermelho, porque ensina a ignorar.
    testTimeout: 90_000,
    hookTimeout: 60_000,
  },
})
