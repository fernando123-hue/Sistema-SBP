import { describe, expect, it } from 'vitest'

import {
  aposChamada,
  DISJUNTOR_FECHADO,
  impedimentoParaChamar,
  LIMITES_PADRAO,
  type EstadoDoDisjuntor,
  type LimitesDeConsumo,
} from './consumo'

const LIMITES: LimitesDeConsumo = {
  tetoDiarioDeChamadas: 10,
  falhasParaAbrir: 3,
  minutosAberto: 5,
}

const AGORA = new Date('2026-09-18T14:00:00.000Z')

function impedimento(parcial: {
  estado?: EstadoDoDisjuntor
  chamadasHoje?: number
  agora?: Date
  limites?: LimitesDeConsumo
} = {}) {
  return impedimentoParaChamar({
    estado: parcial.estado ?? DISJUNTOR_FECHADO,
    chamadasHoje: parcial.chamadasHoje ?? 0,
    agora: parcial.agora ?? AGORA,
    limites: parcial.limites ?? LIMITES,
  })
}

describe('teto diário de chamadas', () => {
  it('abaixo do teto, a chamada passa', () => {
    expect(impedimento({ chamadasHoje: 9 })).toBeNull()
  })

  it('no teto, a chamada é impedida — o teto é o número de chamadas do dia, não o da próxima', () => {
    const barrado = impedimento({ chamadasHoje: 10 })
    expect(barrado?.motivo).toBe('teto_diario')
    expect(barrado?.mensagem).toContain('10')
  })

  it('acima do teto continua impedida (contagem pode saltar com duas sincronizações ao mesmo tempo)', () => {
    expect(impedimento({ chamadasHoje: 57 })?.motivo).toBe('teto_diario')
  })

  it('teto zero significa SEM teto, e é preciso dizer isso em algum lugar', () => {
    // Zero como "nenhuma chamada permitida" deixaria o sistema mudo por causa
    // de uma variável esquecida — o oposto de falhar alto.
    expect(impedimento({ chamadasHoje: 9_999, limites: { ...LIMITES, tetoDiarioDeChamadas: 0 } })).toBeNull()
  })
})

describe('disjuntor', () => {
  it('falha isolada não abre nada', () => {
    const estado = aposChamada(DISJUNTOR_FECHADO, 'falha', AGORA, LIMITES)
    expect(estado.falhasSeguidas).toBe(1)
    expect(estado.abertoAte).toBeNull()
    expect(impedimento({ estado })).toBeNull()
  })

  it('na enésima falha seguida, abre pelo tempo configurado', () => {
    let estado = DISJUNTOR_FECHADO
    for (let vez = 0; vez < 3; vez += 1) estado = aposChamada(estado, 'falha', AGORA, LIMITES)

    expect(estado.abertoAte).toEqual(new Date('2026-09-18T14:05:00.000Z'))
    const barrado = impedimento({ estado })
    expect(barrado?.motivo).toBe('disjuntor_aberto')
  })

  it('sucesso zera a contagem — só falha SEGUIDA conta', () => {
    let estado = aposChamada(DISJUNTOR_FECHADO, 'falha', AGORA, LIMITES)
    estado = aposChamada(estado, 'falha', AGORA, LIMITES)
    estado = aposChamada(estado, 'ok', AGORA, LIMITES)
    expect(estado.falhasSeguidas).toBe(0)
    estado = aposChamada(estado, 'falha', AGORA, LIMITES)
    expect(estado.abertoAte).toBeNull()
  })

  it('passado o tempo, uma chamada volta a ser permitida — é meia-abertura, não reinício', () => {
    let estado = DISJUNTOR_FECHADO
    for (let vez = 0; vez < 3; vez += 1) estado = aposChamada(estado, 'falha', AGORA, LIMITES)

    const depois = new Date('2026-09-18T14:05:01.000Z')
    expect(impedimento({ estado, agora: depois })).toBeNull()
  })

  it('a chamada de prova falhando fecha o disjuntor de novo, sem esperar outras N falhas', () => {
    let estado = DISJUNTOR_FECHADO
    for (let vez = 0; vez < 3; vez += 1) estado = aposChamada(estado, 'falha', AGORA, LIMITES)

    const depois = new Date('2026-09-18T14:05:01.000Z')
    const reaberto = aposChamada(estado, 'falha', depois, LIMITES)
    expect(reaberto.abertoAte).toEqual(new Date('2026-09-18T14:10:01.000Z'))
    expect(impedimento({ estado: reaberto, agora: depois })?.motivo).toBe('disjuntor_aberto')
  })

  it('a chamada de prova dando certo fecha o disjuntor de vez', () => {
    let estado = DISJUNTOR_FECHADO
    for (let vez = 0; vez < 3; vez += 1) estado = aposChamada(estado, 'falha', AGORA, LIMITES)

    const depois = new Date('2026-09-18T14:05:01.000Z')
    const curado = aposChamada(estado, 'ok', depois, LIMITES)
    expect(curado).toEqual(DISJUNTOR_FECHADO)
  })

  it('o estado nunca é mutado no lugar', () => {
    const antes = { ...DISJUNTOR_FECHADO }
    aposChamada(antes, 'falha', AGORA, LIMITES)
    expect(antes).toEqual(DISJUNTOR_FECHADO)
  })
})

describe('o teto tem precedência sobre o disjuntor na mensagem', () => {
  it('estourou o teto e o disjuntor está aberto: o motivo é o teto, que dura o dia todo', () => {
    let estado = DISJUNTOR_FECHADO
    for (let vez = 0; vez < 3; vez += 1) estado = aposChamada(estado, 'falha', AGORA, LIMITES)
    expect(impedimento({ estado, chamadasHoje: 10 })?.motivo).toBe('teto_diario')
  })
})

describe('LIMITES_PADRAO', () => {
  it('tem teto de verdade e disjuntor que abre antes de um lote inteiro fracassar', () => {
    // O lote de ingestão vai a 200 e-mails (`AT-35`): um disjuntor que só
    // abrisse depois de 200 falhas não seria disjuntor nenhum.
    expect(LIMITES_PADRAO.tetoDiarioDeChamadas).toBeGreaterThan(0)
    expect(LIMITES_PADRAO.falhasParaAbrir).toBeLessThan(20)
    expect(LIMITES_PADRAO.minutosAberto).toBeGreaterThan(0)
  })
})
