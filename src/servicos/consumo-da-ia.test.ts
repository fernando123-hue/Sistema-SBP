import { beforeEach, describe, expect, it } from 'vitest'

import { obterPrisma } from '../servidor/prisma'
import { chamadasDoDia, registrarChamada } from './consumo-da-ia'

/**
 * A contagem que sustenta o teto diário (`A54`, achado C-06).
 *
 * O teto é a única trava que precisa sobreviver a um reinício do servidor —
 * por isso ela mora no banco, e por isso ela é somada por `increment`: duas
 * sincronizações ao mesmo tempo somam as duas, sem ler antes.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await banco.usoDaIa.deleteMany({})
})

describe('registrarChamada', () => {
  it('a primeira chamada do dia cria a linha', async () => {
    await registrarChamada(banco, {
      dia: '2026-09-18',
      fornecedor: 'gemini',
      modelo: 'gemini-3.5-flash',
      tarefa: 'interpretacao',
      resultado: 'ok',
      duracaoMs: 1200,
    })

    const linha = await banco.usoDaIa.findFirstOrThrow({})
    expect(linha).toMatchObject({ chamadas: 1, falhas: 0, duracaoMsTotal: 1200 })
  })

  it('a segunda soma na mesma linha, e a falha conta nos dois números', async () => {
    const base = {
      dia: '2026-09-18',
      fornecedor: 'gemini',
      modelo: 'gemini-3.5-flash',
      tarefa: 'interpretacao' as const,
      duracaoMs: 100,
    }
    await registrarChamada(banco, { ...base, resultado: 'ok' })
    await registrarChamada(banco, { ...base, resultado: 'falha' })

    const linha = await banco.usoDaIa.findFirstOrThrow({})
    // A falha também é chamada: ela foi paga, e é ela que faz o teto existir.
    expect(linha).toMatchObject({ chamadas: 2, falhas: 1, duracaoMsTotal: 200 })
  })

  it('modelos e tarefas diferentes são linhas diferentes — é o modelo que tem preço', async () => {
    const base = { dia: '2026-09-18', fornecedor: 'gemini', resultado: 'ok' as const, duracaoMs: 1 }
    await registrarChamada(banco, { ...base, modelo: 'a', tarefa: 'interpretacao' })
    await registrarChamada(banco, { ...base, modelo: 'b', tarefa: 'interpretacao' })
    await registrarChamada(banco, { ...base, modelo: 'a', tarefa: 'assistente' })

    expect(await banco.usoDaIa.count()).toBe(3)
  })

  it('chamadas ao mesmo tempo não se perdem', async () => {
    const base = {
      dia: '2026-09-18',
      fornecedor: 'gemini',
      modelo: 'gemini-3.5-flash',
      tarefa: 'interpretacao' as const,
      resultado: 'ok' as const,
      duracaoMs: 10,
    }
    await Promise.all(Array.from({ length: 12 }, () => registrarChamada(banco, base)))

    const linha = await banco.usoDaIa.findFirstOrThrow({})
    expect(linha.chamadas).toBe(12)
  })
})

describe('chamadasDoDia', () => {
  it('soma todos os modelos e tarefas do fornecedor no dia', async () => {
    const base = { dia: '2026-09-18', fornecedor: 'gemini', resultado: 'ok' as const, duracaoMs: 1 }
    await registrarChamada(banco, { ...base, modelo: 'a', tarefa: 'interpretacao' })
    await registrarChamada(banco, { ...base, modelo: 'a', tarefa: 'interpretacao' })
    await registrarChamada(banco, { ...base, modelo: 'b', tarefa: 'assistente' })

    expect(await chamadasDoDia(banco, 'gemini', '2026-09-18')).toBe(3)
  })

  it('não mistura fornecedores nem dias — o teto é por fornecedor e zera à meia-noite', async () => {
    const base = { modelo: 'a', tarefa: 'interpretacao' as const, resultado: 'ok' as const, duracaoMs: 1 }
    await registrarChamada(banco, { ...base, dia: '2026-09-18', fornecedor: 'gemini' })
    await registrarChamada(banco, { ...base, dia: '2026-09-18', fornecedor: 'anthropic' })
    await registrarChamada(banco, { ...base, dia: '2026-09-17', fornecedor: 'gemini' })

    expect(await chamadasDoDia(banco, 'gemini', '2026-09-18')).toBe(1)
  })

  it('dia sem chamada nenhuma é zero, não erro', async () => {
    expect(await chamadasDoDia(banco, 'gemini', '2026-09-18')).toBe(0)
  })
})
