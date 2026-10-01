import { describe, expect, it } from 'vitest'

import { privilegiosQueAmeacamATrilha, sqlDeConcessaoMinima } from './privilegios'

/**
 * O SQL da concessão mínima (pendência 41). O roteiro antigo fazia `REVOKE`
 * numa tabela do que foi dado na base inteira, e o MySQL recusa com
 * `ERROR 1147`: o roteiro era impossível de seguir.
 */

const ALVO = { base: 'sbp', usuario: 'sbp_app', host: 'localhost' }
const TABELAS = ['Item', 'LogAuditoria', 'EventoProcessamento', '_prisma_migrations', 'Colaborador']

describe('a concessão mínima, tabela a tabela', () => {
  it('a trilha só ganha SELECT e INSERT; o resto as quatro de sempre; _prisma_migrations nada', () => {
    const sql = sqlDeConcessaoMinima(TABELAS, ALVO).split('\n')
    expect(sql).toEqual([
      "GRANT SELECT, INSERT, UPDATE, DELETE ON `sbp`.`Colaborador` TO 'sbp_app'@'localhost';",
      "GRANT SELECT, INSERT ON `sbp`.`EventoProcessamento` TO 'sbp_app'@'localhost';",
      "GRANT SELECT, INSERT, UPDATE, DELETE ON `sbp`.`Item` TO 'sbp_app'@'localhost';",
      "GRANT SELECT, INSERT ON `sbp`.`LogAuditoria` TO 'sbp_app'@'localhost';",
    ])
  })

  it('o que ela concede passa no próprio conferidor da trilha', () => {
    const concessoes = sqlDeConcessaoMinima(TABELAS, ALVO).split('\n').map((linha) => linha.replace(/;$/, ''))
    expect(privilegiosQueAmeacamATrilha(concessoes)).toEqual([])
  })

  it.each([
    ['base', { ...ALVO, base: 'sbp`; DROP DATABASE sbp; --' }],
    ['usuário', { ...ALVO, usuario: "app'@'%" }],
    ['host', { ...ALVO, host: "localhost' OR '1" }],
  ])('%s fora do formato recusa, em vez de virar outro SQL', (_qual, alvo) => {
    expect(() => sqlDeConcessaoMinima(TABELAS, alvo)).toThrow(/fora do formato/)
  })

  it('tabela com nome fora do formato recusa', () => {
    expect(() => sqlDeConcessaoMinima([...TABELAS, 'x`; DROP'], ALVO)).toThrow(/fora do formato/)
  })

  it('base sem a trilha (sem migração) recusa: o usuário nem gravaria a trilha', () => {
    expect(() => sqlDeConcessaoMinima(['Item'], ALVO)).toThrow(/rode as migrações/)
  })
})
