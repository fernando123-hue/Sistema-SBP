import { describe, expect, it } from 'vitest'

import { obterPrisma } from './prisma'
import { modoSqlEstrito } from './privilegios'

/**
 * A recusa de linha sem domínio (#199) e a de texto maior que a coluna dependem
 * do modo ESTRITO do MySQL. Sem ele, o banco grava `''` ou corta o texto com um
 * aviso que ninguém lê — o oposto do invariante 7. O padrão do MySQL 8.4 é
 * estrito, mas é uma linha de configuração do servidor, e `db:conferir-trilha`
 * passa a conferir (revisão de segurança do #199).
 */
describe('modo SQL estrito', () => {
  it('reconhece os dois modos estritos, em qualquer posição da lista', () => {
    expect(modoSqlEstrito('ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE')).toBe(true)
    expect(modoSqlEstrito('STRICT_ALL_TABLES')).toBe(true)
  })

  it('sem nenhum dos dois, não é estrito — nem com nome parecido', () => {
    expect(modoSqlEstrito('')).toBe(false)
    expect(modoSqlEstrito('ONLY_FULL_GROUP_BY,NO_ENGINE_SUBSTITUTION')).toBe(false)
    expect(modoSqlEstrito('NAO_STRICT_TRANS_TABLES_DE_VERDADE')).toBe(false)
  })

  it('valor que não é texto recusa, em vez de adivinhar', () => {
    expect(() => modoSqlEstrito(null)).toThrow(/sql_mode/)
    expect(() => modoSqlEstrito(42)).toThrow(/sql_mode/)
  })

  it('o MySQL desta suíte está em modo estrito', async () => {
    const [linha] = await obterPrisma().$queryRaw<{ modo: unknown }[]>`SELECT @@GLOBAL.sql_mode AS modo`
    expect(modoSqlEstrito(linha?.modo)).toBe(true)
  })
})
