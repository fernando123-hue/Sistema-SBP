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

  // Não só pelo conferidor, que pode ter lacuna (revisão de segurança do #182):
  // nenhum privilégio de estrutura, rotina ou repasse aparece no texto.
  it('nenhuma linha concede INDEX, ALTER, DROP, TRIGGER, CREATE, ROUTINE, VIEW, ALL ou GRANT OPTION', () => {
    expect(sqlDeConcessaoMinima(TABELAS, ALVO)).not.toMatch(/INDEX|ALTER|DROP|TRIGGER|CREATE|ROUTINE|VIEW|ALL|GRANT OPTION/)
  })

  it('host com "%" só com o pedido explícito', () => {
    expect(() => sqlDeConcessaoMinima(TABELAS, { ...ALVO, host: '%' })).toThrow(/--aceito-qualquer-host/)
    expect(sqlDeConcessaoMinima(TABELAS, { ...ALVO, host: '%', aceitaQualquerHost: true })).toContain("'sbp_app'@'%'")
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

describe('o conferidor acusa o que o gerador promete não dar (revisão de segurança do #182)', () => {
  it('INDEX na trilha é acusado: derrubar o índice do #147 reabre o oráculo de tempo', () => {
    const achados = privilegiosQueAmeacamATrilha(['GRANT SELECT, INSERT, INDEX ON `sbp`.`LogAuditoria` TO `app`@`%`'])
    expect(achados.map((achado) => achado.privilegio)).toEqual(['INDEX'])
  })

  it('WITH GRANT OPTION na trilha é acusado, mesmo só com SELECT e INSERT', () => {
    const achados = privilegiosQueAmeacamATrilha([
      'GRANT SELECT, INSERT ON `sbp`.`EventoProcessamento` TO `app`@`%` WITH GRANT OPTION',
    ])
    expect(achados).toEqual([expect.objectContaining({ privilegio: 'GRANT OPTION', alvo: 'EventoProcessamento' })])
  })

  it('WITH GRANT OPTION em outra tabela não acusa a trilha', () => {
    expect(privilegiosQueAmeacamATrilha(['GRANT SELECT ON `sbp`.`Item` TO `app`@`%` WITH GRANT OPTION'])).toEqual([])
  })
})
