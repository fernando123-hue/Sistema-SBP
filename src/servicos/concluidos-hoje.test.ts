import { beforeEach, describe, expect, it } from 'vitest'

import { serializar } from '../core/esquemas'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo, semearBase, type BaseSemeada } from '../testes/apoio'
import { concluidosHoje, concluir, concluirDoMesmoEmail } from './fila'

/**
 * "Hoje você concluiu N" (`A69`, 5A; `A71`).
 *
 * O dono decidiu: "apenas o funcionário da conta específica verá quantos ele
 * fez no dia e sempre será resetado no fim do dia". Por isso o número:
 *
 * - é do `Ator`, e de mais ninguém: a função não recebe id de pessoa;
 * - é calculado das execuções do dia de São Paulo, sem nada guardado, então
 *   "zerar" é o dia mudar;
 * - conta só conclusão: devolver ou ter o item cancelado não é trabalho feito.
 *
 * Dados 100% sintéticos (invariante 8).
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

let sequencia = 0

/** Um item distribuído na fila de `donoId`, opcionalmente de um e-mail. */
async function itemNaFila(base: BaseSemeada, donoId: string, emailId: string | null = null): Promise<string> {
  sequencia += 1
  const categoria = await banco.categoria.findFirstOrThrow({ where: { codigo: 'DOC_CADASTRO' } })
  const item = await banco.item.create({
    data: {
      emailId,
      categoriaId: categoria.id,
      sequencia,
      titulo: `Item sintético ${sequencia}`,
      payload: serializar({
        campos: {},
        camposAusentes: [],
        ligaMencionada: null,
        observacao: null,
        revisadoPorHumano: false,
      }),
      confianca: 0.9,
      status: 'distribuido',
    },
  })
  await banco.atribuicao.create({
    data: { itemId: item.id, colaboradorId: donoId, motivo: 'manual', atribuidoPor: base.operadorId, ativa: true },
  })
  return item.id
}

/** Uma execução gravada no instante dado, como `concluir` a deixaria. */
async function execucaoEm(
  base: BaseSemeada,
  donoId: string,
  concluidoEm: Date,
  resultado: 'concluido' | 'devolvido' | 'cancelado' = 'concluido',
): Promise<void> {
  const itemId = await itemNaFila(base, donoId)
  await banco.execucao.create({ data: { itemId, colaboradorId: donoId, concluidoEm, resultado } })
}

describe('concluidosHoje', () => {
  it('conta só o que a própria pessoa concluiu, nunca o de colegas', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const [dora, eli] = base.colaboradores
    for (let i = 0; i < 2; i += 1) {
      await concluir(banco, { itemId: await itemNaFila(base, dora!.id) }, dora!.ator)
    }
    await concluir(banco, { itemId: await itemNaFila(base, eli!.id) }, eli!.ator)

    expect((await concluidosHoje(banco, dora!.ator)).concluidos).toBe(2)
    expect((await concluidosHoje(banco, eli!.ator)).concluidos).toBe(1)
    // Operadora vê o próprio número, que é zero: ela não concluiu nada.
    expect((await concluidosHoje(banco, base.operador)).concluidos).toBe(0)
  })

  it('"Concluir os N" de um e-mail conta os N, como conta no Painel', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const dora = base.colaboradores[0]!
    const email = await banco.email.create({
      data: { messageId: 'concluidos-hoje-1@teste.local', recebidoEm: new Date('2026-09-01T12:00:00Z') },
    })
    const ids: string[] = []
    for (let i = 0; i < 3; i += 1) ids.push(await itemNaFila(base, dora.id, email.id))

    await concluirDoMesmoEmail(banco, { itemIds: ids }, dora.ator)

    expect((await concluidosHoje(banco, dora.ator)).concluidos).toBe(3)
  })

  it('recomeça à meia-noite de São Paulo, e não à meia-noite UTC', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const dora = base.colaboradores[0]!
    // 01/10 às 23:59 em São Paulo (02:59 UTC do dia 2): ainda é o dia 1.
    await execucaoEm(base, dora.id, new Date('2026-10-02T02:59:59.000Z'))
    // 02/10 à 00:00 em São Paulo: já é o dia 2.
    await execucaoEm(base, dora.id, new Date('2026-10-02T03:00:00.000Z'))
    await execucaoEm(base, dora.id, new Date('2026-10-02T20:00:00.000Z'))

    const meioDoDia2 = new Date('2026-10-02T15:00:00.000Z')
    expect(await concluidosHoje(banco, dora.ator, meioDoDia2)).toEqual({ data: '2026-10-02', concluidos: 2 })

    // Às 22h de São Paulo do dia 1 (01:00 UTC do dia 2) o UTC já virou, o dia não.
    const noiteDoDia1 = new Date('2026-10-02T01:00:00.000Z')
    expect(await concluidosHoje(banco, dora.ator, noiteDoDia1)).toEqual({ data: '2026-10-01', concluidos: 1 })

    // No dia 3, zero: nada foi guardado para zerar.
    const dia3 = new Date('2026-10-03T12:00:00.000Z')
    expect((await concluidosHoje(banco, dora.ator, dia3)).concluidos).toBe(0)
  })

  it('devolver e cancelar não contam como concluído', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const dora = base.colaboradores[0]!
    const agora = new Date('2026-10-02T15:00:00.000Z')
    await execucaoEm(base, dora.id, agora, 'devolvido')
    await execucaoEm(base, dora.id, agora, 'cancelado')
    await execucaoEm(base, dora.id, agora, 'concluido')

    expect((await concluidosHoje(banco, dora.ator, agora)).concluidos).toBe(1)
  })

  it('não recebe id de pessoa: o número de outra conta não tem caminho para sair', () => {
    // A assinatura é a guarda (invariante 5, `A71`). Um terceiro parâmetro
    // opcional seria o primeiro passo para "ver o de fulano".
    expect(concluidosHoje.length).toBe(2)
  })
})
