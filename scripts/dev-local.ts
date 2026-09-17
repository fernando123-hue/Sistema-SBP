import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

/**
 * Sobe o servidor de desenvolvimento com o acesso local sem senha LIGADO.
 *
 *   npm run dev:local
 *
 * Duas coisas que `npm run dev` não faz, e que são o motivo deste script:
 *
 * - liga `ACESSO_LOCAL_SEM_SENHA=1` **só para este processo**. Nada é escrito no
 *   `.env`; fechou o servidor, acabou. É o que impede a variável de ficar
 *   esquecida ligada num arquivo que vai junto para outra máquina;
 * - escuta **só em `127.0.0.1`**. `next dev` sozinho escuta em todas as
 *   interfaces, e aí qualquer um na mesma rede alcançaria a porta.
 *
 * O Next é chamado pelo próprio Node, sem shell. A primeira versão passava por
 * `npx.cmd` com `shell: true`, e o Node avisou com razão: argumentos
 * concatenados num shell não são escapados — justamente o tipo de brecha que
 * não cabe num script que abre uma porta sem senha.
 *
 * **Nenhum argumento é repassado ao Next.** A primeira versão repassava
 * `process.argv`, e o parser do Next respeita a última ocorrência de uma opção:
 * `npm run dev:local -- --hostname 0.0.0.0` reabria a porta sem senha para a rede
 * inteira (revisão de segurança de 12/09/2026). Quem precisar de outra porta ou
 * outra opção usa `npm run dev`, que não tem acesso sem senha.
 *
 * As outras travas estão em `src/servidor/acesso-local.ts`.
 */

const binarioDoNext = createRequire(import.meta.url).resolve('next/dist/bin/next')

const servidor = spawn(
  process.execPath,
  [binarioDoNext, 'dev', '--hostname', '127.0.0.1'],
  {
    stdio: 'inherit',
    // NODE_ENV explícito: o acesso sem senha só existe com `development`
    // (achado C-12), e o `next dev` só preenche NODE_ENV quando ele falta —
    // um valor herdado do shell faria este script recusar subir.
    env: { ...process.env, ACESSO_LOCAL_SEM_SENHA: '1', NODE_ENV: 'development' },
  },
)

servidor.on('exit', (codigo, sinal) => {
  process.exitCode = codigo ?? (sinal ? 1 : 0)
})

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => servidor.kill(sinal))
}
