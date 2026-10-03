import mariadb, { type Connection, type ConnectionConfig } from 'mariadb'

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
 *
 * Só `allowPublicKeyRetrieval` é repassado, de propósito: é o único parâmetro
 * que as URLs deste projeto usam (`AT-64`). Um MySQL de teste que exija TLS ou
 * socket falha aqui com a mensagem de `travarSuite`, antes do `reset` — alto,
 * nunca em silêncio.
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
 * A conexão da trava caiu no meio da suíte (MySQL reiniciou, `KILL`, rede): o
 * MySQL soltou o bloqueio, e outra suíte já pode apagar a base debaixo desta.
 * Resultado colhido daqui em diante não vale — então PARA, com o motivo. Sem
 * este tratador, o driver derrubava o processo com "socket has unexpectedly
 * been closed" e nada mais (revisões do PR da trava).
 */
function pararPorTravaPerdida(nome: string, causa: unknown): never {
  throw new Error(
    `A trava entre suítes ("${nome}") caiu no meio da suíte. Outra suíte pode ter apagado ` +
      'a base enquanto esta rodava, então o resultado não vale: rode de novo.',
    { cause: causa },
  )
}

/**
 * De quanto em quanto a conexão da trava dá sinal de vida. Mantém o
 * `wait_timeout` do servidor longe e descobre a queda durante a suíte, não só
 * no fim.
 */
const INTERVALO_DO_PING_MS = 60_000

/**
 * Pega a trava sem esperar. Devolve a função que a solta (fechando a conexão).
 * Ocupada, ou resposta que não seja 1 — `GET_LOCK` devolve NULL em erro —,
 * recusa alto: na dúvida, não apagar a base de ninguém.
 *
 * `aoPerder` só existe para o teste provar a queda sem derrubar o próprio
 * processo; fora dele, é sempre `pararPorTravaPerdida`.
 */
export async function travarSuite(
  url: string,
  nome: string,
  aoPerder: (nome: string, causa: unknown) => void = pararPorTravaPerdida,
): Promise<() => Promise<void>> {
  let conexao: Connection
  try {
    conexao = await mariadb.createConnection(configDaConexao(url))
  } catch (erro) {
    // A orientação que o `migrate reset` dava quando o MySQL não respondia —
    // agora é aqui que a falta do MySQL aparece primeiro. A mensagem do driver
    // traz host e porta, nunca a senha.
    throw new Error(
      'Não foi possível conectar ao MySQL de teste para pegar a trava entre suítes. Confira se o ' +
        'MySQL está de pé e se a DATABASE_URL de teste está certa (ver README).',
      { cause: erro },
    )
  }

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
    // O erro que importa é o de cima; um `end` que falhe não pode escondê-lo.
    await conexao.end().catch(() => {})
    throw erro
  }

  let soltando = false
  const perdida = (causa: unknown) => {
    if (!soltando) aoPerder(nome, causa)
  }
  conexao.on('error', perdida)
  const ping = setInterval(() => {
    conexao.ping().catch(perdida)
  }, INTERVALO_DO_PING_MS)
  // O ping não segura o processo vivo depois do fim da suíte.
  ping.unref()

  return async () => {
    soltando = true
    clearInterval(ping)
    await conexao.end()
  }
}
