import { describe, expect, it } from 'vitest'

import { type AlvoDaConcessao, lerCaixaDosNomes, privilegiosQueAmeacamATrilha, sqlDeConcessaoMinima } from './privilegios'

/**
 * O SQL da concessão mínima (pendência 41). O roteiro antigo fazia `REVOKE`
 * numa tabela do que foi dado na base inteira, e o MySQL recusa com
 * `ERROR 1147`: o roteiro era impossível de seguir.
 */

const ALVO: AlvoDaConcessao = { base: 'sbp', usuario: 'sbp_app', host: 'localhost', caixaDosNomes: 0 }
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

  // No Windows o MySQL roda com `lower_case_table_names=1` e o `SHOW TABLES`
  // devolve tudo em minúsculas. Comparar com caixa recusava a base migrada com
  // "A base não tem LogAuditoria" (medido em 02/10/2026 no MySQL 8.4 desta máquina).
  it('no MySQL do Windows (lower_case_table_names=1) a trilha em minúsculas é a trilha', () => {
    const doWindows = ['item', 'logauditoria', 'eventoprocessamento', '_prisma_migrations']
    const sql = sqlDeConcessaoMinima(doWindows, { ...ALVO, caixaDosNomes: 1 }).split('\n')
    expect(sql).toEqual([
      "GRANT SELECT, INSERT ON `sbp`.`eventoprocessamento` TO 'sbp_app'@'localhost';",
      "GRANT SELECT, INSERT, UPDATE, DELETE ON `sbp`.`item` TO 'sbp_app'@'localhost';",
      "GRANT SELECT, INSERT ON `sbp`.`logauditoria` TO 'sbp_app'@'localhost';",
    ])
    expect(privilegiosQueAmeacamATrilha(sql.map((linha) => linha.replace(/;$/, '')))).toEqual([])
  })

  // No Linux a caixa conta: `logauditoria` é OUTRA tabela, e tratá-la como a
  // trilha daria uma base sem a trilha de verdade por migrada.
  it('no Linux (lower_case_table_names=0) a trilha em minúsculas não é a trilha', () => {
    expect(() => sqlDeConcessaoMinima(['Item', 'logauditoria', 'eventoprocessamento'], ALVO)).toThrow(/rode as migrações/)
  })

  // Base restaurada do Windows num Linux: "rode as migrações" mandaria o TI
  // procurar o defeito no lugar errado (revisão técnica do #187, B3).
  it('no Linux, a trilha só em outra caixa recusa apontando a caixa, não só as migrações', () => {
    expect(() => sqlDeConcessaoMinima(['Item', 'logauditoria', 'eventoprocessamento'], ALVO)).toThrow(
      /lower_case_table_names/,
    )
  })

  it('no macOS (lower_case_table_names=2) a caixa de criação é conservada e a trilha é a trilha', () => {
    const doMac = ['Item', 'LogAuditoria', 'EventoProcessamento']
    expect(sqlDeConcessaoMinima(doMac, { ...ALVO, caixaDosNomes: 2 }).split('\n')).toEqual([
      "GRANT SELECT, INSERT ON `sbp`.`EventoProcessamento` TO 'sbp_app'@'localhost';",
      "GRANT SELECT, INSERT, UPDATE, DELETE ON `sbp`.`Item` TO 'sbp_app'@'localhost';",
      "GRANT SELECT, INSERT ON `sbp`.`LogAuditoria` TO 'sbp_app'@'localhost';",
    ])
  })

  it('no Windows, base sem a trilha continua recusada', () => {
    expect(() => sqlDeConcessaoMinima(['item'], { ...ALVO, caixaDosNomes: 1 })).toThrow(/rode as migrações/)
  })
})

/**
 * `@@lower_case_table_names` chega do banco como `number`, `bigint` ou o que o
 * driver quiser. Fora de 0, 1 e 2 caía em silêncio no ramo "sem caixa": num
 * Linux com só uma `logauditoria` qualquer, a base sem a trilha de verdade
 * passava por migrada (revisão técnica do #187, M1). Invariante 7: falhar alto.
 */
describe('a caixa dos nomes lida do servidor', () => {
  it.each([
    [0, 0],
    [1, 1],
    [2, 2],
    [1n, 1],
    [2n, 2],
  ])('%s vira %s', (valor, esperado) => {
    expect(lerCaixaDosNomes(valor)).toBe(esperado)
  })

  it.each([[Number.NaN], [3], [-1], [0.5], [null], [undefined], ['1'], [3n]])('%s recusa', (valor) => {
    expect(() => lerCaixaDosNomes(valor)).toThrow(/lower_case_table_names/)
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
