import { describe, expect, it } from 'vitest'

import {
  CategoriaForaDoRateioError,
  ElegiveisInvalidosError,
  QuantidadeInvalidaError,
  SemElegiveisError,
} from '../erros'
import { criarCategoria, criarElegivel } from '../testes/fabricas'
import { somar } from '../util/numero'
import { ALGORITMO_VERSAO, distribuir } from './motor'

const DATA = '2026-08-12'

describe('validação de entrada', () => {
  it('lança erro explícito quando não há nenhum elegível', () => {
    expect(() =>
      distribuir({ data: DATA, categoria: criarCategoria(), quantidade: 10, elegiveis: [] }),
    ).toThrow(SemElegiveisError)
  })

  it('recusa quantidade fracionária — item não vira fração para facilitar conta', () => {
    expect(() =>
      distribuir({
        data: DATA,
        categoria: criarCategoria(),
        quantidade: 23.5,
        elegiveis: [criarElegivel('ana'), criarElegivel('bia')],
      }),
    ).toThrow(QuantidadeInvalidaError)
  })

  it('recusa quantidade negativa', () => {
    expect(() =>
      distribuir({
        data: DATA,
        categoria: criarCategoria(),
        quantidade: -1,
        elegiveis: [criarElegivel('ana')],
      }),
    ).toThrow(QuantidadeInvalidaError)
  })

  it('recusa colaborador duplicado na lista de elegíveis', () => {
    expect(() =>
      distribuir({
        data: DATA,
        categoria: criarCategoria(),
        quantidade: 10,
        elegiveis: [criarElegivel('ana'), criarElegivel('ana')],
      }),
    ).toThrow(ElegiveisInvalidosError)
  })

  it('recusa categoria fora do rateio diário (INADIMP. / ISENTO)', () => {
    expect(() =>
      distribuir({
        data: DATA,
        categoria: criarCategoria({ codigo: 'INADIMP', entraNoRateio: false }),
        quantidade: 11,
        elegiveis: [criarElegivel('ana')],
      }),
    ).toThrow(CategoriaForaDoRateioError)
  })
})

describe('casos de borda', () => {
  it('Q = 0 registra a rodada com alocação zerada e crédito intacto', () => {
    const resultado = distribuir({
      data: DATA,
      categoria: criarCategoria(),
      quantidade: 0,
      elegiveis: [criarElegivel('ana', { creditoCategoria: 0.5 }), criarElegivel('bia')],
    })

    expect(resultado.criterio).toBe('sem_demanda')
    expect(resultado.alocacao).toEqual({ ana: 0, bia: 0 })
    expect(resultado.cotaJusta).toBe(0)
    expect(resultado.creditoCategoriaDepois).toEqual(resultado.creditoCategoriaAntes)
  })

  it('um único elegível recebe tudo e fica com crédito zero', () => {
    const resultado = distribuir({
      data: DATA,
      categoria: criarCategoria(),
      quantidade: 40,
      elegiveis: [criarElegivel('ana')],
    })

    expect(resultado.alocacao).toEqual({ ana: 40 })
    expect(resultado.creditoCategoriaDepois['ana']).toBe(0)
  })

  it('Q = 1 com 2 pessoas vai inteiro para quem está mais credor', () => {
    const resultado = distribuir({
      data: DATA,
      categoria: criarCategoria(),
      quantidade: 1,
      elegiveis: [criarElegivel('ana'), criarElegivel('bia', { creditoCategoria: 0.5 })],
    })

    expect(resultado.alocacao).toEqual({ ana: 0, bia: 1 })
    expect(somar(Object.values(resultado.alocacao))).toBe(1)
  })

  it('categoria indivisível entrega 100% sem rateio (RN-07)', () => {
    const resultado = distribuir({
      data: DATA,
      categoria: criarCategoria({ divisivel: false }),
      quantidade: 30,
      elegiveis: [criarElegivel('ana', { creditoCategoria: 2 }), criarElegivel('bia')],
    })

    expect(resultado.criterio).toBe('indivisivel')
    expect(resultado.alocacao).toEqual({ ana: 30, bia: 0 })
  })
})

