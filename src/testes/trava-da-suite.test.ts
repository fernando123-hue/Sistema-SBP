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
