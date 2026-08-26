import { describe, expect, it } from 'vitest'

import type { Elegivel } from '../tipos'
import { criarCategoria, criarElegivel } from '../testes/fabricas'
import { criarRandom, somar } from '../util/numero'
import { distribuir } from './motor'

/**
 * Testes de propriedade e simulação.
 *
 * Alvo: os critérios de aceitação 1 e 4 do PRD.
 * A base atual da planilha é 71% de dias com conservação. Aqui tem que ser 100%,
 * por construção — e é verificado em milhares de casos.
 */

const EQUIPE = ['ana', 'bia', 'cris', 'davi', 'ester'] as const

function reidratar(
  ids: readonly string[],
  creditoCategoria: Record<string, number>,
  creditoGlobal: Record<string, number>,
  recebidoPeriodo: Record<string, number>,
): Elegivel[] {
  return ids.map((id) =>
    criarElegivel(id, {
      creditoCategoria: creditoCategoria[id] ?? 0,
      creditoGlobal: creditoGlobal[id] ?? 0,
      recebidoPeriodo: recebidoPeriodo[id] ?? 0,
      recebidoDia: 0,
    }),
  )
}

describe('conservação — o invariante que a planilha quebra em 29% dos dias', () => {
  it('preserva a soma em 1.000 casos aleatórios com seed fixa', () => {
    const random = criarRandom(20260812)
    let verificados = 0

    for (let caso = 0; caso < 1000; caso += 1) {
      const quantidade = Math.floor(random() * 200)
      const totalPessoas = 1 + Math.floor(random() * EQUIPE.length)
      const elegiveis = EQUIPE.slice(0, totalPessoas).map((id) =>
        criarElegivel(id, {
          creditoCategoria: random() * 4 - 2,
          creditoGlobal: random() * 10 - 5,
          recebidoPeriodo: Math.floor(random() * 100),
          recebidoDia: Math.floor(random() * 20),
        }),
      )

      const resultado = distribuir({
        data: '2026-08-12',
        categoria: criarCategoria(),
        quantidade,
        elegiveis,
      })

      const alocado = Object.values(resultado.alocacao)
      expect(somar(alocado)).toBe(quantidade)
      expect(alocado.every((valor) => Number.isInteger(valor) && valor >= 0)).toBe(true)
      verificados += 1
    }

    expect(verificados).toBe(1000)
  })

  it('nenhuma alocação é fracionária, mesmo com peso não inteiro', () => {
    const resultado = distribuir({
      data: '2026-08-12',
      categoria: criarCategoria({ peso: 2.5 }),
      quantidade: 47,
      elegiveis: [criarElegivel('ana'), criarElegivel('bia'), criarElegivel('cris')],
    })

    expect(Object.values(resultado.alocacao).every(Number.isInteger)).toBe(true)
    expect(somar(Object.values(resultado.alocacao))).toBe(47)
  })
})

describe('estabilidade numérica do livro-razão', () => {
  // Regressão. A primeira versão arredondava a cota justa a 6 casas e vazava
  // ~1e-6 de crédito por rodada — invisível num teste, fatal em três anos de uso.
  it('5.000 rodadas com n = 3 não acumulam drift no crédito', () => {
    const random = criarRandom(4242)
    const categoria = criarCategoria()
    const ids = EQUIPE.slice(0, 3)

    const creditoCategoria: Record<string, number> = {}
    const creditoGlobal: Record<string, number> = {}
    const recebidoPeriodo: Record<string, number> = {}

    for (let rodada = 0; rodada < 5000; rodada += 1) {
      const quantidade = 4 + Math.floor(random() * 200)
      const resultado = distribuir({
        data: '2026-12-01',
        categoria,
        quantidade,
        elegiveis: reidratar(ids, creditoCategoria, creditoGlobal, recebidoPeriodo),
      })

      for (const id of ids) {
        creditoCategoria[id] = resultado.creditoCategoriaDepois[id]!
        creditoGlobal[id] = resultado.creditoGlobalDepois[id]!
        recebidoPeriodo[id] = (recebidoPeriodo[id] ?? 0) + resultado.alocacao[id]!
      }
    }

    // a soma dos créditos tem que continuar zero: nenhum trabalho criado nem destruído
    const soma = somar(ids.map((id) => creditoCategoria[id]!))
    expect(Math.abs(soma)).toBeLessThan(1e-9)

    // e o volume total distribuído bate com o crédito residual de cada um
    const totalDistribuido = somar(ids.map((id) => recebidoPeriodo[id]!))
    for (const id of ids) {
      const desvio = Math.abs(recebidoPeriodo[id]! - totalDistribuido / 3)
      expect(desvio).toBeLessThan(1)
    }
  })
})

