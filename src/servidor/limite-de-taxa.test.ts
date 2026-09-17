import { afterEach, describe, expect, it, vi } from 'vitest'

import { chavesNoLimitador, esvaziarLimitador, TETO_DE_CHAVES, verificarLimite } from './limite-de-taxa'

/**
 * O limitador em memória (achado N-37: não havia teste nenhum, e o teto de
 * chaves não limitava — com mais de 1000 janelas ATIVAS o mapa crescia sem fim,
 * porque a limpeza só tirava as vencidas).
 */

afterEach(() => {
  esvaziarLimitador()
  vi.useRealTimers()
})

describe('limite por chave', () => {
  it('libera até o máximo, recusa depois, e reinicia com a janela', () => {
    vi.useFakeTimers()
    for (let vez = 1; vez <= 3; vez += 1) expect(verificarLimite('rota:ana', 3, 60).permitido).toBe(true)
    const recusa = verificarLimite('rota:ana', 3, 60)
    expect(recusa.permitido).toBe(false)
    expect(recusa.reiniciaEmSegundos).toBe(60)

    vi.advanceTimersByTime(60_000)
    expect(verificarLimite('rota:ana', 3, 60).permitido).toBe(true)
  })

  it('chaves diferentes não se misturam', () => {
    expect(verificarLimite('rota:ana', 1, 60).permitido).toBe(true)
    expect(verificarLimite('rota:bia', 1, 60).permitido).toBe(true)
    expect(verificarLimite('rota:ana', 1, 60).permitido).toBe(false)
  })
})

describe('N-37: o mapa tem teto de verdade', () => {
  it('com muito mais chaves ATIVAS que o teto, o mapa não passa do teto', () => {
    for (let indice = 0; indice < TETO_DE_CHAVES * 3; indice += 1) {
      verificarLimite(`inundacao:${indice}`, 5, 600)
    }
    expect(chavesNoLimitador('inundacao')).toBeLessThanOrEqual(TETO_DE_CHAVES)
  })

  it('inundar um compartimento não despeja a chave de outro (revisão de segurança do #70)', () => {
    // O limite de custo da IA nasce primeiro — num mapa único, seria o mais antigo.
    expect(verificarLimite('ingestao:ana', 1, 600).permitido).toBe(true)
    for (let indice = 0; indice < TETO_DE_CHAVES * 2; indice += 1) {
      verificarLimite(`distribuir:ana:2026-01-${indice}`, 10, 600)
    }

    expect(chavesNoLimitador('distribuir')).toBeLessThanOrEqual(TETO_DE_CHAVES)
    expect(verificarLimite('ingestao:ana', 1, 600).permitido).toBe(false)
  })

  it('as que saem são as mais antigas; a mais recente continua contando', () => {
    for (let indice = 0; indice < TETO_DE_CHAVES; indice += 1) verificarLimite(`ordem:antiga:${indice}`, 1, 600)
    verificarLimite('ordem:recente', 1, 600)
    for (let indice = 0; indice < 10; indice += 1) verificarLimite(`ordem:nova:${indice}`, 5, 600)

    // Máximo 1: se `ordem:antiga:0` ainda estivesse no mapa, a segunda chamada seria
    // recusada. Liberada, prova que a mais antiga foi despejada — sem isto, o
    // teste passaria com um `abrirEspaco` que não remove nada.
    expect(verificarLimite('ordem:antiga:0', 1, 600).permitido).toBe(true)
    expect(verificarLimite('ordem:recente', 1, 600).permitido).toBe(false)
  })
})
