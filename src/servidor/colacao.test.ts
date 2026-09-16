import { beforeEach, describe, expect, it } from 'vitest'

import { limparTudo } from '../testes/apoio'
import { obterPrisma } from './prisma'

/**
 * A colação que o `AT-10` exige, conferida no banco de verdade.
 *
 * ═══ O DEFEITO QUE ESTE ARQUIVO PEGA ═══
 *
 * O README manda criar a base com `utf8mb4_0900_as_cs`, sensível a maiúsculas
 * e acentos. Mas o Prisma escreve `COLLATE utf8mb4_unicode_ci` em CADA
 * `CREATE TABLE` que gera, e a colação da tabela vence a da base. Até
 * 16/09/2026 todas as tabelas estavam em `unicode_ci` — em desenvolvimento, na
 * base de teste e no CI —, e "Liga de Neonatologia" e "liga de neonatologia"
 * eram a mesma liga para o índice único, sem nenhum teste perceber.
 *
 * ═══ POR QUE CONFERIR TODAS AS COLUNAS ═══
 *
 * Toda migração nova que o Prisma gerar para uma tabela nova volta a trazer
 * `unicode_ci`. O teste de comportamento prova o caso da liga; a varredura
 * pega a próxima tabela antes de ela ir para produção.
 */

const banco = obterPrisma()

const COLACAO = 'utf8mb4_0900_as_cs'

beforeEach(async () => {
  await limparTudo(banco)
  await banco.ligante.deleteMany()
  await banco.liga.deleteMany()
})

describe('colação sensível a maiúsculas e acentos', () => {
  it('duas grafias da mesma liga são duas ligas', async () => {
    await banco.liga.create({ data: { nome: 'Liga de Neonatologia', instituicao: 'Faculdade Sintética' } })
    await banco.liga.create({ data: { nome: 'liga de neonatologia', instituicao: 'Faculdade Sintética' } })
    await banco.liga.create({ data: { nome: 'Liga de Neonatología', instituicao: 'Faculdade Sintética' } })

    expect(await banco.liga.count()).toBe(3)
  })

  it('busca por nome não confunde as grafias', async () => {
    await banco.liga.create({ data: { nome: 'Liga de Neonatologia', instituicao: null } })

    expect(await banco.liga.count({ where: { nome: 'LIGA DE NEONATOLOGIA' } })).toBe(0)
  })

  it('nenhuma coluna de texto do banco usa outra colação', async () => {
    const fora = await banco.$queryRaw<{ tabela: string; coluna: string; colacao: string }[]>`
      SELECT TABLE_NAME AS tabela, COLUMN_NAME AS coluna, COLLATION_NAME AS colacao
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND COLLATION_NAME IS NOT NULL
        AND COLLATION_NAME <> ${COLACAO}
        AND TABLE_NAME <> '_prisma_migrations'
      ORDER BY TABLE_NAME, COLUMN_NAME`

    expect(fora).toEqual([])
  })
})
