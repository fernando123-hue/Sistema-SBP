import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { ArmazenamentoEmDisco } from '../adapters/armazenamento-disco'
import { IaMock } from '../adapters/ia-mock'
import { IngestaoMock } from '../adapters/ingestao-mock'
import { sequenciaDeDatas } from '../core/util/datas'
import { obterPrisma } from '../servidor/prisma'
import { DATA_BASE, aprovarTudoNoBanco, atorDeTeste, limparTudo, semearBase } from '../testes/apoio'
import { confirmar } from './distribuicao'
import { devolver } from './fila'
import { sincronizar } from './ingestao'
import { limparTransacional } from '../../scripts/limpeza-transacional'

/** Raiz descartável: a limpeza remove bytes, e não pode ser a pasta real. */
const pastaTemporaria = () => mkdtemp(join(tmpdir(), 'sbp-limpeza-'))

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

  it('a rotina REAL de `db:limpar` continua funcionando, inclusive depois de uma devolução', async () => {
    // ═══ POR QUE ESTE TESTE CHAMA A ROTINA, E NÃO UMA CÓPIA DELA ═══
    //
    // A primeira versão deste teste reimplementava a ordem de limpeza à mão. As
    // duas listas divergiram na primeira oportunidade: o teste ganhou a linha
    // de `justificativaDeAtribuicao` e o script não, e o teste passou verde
    // afirmando que "a rotina de desenvolvimento apaga na ordem certa" enquanto
    // a rotina real quebrava depois de qualquer transferência ou devolução.
    // Achado da revisão técnica do PR #82.
    //
    // A devolução abaixo não é enfeite: é ela que cria a
    // `JustificativaDeAtribuicao` que fazia o script falhar.
    const base = await semearBase(banco, { totalDeDias: 1 })
    const [data] = sequenciaDeDatas(DATA_BASE, 1) as [string]
    await sincronizar(
      { banco, ingestao: new IngestaoMock({ datas: [data], semente: 5 }), ia: new IaMock() },
      base.operador,
    )
    await aprovarTudoNoBanco(banco)
    await confirmar(banco, { data, categorias: [] }, base.operador)

    const atribuicao = await banco.atribuicao.findFirstOrThrow({
      where: { ativa: true },
      select: { itemId: true, colaboradorId: true },
    })
    await devolver(
      banco,
      { itemId: atribuicao.itemId, justificativa: 'devolvido no teste da limpeza' },
      atorDeTeste(atribuicao.colaboradorId, 'operador'),
    )
    expect(await banco.justificativaDeAtribuicao.count()).toBeGreaterThan(0)

    const removidos = await limparTransacional(banco, new ArmazenamentoEmDisco(await pastaTemporaria()))

    expect(removidos.justificativas).toBeGreaterThan(0)
    expect(await banco.item.count()).toBe(0)
    expect(await banco.atribuicao.count()).toBe(0)
  })
})