describe('casos canônicos lidos da planilha', () => {
  // CAD-AGOSTO, dia 12: e-mail = 47, J = 2.
  // Na planilha: Mov.Dia 23,5 / 23,5 + correção manual −0,5 / +0,5 → 23 + 24.
  // Aqui sai direto, sem correção humana.
  it('47 ÷ 2 → 24 + 23, sem passar por 23,5', () => {
    const resultado = distribuir({
      data: DATA,
      categoria: criarCategoria({ codigo: 'EMAIL_CADASTRO' }),
      quantidade: 47,
      elegiveis: [criarElegivel('paulo'), criarElegivel('solange')],
    })

    expect(resultado.base).toBe(23)
    expect(resultado.resto).toBe(1)
    expect(somar(Object.values(resultado.alocacao))).toBe(47)
    expect(Object.values(resultado.alocacao).sort()).toEqual([23, 24])
  })

  // O exemplo do briefing: 15 ÷ 2 nunca pode virar 7+7 nem 8+8.
  it('15 ÷ 2 → 8 + 7, jamais 14 nem 16', () => {
    const resultado = distribuir({
      data: DATA,
      categoria: criarCategoria(),
      quantidade: 15,
      elegiveis: [criarElegivel('ana'), criarElegivel('bia')],
    })

    expect(resultado.alocacao).toEqual({ ana: 8, bia: 7 })
    expect(somar(Object.values(resultado.alocacao))).toBe(15)
  })

  // CAD-AGOSTO, dia 12, FICHA = 3, J = 2: Paulo levou 3, Solange 0.
  // Este é o caso que expõe o off-by-one do documento original — ver DECISOES.md § C1.
  // Com `Q < 3` o motor devolveria 2+1 e não reproduziria a operação real.
  it('FICHA = 3 com 2 pessoas vai inteiro para uma só (limiar `Q <= 3`)', () => {
    const resultado = distribuir({
      data: DATA,
      categoria: criarCategoria({ codigo: 'FICHA_CADASTRO', limiarIndivisivel: 3 }),
      quantidade: 3,
      elegiveis: [criarElegivel('paulo'), criarElegivel('solange')],
    })

    expect(resultado.criterio).toBe('indivisivel')
    expect(resultado.alocacao).toEqual({ paulo: 3, solange: 0 })
  })

  it('acima do limiar volta a fragmentar', () => {
    const resultado = distribuir({
      data: DATA,
      categoria: criarCategoria({ limiarIndivisivel: 3 }),
      quantidade: 4,
      elegiveis: [criarElegivel('paulo'), criarElegivel('solange')],
    })

    expect(resultado.criterio).toBe('resto_maior')
    expect(resultado.alocacao).toEqual({ paulo: 2, solange: 2 })
  })
})

