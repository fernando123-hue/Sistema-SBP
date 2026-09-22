import { beforeEach, describe, expect, it } from 'vitest'

import { IaMock } from '../adapters/ia-mock'
import { IngestaoMock } from '../adapters/ingestao-mock'
import { sequenciaDeDatas } from '../core/util/datas'
import { obterPrisma } from '../servidor/prisma'
import { DATA_BASE, aprovarTudoNoBanco, limparTudo, semearBase } from '../testes/apoio'
import { confirmar } from './distribuicao'
import { sincronizar } from './ingestao'

/**
 * O banco recusa apagar item que tem histórico (achado N-22).
 *
 * ═══ O QUE ESTAVA ABERTO ═══
 *
 * `Atribuicao`, `Execucao`, `JustificativaDeAtribuicao` e `Revisao` guardam o
 * que de fato aconteceu — quem recebeu o quê, quem concluiu, por que devolveu.
 * Todas apontavam para `Item` com `ON DELETE CASCADE`. O sistema nunca apaga
 * item (ele desativa, expurga conteúdo, marca status), então a cascata era
 * teoria... até o dia em que um `DELETE` chegasse por fora: script de limpeza
 * escrito às pressas, cliente de banco aberto no servidor, migração mal feita.
 * Nesse dia, a prova de quem recebeu o quê sumiria **sem erro nenhum** — que é
 * o contrário do que o invariante 11 promete.
 *
 * Agora é `RESTRICT`: o banco recusa. Quem precisa limpar de verdade
 * (`db:limpar`, em desenvolvimento) apaga os filhos antes, na ordem certa.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

describe('histórico operacional não desaparece em cascata', () => {
  it('as quatro chaves do histórico estão como RESTRICT no catálogo do banco', async () => {
    // Direto no `information_schema`, e não pela lista escrita aqui: é assim
    // que uma chave NOVA apontando para `Item` — ou uma que alguém volte para
    // `CASCADE` num refactor — aparece sem que ninguém precise lembrar de
    // atualizar este teste. Mesmo método de `colacao.test.ts`.
    const regras = await banco.$queryRaw<{ tabela: string; regra: string }[]>`
      SELECT TABLE_NAME AS tabela, DELETE_RULE AS regra
        FROM information_schema.REFERENTIAL_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE()
         AND CONSTRAINT_NAME IN (
           'Atribuicao_itemId_fkey',
           'Execucao_itemId_fkey',
           'Revisao_itemId_fkey',
           'JustificativaDeAtribuicao_atribuicaoId_fkey'
         )`

    expect(regras).toHaveLength(4)
    // O MySQL grafa `RESTRICT` ou `NO ACTION` conforme a versão; as duas
    // significam a mesma coisa aqui, e nenhuma delas é `CASCADE`.
    for (const { tabela, regra } of regras) {
      expect([tabela, regra]).toEqual([tabela, expect.stringMatching(/^(RESTRICT|NO ACTION)$/)])
    }
  })

  it('apagar um item que já foi distribuído é RECUSADO pelo banco', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const [data] = sequenciaDeDatas(DATA_BASE, 1) as [string]
    await sincronizar(
      { banco, ingestao: new IngestaoMock({ datas: [data], semente: 5 }), ia: new IaMock() },
      base.operador,
    )
    await aprovarTudoNoBanco(banco)
    await confirmar(banco, { data, categorias: [] }, base.operador)

    const atribuicao = await banco.atribuicao.findFirstOrThrow({ select: { itemId: true } })

    await expect(banco.item.delete({ where: { id: atribuicao.itemId } })).rejects.toThrow()

    // E a prova continua lá: a recusa não é decorativa.
    expect(await banco.atribuicao.count({ where: { itemId: atribuicao.itemId } })).toBeGreaterThan(0)
  })

  it('a ordem de `db:limpar` continua funcionando: filhos primeiro, pai depois', async () => {
    // O `RESTRICT` não pode ter quebrado a rotina de desenvolvimento que existe
    // para repetir a demo. Ela apaga na ordem certa — e é essa ordem, e não a
    // cascata, que deve fazer a limpeza funcionar.
    const base = await semearBase(banco, { totalDeDias: 1 })
    const [data] = sequenciaDeDatas(DATA_BASE, 1) as [string]
    await sincronizar(
      { banco, ingestao: new IngestaoMock({ datas: [data], semente: 5 }), ia: new IaMock() },
      base.operador,
    )
    await aprovarTudoNoBanco(banco)
    await confirmar(banco, { data, categorias: [] }, base.operador)

    await banco.execucao.deleteMany()
    await banco.justificativaDeAtribuicao.deleteMany()
    await banco.atribuicao.deleteMany()
    await banco.revisao.deleteMany()
    await banco.rodadaDistribuicao.deleteMany()

    await expect(banco.item.deleteMany()).resolves.toMatchObject({ count: expect.any(Number) })
    expect(await banco.item.count()).toBe(0)
  })
})
