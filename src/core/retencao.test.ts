import { describe, expect, it } from 'vitest'

import { TipoDeAfastamentoGravadoSchema } from './esquemas'
import {
  PRAZO_PADRAO_EM_DIAS,
  diaEmQueOMotivoVence,
  exigirPrazoValido,
  motivoVenceu,
  tipoDepoisDoPrazo,
} from './retencao'

/**
 * A fronteira do dia é onde o defeito de retenção mora: um dia a menos apaga o
 * motivo de quem a gestora ainda precisa acompanhar; um dia a mais guarda dado
 * de saúde além do que o dono decidiu (`A17`). Por isso cada caso abaixo fixa
 * a véspera E o dia.
 */

describe('quando o motivo de um afastamento vence', () => {
  it('férias de 01 a 10/09, prazo de 7 dias: volta em 11/09, vence em 18/09', () => {
    const ferias = { fim: '2026-09-10', canceladoNoDia: null }

    expect(diaEmQueOMotivoVence(ferias, 7)).toBe('2026-09-18')
    expect(motivoVenceu(ferias, '2026-09-17', 7)).toBe(false)
    expect(motivoVenceu(ferias, '2026-09-18', 7)).toBe(true)
  })

  it('falta de um dia só (fim igual ao início) conta da manhã seguinte', () => {
    const falta = { fim: '2026-09-01', canceladoNoDia: null }

    expect(diaEmQueOMotivoVence(falta, 7)).toBe('2026-09-09')
  })

  it('prazo de 1 dia: o motivo sai no dia seguinte à volta, não no dia da volta', () => {
    const atestado = { fim: '2026-09-10', canceladoNoDia: null }

    expect(motivoVenceu(atestado, '2026-09-11', 1)).toBe(false)
    expect(motivoVenceu(atestado, '2026-09-12', 1)).toBe(true)
  })

  it('sem data de volta, o relógio não corre — por mais antiga que seja a saída', () => {
    const licenca = { fim: null, canceladoNoDia: null }

    expect(diaEmQueOMotivoVence(licenca, 7)).toBeNull()
    expect(motivoVenceu(licenca, '2030-01-01', 7)).toBe(false)
  })

  it('cancelado conta do cancelamento, mesmo com o fim registrado no futuro', () => {
    const feriasAdiadas = { fim: '2026-12-20', canceladoNoDia: '2026-09-05' }

    expect(diaEmQueOMotivoVence(feriasAdiadas, 7)).toBe('2026-09-12')
    expect(motivoVenceu(feriasAdiadas, '2026-09-11', 7)).toBe(false)
    expect(motivoVenceu(feriasAdiadas, '2026-09-12', 7)).toBe(true)
  })

  it('cancelado sem data de volta também conta do cancelamento', () => {
    expect(diaEmQueOMotivoVence({ fim: null, canceladoNoDia: '2026-09-05' }, 7)).toBe('2026-09-12')
  })

  it('atravessa virada de mês e de ano sem depender de fuso', () => {
    expect(diaEmQueOMotivoVence({ fim: '2026-12-28', canceladoNoDia: null }, 7)).toBe('2027-01-05')
  })
})

describe('o que sobra do tipo', () => {
  it('férias continua férias; todo o resto vira o mesmo ausente', () => {
    const reduzidos = TipoDeAfastamentoGravadoSchema.options.map((tipo) => [tipo, tipoDepoisDoPrazo(tipo)])

    expect(Object.fromEntries(reduzidos)).toEqual({
      ferias: 'ferias',
      falta: 'ausente',
      atestado: 'ausente',
      licenca: 'ausente',
      outro: 'ausente',
      ausente: 'ausente',
    })
  })
})

describe('prazo inválido é recusado antes de qualquer conta', () => {
  it.each([0, -30, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 3651])('recusa %s', (dias) => {
    expect(() => exigirPrazoValido(dias)).toThrow(/Prazo de retenção inválido/)
    expect(() => diaEmQueOMotivoVence({ fim: '2026-09-10', canceladoNoDia: null }, dias)).toThrow(
      /Prazo de retenção inválido/,
    )
  })

  it.each([1, 7, 3650])('aceita %s', (dias) => {
    expect(() => exigirPrazoValido(dias)).not.toThrow()
  })

  it('o padrão decidido em A17 é 7 dias', () => {
    expect(PRAZO_PADRAO_EM_DIAS.motivo_de_afastamento).toBe(7)
  })
})
