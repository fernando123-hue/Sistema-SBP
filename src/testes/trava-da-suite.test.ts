import mariadb from 'mariadb'
import { describe, expect, it } from 'vitest'

import { configDaConexao, nomeDaTrava, travarSuite } from './trava-da-suite'

/**
 * A suíte que roda AGORA já segura a trava da base de teste — é ela que está
 * executando este arquivo. Por isso os testes de pegar e soltar usam um nome
 * próprio, e o da base real só é conferido como "ocupado".
 */
const URL_DE_TESTE = process.env['DATABASE_URL'] ?? 'mysql://root@127.0.0.1:3307/sbp_teste'

describe('trava entre suítes', () => {
  it('a segunda suíte na mesma base é recusada, com o motivo', async () => {
    const liberar = await travarSuite(URL_DE_TESTE, 'sbp_suite:teste-da-trava')
    try {
      await expect(travarSuite(URL_DE_TESTE, 'sbp_suite:teste-da-trava')).rejects.toThrow(
        /Outra suíte de testes já está rodando/,
      )
    } finally {
      await liberar()
    }
  })

  it('soltar libera para a próxima', async () => {
    const primeira = await travarSuite(URL_DE_TESTE, 'sbp_suite:teste-da-trava')
    await primeira()
    const segunda = await travarSuite(URL_DE_TESTE, 'sbp_suite:teste-da-trava')
    await segunda()
  })

  it('a base de teste está travada enquanto esta suíte roda', async () => {
    const base = new URL(URL_DE_TESTE).pathname.slice(1)
    await expect(travarSuite(URL_DE_TESTE, nomeDaTrava(base))).rejects.toThrow(/Outra suíte/)
  })

  // Revisão técnica do PR (M1): a orientação que o `reset` dava se perdeu
  // quando a trava passou a ser a primeira a falar com o MySQL.
  it('MySQL fora do ar: orienta o que conferir, e a senha da URL não aparece', async () => {
    const semServidor = 'mysql://root:senha-que-nao-pode-vazar@127.0.0.1:1/sbp_teste'
    const erro = await travarSuite(semServidor, 'sbp_suite:teste-da-trava').catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(Error)
    expect((erro as Error).message).toMatch(/Confira se o MySQL está de pé/)
    expect((erro as Error).message).not.toContain('senha-que-nao-pode-vazar')
    expect(String((erro as Error).cause)).not.toContain('senha-que-nao-pode-vazar')
  })

  // Revisões do PR (M2, técnica e segurança): a conexão da trava cair no meio
  // da suíte solta o bloqueio — tem de ser percebido, não engolido.
  it('a conexão da trava cair é percebida', async () => {
    let perdida: unknown = null
    const avisada = new Promise<void>((resolve) => {
      void travarSuite(URL_DE_TESTE, 'sbp_suite:teste-da-queda', (_nome, causa) => {
        perdida = causa
        resolve()
      })
    })
    const outra = await mariadb.createConnection(configDaConexao(URL_DE_TESTE))
    try {
      // `IS_USED_LOCK` diz qual conexão segura a trava; derrubá-la é o
      // MySQL reiniciando, visto de dentro.
      let dono: bigint | number | null = null
      for (let tentativa = 0; dono === null && tentativa < 100; tentativa++) {
        const [linha] = await outra.query<{ dono: bigint | number | null }[]>('SELECT IS_USED_LOCK(?) AS dono', [
          'sbp_suite:teste-da-queda',
        ])
        dono = linha?.dono ?? null
      }
      expect(dono).not.toBeNull()
      await outra.query('KILL ?', [dono])
      await avisada
      expect(perdida).not.toBeNull()
      // E a trava, de fato, ficou livre: é por isso que a queda não pode passar calada.
      const [livre] = await outra.query<{ ok: bigint | number }[]>("SELECT GET_LOCK('sbp_suite:teste-da-queda', 0) AS ok")
      expect(Number(livre?.ok)).toBe(1)
    } finally {
      await outra.end()
    }
  })

  it('a conexão não escolhe base: a trava vale para o servidor, e a base é apagada no reset', () => {
    expect(configDaConexao('mysql://ana:s%40nha@db.local:3310/sbp_teste')).toEqual({
      host: 'db.local',
      port: 3310,
      user: 'ana',
      password: 's@nha',
    })
    expect(configDaConexao('mysql://root@127.0.0.1/sbp_teste?allowPublicKeyRetrieval=true')).toEqual({
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: '',
      allowPublicKeyRetrieval: true,
    })
  })
})