describe('balanceamento por crédito — o que a planilha não tem', () => {
  it('a sobra vai para quem está mais credor, não para uma posição fixa', () => {
    const resultado = distribuir({
      data: DATA,
      categoria: criarCategoria(),
      quantidade: 15,
      elegiveis: [
        criarElegivel('ana', { creditoCategoria: -0.5 }),
        criarElegivel('bia', { creditoCategoria: 0.5 }),
      ],
    })

    expect(resultado.alocacao).toEqual({ ana: 7, bia: 8 })
  })

  it('crédito de categoria vence crédito global (decisão A2)', () => {
    const resultado = distribuir({
      data: DATA,
      categoria: criarCategoria(),
      quantidade: 15,
      elegiveis: [
        // ana está muito mais leve no total, mas bia é credora NESTA categoria
        criarElegivel('ana', { creditoCategoria: 0, creditoGlobal: 40 }),
        criarElegivel('bia', { creditoCategoria: 0.5, creditoGlobal: -40 }),
      ],
    })

    expect(resultado.ordemDesempate[0]).toBe('bia')
    expect(resultado.alocacao['bia']).toBe(8)
  })

  it('crédito global desempata quando o crédito da categoria empata', () => {
    const resultado = distribuir({
      data: DATA,
      categoria: criarCategoria(),
      quantidade: 15,
      elegiveis: [
        criarElegivel('ana', { creditoGlobal: -2 }),
        criarElegivel('bia', { creditoGlobal: 2 }),
      ],
    })

    expect(resultado.ordemDesempate[0]).toBe('bia')
  })

  it('dois dias seguidos de 15 ÷ 2 zeram o crédito — a alternância ±0,5 formalizada', () => {
    const categoria = criarCategoria()

    const dia1 = distribuir({
      data: '2026-08-10',
      categoria,
      quantidade: 15,
      elegiveis: [criarElegivel('ana'), criarElegivel('bia')],
    })

    expect(dia1.alocacao).toEqual({ ana: 8, bia: 7 })
    expect(dia1.creditoCategoriaDepois).toEqual({ ana: -0.5, bia: 0.5 })

    const dia2 = distribuir({
      data: '2026-08-11',
      categoria,
      quantidade: 15,
      elegiveis: [
        criarElegivel('ana', { creditoCategoria: dia1.creditoCategoriaDepois['ana']! }),
        criarElegivel('bia', { creditoCategoria: dia1.creditoCategoriaDepois['bia']! }),
      ],
    })

    expect(dia2.alocacao).toEqual({ ana: 7, bia: 8 })
    expect(dia2.creditoCategoriaDepois).toEqual({ ana: 0, bia: 0 })

    const acumuladoAna = dia1.alocacao['ana']! + dia2.alocacao['ana']!
    const acumuladoBia = dia1.alocacao['bia']! + dia2.alocacao['bia']!
    expect(acumuladoAna).toBe(15)
    expect(acumuladoBia).toBe(15)
  })

  it('a soma dos créditos permanece zero — nenhum trabalho é criado nem destruído', () => {
    const resultado = distribuir({
      data: DATA,
      categoria: criarCategoria(),
      quantidade: 100,
      elegiveis: [criarElegivel('ana'), criarElegivel('bia'), criarElegivel('cris')],
    })

    const deltas = Object.keys(resultado.alocacao).map(
      (id) => resultado.creditoCategoriaDepois[id]! - resultado.creditoCategoriaAntes[id]!,
    )
    expect(Math.abs(somar(deltas))).toBeLessThan(1e-9)
  })
})

describe('auditoria', () => {
  it('a rodada carrega tudo que é preciso para reconstruir a decisão', () => {
    const resultado = distribuir({
      data: DATA,
      categoria: criarCategoria(),
      quantidade: 47,
      elegiveis: [criarElegivel('ana'), criarElegivel('bia'), criarElegivel('cris')],
    })

    expect(resultado.algoritmoVersao).toBe(ALGORITMO_VERSAO)
    expect(resultado.ordemDesempate).toHaveLength(3)
    expect(resultado.base).toBe(15)
    expect(resultado.resto).toBe(2)
    expect(resultado.criterio).toBe('resto_maior')
    expect(Object.keys(resultado.creditoCategoriaAntes)).toHaveLength(3)
    expect(Object.keys(resultado.creditoCategoriaDepois)).toHaveLength(3)
  })

  it('é determinístico — mesma entrada, mesma saída', () => {
    const entrada = {
      data: DATA,
      categoria: criarCategoria(),
      quantidade: 53,
      elegiveis: [
        criarElegivel('ana', { creditoCategoria: 0.25 }),
        criarElegivel('bia', { creditoCategoria: 0.25 }),
        criarElegivel('cris', { creditoCategoria: -0.5 }),
      ],
    }

    expect(distribuir(entrada)).toEqual(distribuir(entrada))
  })
})
