import mariadb, { type ConnectionConfig } from 'mariadb'

/**
 * Trava entre suítes: uma suíte por base de teste, por vez.
 *
 * O `globalSetup` começa com `prisma migrate reset`, que APAGA a base. Duas
 * suítes ao mesmo tempo na mesma base — um revisor rodando vitest enquanto o
 * autor roda `npm run verificar`, ou um vitest avulso no meio da suíte — se
 * derrubam: a segunda apaga as tabelas que a primeira está usando, e dezenas de
 * testes ficam vermelhos por um motivo que não é defeito nenhum (`P1014`). Visto
 * em 02/10 e de novo em 03/10 (61 falhas de mentira). A regra "nunca duas
 * suítes juntas" vivia só no `ESTADO.md`; agora a segunda é recusada antes de
 * apagar qualquer coisa.
 *
 * `GET_LOCK` do próprio MySQL, e não um arquivo de trava: o bloqueio pertence à
 * conexão, então some sozinho se o processo morrer no meio — não existe trava
 * esquecida para alguém apagar à mão. E vale para quem aponta para o MESMO
 * servidor, que é exatamente quem colide; outra máquina com outro MySQL não é
 * barrada à toa.
 */

/** O nome do bloqueio para uma base. O MySQL aceita até 64 caracteres. */
export function nomeDaTrava(base: string): string {
  return `sbp_suite:${base}`.slice(0, 64)
}

/**
 * Host, porta e credencial da URL, SEM a base: a trava é do servidor, e a base
 * pode nem existir ainda (o `reset` a recria). O driver `mariadb` não aceita o
 * esquema `mysql://` da `DATABASE_URL`, por isso a conversão.
 */
export function configDaConexao(url: string): ConnectionConfig {
  const endereco = new URL(url)
  return {
    host: endereco.hostname,
    port: Number(endereco.port || 3306),
    user: decodeURIComponent(endereco.username),
    password: decodeURIComponent(endereco.password),
    ...(endereco.searchParams.get('allowPublicKeyRetrieval') === 'true' ? { allowPublicKeyRetrieval: true } : {}),
  }
}

/**
 * Pega a trava sem esperar. Devolve a função que a solta (fechando a conexão).
 * Ocupada, ou resposta que não seja 1 — `GET_LOCK` devolve NULL em erro —,
 * recusa alto: na dúvida, não apagar a base de ninguém.
 */
export async function travarSuite(url: string, nome: string): Promise<() => Promise<void>> {
  const conexao = await mariadb.createConnection(configDaConexao(url))
  try {
    const [linha] = await conexao.query<{ ok: bigint | number | null }[]>('SELECT GET_LOCK(?, 0) AS ok', [nome])
    if (Number(linha?.ok) !== 1) {
      throw new Error(
        `Outra suíte de testes já está rodando contra este MySQL (trava "${nome}"). ` +
          'Duas ao mesmo tempo se derrubam: o `migrate reset` de uma apaga a base da outra. ' +
          'Espere a outra terminar e rode de novo.',
      )
    }
  } catch (erro) {
    await conexao.end()
    throw erro
  }
  return async () => {
    await conexao.end()
  }
}
