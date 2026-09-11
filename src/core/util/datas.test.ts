import { describe, expect, it } from 'vitest'

import {
  deslocarDias,
  diasEntre,
  fimDoDia,
  inicioDoDia,
  inicioDoMes,
  paraDataIso,
  sequenciaDeDatas,
} from './datas'

/**
 * A chave de data de `Escala`, `SaldoCarga` e `RodadaDistribuicao`.
 *
 * O comentário de `datas.ts` registra o defeito que já aconteceu: com
 * `toISOString()`, a partir das 21h o sistema achava que era o dia seguinte. Até
 * aqui nenhum teste chamava estas funções com um instante fixo — a correção
 * estava protegida só pelo comentário. Todos os valores abaixo são literais: um
 * teste que calcula o esperado com a mesma função que testa não prova nada.
 */

describe('fuso da operação', () => {
  it('22h30 em Brasília ainda é o mesmo dia, embora já seja o seguinte em UTC', () => {
    expect(paraDataIso(new Date('2026-09-07T01:30:00.000Z'))).toBe('2026-09-06')
  })

  it('meia-noite em Brasília já é o dia novo', () => {
    expect(paraDataIso(new Date('2026-09-07T03:00:00.000Z'))).toBe('2026-09-07')
    expect(paraDataIso(new Date('2026-09-07T02:59:59.999Z'))).toBe('2026-09-06')
  })

  it('o dia começa e termina no fuso da operação, não em UTC', () => {
    expect(inicioDoDia('2026-09-07').toISOString()).toBe('2026-09-07T03:00:00.000Z')
    expect(fimDoDia('2026-09-07').toISOString()).toBe('2026-09-08T02:59:59.999Z')
  })

  it('as duas pontas do dia pertencem ao próprio dia', () => {
    expect(paraDataIso(inicioDoDia('2026-09-07'))).toBe('2026-09-07')
    expect(paraDataIso(fimDoDia('2026-09-07'))).toBe('2026-09-07')
  })
})

describe('aritmética sobre a chave', () => {
  it('inicioDoMes devolve o dia 1 do mesmo mês', () => {
    expect(inicioDoMes('2026-09-17')).toBe('2026-09-01')
  })

  it.each([
    ['2026-03-01', -1, '2026-02-28'],
    ['2024-03-01', -1, '2024-02-29'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-09-07', 0, '2026-09-07'],
  ] as const)('deslocarDias(%s, %i) = %s', (data, dias, esperado) => {
    expect(deslocarDias(data, dias)).toBe(esperado)
  })

  it('sequenciaDeDatas atravessa a virada de mês', () => {
    expect(sequenciaDeDatas('2026-02-27', 3)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01'])
  })

  it.each([
    ['2026-09-07', '2026-09-07', 0],
    ['2026-02-28', '2026-03-01', 1],
    ['2026-09-08', '2026-09-07', -1],
    ['2026-01-01', '2027-01-01', 365],
  ] as const)('diasEntre(%s, %s) = %i dias de calendário', (inicio, fim, esperado) => {
    expect(diasEntre(inicio, fim)).toBe(esperado)
  })
})