describe('balanceamento ao longo do tempo', () => {
  it('30 dias, 3 pessoas fixas: |crédito| fica abaixo de 1 unidade a todo momento', () => {
    const random = criarRandom(7)
    const categoria = criarCategoria()
    const ids = EQUIPE.slice(0, 3)

    const creditoCategoria: Record<string, number> = {}
    const creditoGlobal: Record<string, number> = {}
    const recebidoPeriodo: Record<string, number> = {}
    let picoDeCredito = 0

    for (let dia = 0; dia < 30; dia += 1) {
      // acima do limiar de indivisibilidade — caminho `resto_maior`
      const quantidade = 4 + Math.floor(random() * 60)

      const resultado = distribuir({
        data: `2026-09-${String(dia + 1).padStart(2, '0')}`,
        categoria,
        quantidade,
        elegiveis: reidratar(ids, creditoCategoria, creditoGlobal, recebidoPeriodo),
      })

      expect(somar(Object.values(resultado.alocacao))).toBe(quantidade)

      for (const id of ids) {
        creditoCategoria[id] = resultado.creditoCategoriaDepois[id]!
        creditoGlobal[id] = resultado.creditoGlobalDepois[id]!
        recebidoPeriodo[id] = (recebidoPeriodo[id] ?? 0) + resultado.alocacao[id]!
        picoDeCredito = Math.max(picoDeCredito, Math.abs(creditoCategoria[id]!))
      }
    }

    expect(picoDeCredito).toBeLessThan(1)
  })

  it('30 dias com escala variável: ausência não gera vantagem acumulada', () => {
    const random = criarRandom(99)
    const categoria = criarCategoria()

    const creditoCategoria: Record<string, number> = {}
    const creditoGlobal: Record<string, number> = {}
    const recebidoPeriodo: Record<string, number> = {}
    let picoDeCredito = 0

    for (let dia = 0; dia < 30; dia += 1) {
      // reproduz a realidade da planilha: J = 2 na maioria dos dias, 4-7 cadastrados
      const totalDePlantao = 2 + Math.floor(random() * 3)
      const deslocamento = Math.floor(random() * EQUIPE.length)
      const ids = Array.from(
        { length: totalDePlantao },
        (_, indice) => EQUIPE[(deslocamento + indice) % EQUIPE.length]!,
      )
      const quantidade = 4 + Math.floor(random() * 60)

      const resultado = distribuir({
        data: `2026-10-${String(dia + 1).padStart(2, '0')}`,
        categoria,
        quantidade,
        elegiveis: reidratar(ids, creditoCategoria, creditoGlobal, recebidoPeriodo),
      })

      expect(somar(Object.values(resultado.alocacao))).toBe(quantidade)

      for (const id of ids) {
        creditoCategoria[id] = resultado.creditoCategoriaDepois[id]!
        creditoGlobal[id] = resultado.creditoGlobalDepois[id]!
        recebidoPeriodo[id] = (recebidoPeriodo[id] ?? 0) + resultado.alocacao[id]!
        picoDeCredito = Math.max(picoDeCredito, Math.abs(creditoCategoria[id]!))
      }
    }

    expect(picoDeCredito).toBeLessThan(1)
  })

  it('lotes indivisíveis podem estourar 1 temporariamente, mas o crédito volta a zero', () => {
    // Comportamento honesto e documentado: quando Q <= limiar, o lote inteiro vai
    // para uma pessoa e o crédito salta até o tamanho do lote. Ver DECISOES.md § C2.
    const categoria = criarCategoria({ limiarIndivisivel: 3 })
    const ids = ['ana', 'bia'] as const

    const creditoCategoria: Record<string, number> = {}
    const creditoGlobal: Record<string, number> = {}
    const recebidoPeriodo: Record<string, number> = {}
    let picoDeCredito = 0

    // 10 dias seguidos com FICHA = 3
    for (let dia = 0; dia < 10; dia += 1) {
      const resultado = distribuir({
        data: `2026-11-${String(dia + 1).padStart(2, '0')}`,
        categoria,
        quantidade: 3,
        elegiveis: reidratar(ids, creditoCategoria, creditoGlobal, recebidoPeriodo),
      })

      expect(resultado.criterio).toBe('indivisivel')
      expect(somar(Object.values(resultado.alocacao))).toBe(3)

      for (const id of ids) {
        creditoCategoria[id] = resultado.creditoCategoriaDepois[id]!
        creditoGlobal[id] = resultado.creditoGlobalDepois[id]!
        recebidoPeriodo[id] = (recebidoPeriodo[id] ?? 0) + resultado.alocacao[id]!
        picoDeCredito = Math.max(picoDeCredito, Math.abs(creditoCategoria[id]!))
      }
    }

    // o pico é o tamanho do lote, não 1
    expect(picoDeCredito).toBeLessThanOrEqual(3)
    // e a alternância é perfeita: 10 lotes de 3, cinco para cada
    expect(recebidoPeriodo['ana']).toBe(15)
    expect(recebidoPeriodo['bia']).toBe(15)
  })
})
