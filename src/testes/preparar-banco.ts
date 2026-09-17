import { execSync } from 'node:child_process'

/**
 * `globalSetup` do Vitest.
 *
 * Prepara o banco de teste do zero antes da suíte. Nunca toca na base de
 * desenvolvimento: a `DATABASE_URL` de teste vem de `vitest.config.ts` e aponta
 * para uma base própria.
 *
 * ═══ POR QUE A SUÍTE RODA EM MySQL, E NÃO NUM ARQUIVO ═══
 *
 * Até 16/09/2026 isto criava um arquivo SQLite descartável, e era mais rápido.
 * O `AT-28` deixou a pergunta em aberto — "onde os testes rodam?" — e a
 * migração para MySQL (`A42`) a respondeu do pior jeito possível para quem
 * quisesse manter os dois: **testar em banco diferente do de produção esconde
 * exatamente a classe de erro que só aparece com dado real.** Dois defeitos
 * desta mesma semana provam isso (`AT-30`): o teto do anexo, que derrubava o
 * e-mail inteiro, e o valor padrão em coluna de texto, que o SQLite aceita e o
 * MySQL proíbe. Nenhum dos dois era alcançável pela suíte antiga.
 *
 * O custo é real e foi aceito de olhos abertos: a suíte fica mais lenta e
 * **exige um MySQL de pé** na máquina de quem roda. Em troca, o que fica verde
 * aqui é verde no banco que a associação vai usar.
 *
 * ═══ `migrate reset`, NÃO apagar arquivo ═══
 *
 * Com arquivo bastava removê-lo. Numa base, o equivalente é derrubar o schema e
 * reaplicar as migrações — o que garante que a suíte exercita **as migrações de
 * verdade**, as mesmas que vão rodar na implantação, e não um schema
 * empurrado direto. Migração que não aplica passa a ser vermelho aqui, e não
 * surpresa no dia de publicar.
 */

/**
 * A base de teste da máquina de desenvolvimento.
 *
 * O padrão vive AQUI e em `vitest.config.ts`, e não em um só lugar, porque o
 * `globalSetup` roda **antes** de o `env` da configuração ser aplicado ao
 * processo — descoberto na primeira execução, com a variável chegando vazia.
 * No CI o ambiente do job tem precedência e este valor não é usado.
 */
const PADRAO_LOCAL = 'mysql://root@127.0.0.1:3307/sbp_teste'

/**
 * Só uma base cujo nome termina em `_teste` pode ser apagada pela suíte.
 *
 * Achado N-01: a `DATABASE_URL` do ambiente tem precedência sobre o padrão
 * (e precisa ter, por causa do CI). Um `DATABASE_URL` da base de
 * desenvolvimento esquecido no shell fazia `npm test` apagar a base `sbp`
 * inteira. Quem decide o que pode ser apagado é o NOME da base, conferido
 * aqui, antes do `migrate reset` — nunca a boa memória de quem roda.
 *
 * A mensagem nunca repete a URL: ela pode trazer senha.
 *
 * `SHADOW_DATABASE_URL` fica de fora de propósito: no Prisma 7 o `migrate
 * reset` chama `engine.reset()` só na conexão principal (conferido no pacote
 * instalado, `prisma/build/cli.js`); a base sombra só é usada por `migrate dev`
 * e `migrate diff`. Se um dia a suíte passar a rodar um desses, esta trava
 * precisa olhar a sombra também.
 */
export function conferirBaseDeTeste(url: string): string {
  if (!url.startsWith('mysql://')) {
    throw new Error('A suíte precisa de uma DATABASE_URL de MySQL (decisão A42).')
  }

  let base: string
  try {
    base = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''))
  } catch {
    throw new Error('A DATABASE_URL da suíte não é uma URL válida.')
  }

  if (!/^[A-Za-z0-9_]+_teste$/.test(base)) {
    throw new Error(
      `A suíte apaga e recria a base inteira, e só aceita base cujo nome termina em "_teste". ` +
        `Recebi a base "${base || '(nenhuma)'}". Tire DATABASE_URL do shell ou aponte para uma base de teste.`,
    )
  }
  return base
}

export async function setup(): Promise<void> {
  const url = process.env['DATABASE_URL'] ?? PADRAO_LOCAL

  conferirBaseDeTeste(url)

  try {
    // `--force` pula a confirmação interativa, e é a ÚNICA bandeira que serve
    // aqui: o `migrate reset` do Prisma 7 aceita só `--help`, `--config`,
    // `--schema` e `--force`. Um `--skip-generate` — que existe em outros
    // comandos — derruba o setup inteiro com erro de uso, e a suíte nem começa.
    execSync('npx prisma migrate reset --force', {
      stdio: 'pipe',
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: url,
        // O Prisma exige consentimento explícito para uma ação destrutiva
        // quando detecta que quem chama pode ser um agente. Aqui a base é a de
        // TESTE, declarada em `vitest.config.ts`, criada para nascer e morrer
        // com a suíte — nenhum dado de desenvolvimento, e muito menos real,
        // está ao alcance deste comando.
        PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION:
          'base de teste descartavel, declarada em vitest.config.ts',
      },
    })
  } catch (erro) {
    // `pipe`, não `ignore`: a falha já subia, mas sem a única coisa que o
    // Prisma tinha a dizer — o CI ficava vermelho com `Command failed` e nada
    // mais, e descobrir que era uma migração quebrada exigia reproduzir na
    // máquina.
    const saida = (campo: 'stdout' | 'stderr') =>
      erro !== null && typeof erro === 'object' && campo in erro
        ? String((erro as Record<typeof campo, unknown>)[campo] ?? '')
        : ''

    throw new Error(
      'Não foi possível preparar o banco de teste. Confira se o MySQL está de pé e se a base ' +
        'de teste existe com a colação certa (ver README).\n' +
        `${saida('stderr')}${saida('stdout')}`.trim(),
      { cause: erro },
    )
  }
}
