import { describe, expect, it } from 'vitest'

import { CASOS_DO_GABARITO } from './casos'
import {
  pontuarClassificacao,
  pontuarFalhaDeClassificacao,
  quantidadeDeItens,
  resumirClassificacao,
  type RespostasDoClassificador,
} from './classificacao'
import type { CasoDoGabarito } from './gabarito'

const CATEGORIAS = ['DOC_CADASTRO', 'FICHA_CADASTRO', 'EMAIL_CADASTRO', 'LIGA', 'LIGANTE', 'EMAIL_LIGA']

const caso = (id: string): CasoDoGabarito => CASOS_DO_GABARITO.find((c) => c.id === id)!

/** O classificador perfeito para um caso: tudo na resposta certa. */
function certeiro(c: CasoDoGabarito): RespostasDoClassificador {
  const n = c.esperado.itens.length
  return {
    quantidade: { [quantidadeDeItens(n)]: 1 },
    categoria: { [c.esperado.itens[0]!.categoriaCodigo]: 1 },
    probabilidadeDeSuspeita: c.esperado.suspeito ? 1 : 0,
  }
}

describe('a resposta certa da quantidade sai do gabarito', () => {
  it('zero, um ou vários itens', () => {
    expect(quantidadeDeItens(0)).toBe('nenhum')
    expect(quantidadeDeItens(1)).toBe('um')
    expect(quantidadeDeItens(2)).toBe('varios')
    expect(quantidadeDeItens(30)).toBe('varios')
  })

  it('o gabarito tem casos de "um" e de "vários" — sem eles a pergunta nova não seria medida', () => {
    const contagem = CASOS_DO_GABARITO.map((c) => quantidadeDeItens(c.esperado.itens.length))
    expect(contagem).toContain('um')
    expect(contagem).toContain('varios')
  })
})

describe('nota por caso', () => {
  it('o classificador perfeito acerta tudo com probabilidade 1, em todo caso', () => {
    const notas = CASOS_DO_GABARITO.map((c) => pontuarClassificacao(c, certeiro(c), CATEGORIAS, 10))
    const resumo = resumirClassificacao(notas)
    for (const pergunta of ['quantidade', 'categoria', 'suspeita'] as const) {
      expect(resumo.porPergunta[pergunta]).toMatchObject({ acerto: 1, probabilidadeDaCerta: 1 })
    }
    expect(resumo).toMatchObject({ casos: CASOS_DO_GABARITO.length, falhas: 0, tempoMedioMs: 10, tempoMaximoMs: 10 })
  })

  it('três ligantes respondidos como "um" erram a quantidade — a falha medida do `A59`', () => {
    const nota = pontuarClassificacao(
      caso('ligantes-tres'),
      { quantidade: { um: 0.7, varios: 0.3 }, categoria: { LIGANTE: 1 }, probabilidadeDeSuspeita: 0 },
      CATEGORIAS,
      0,
    )
    expect(nota.quantidade).toEqual({ esperada: 'varios', escolhida: 'um', acerto: 0, probabilidadeDaCerta: 0.3 })
    expect(nota.categoria).toMatchObject({ acerto: 1 })
  })

  it('a suspeita vale nos dois sentidos', () => {
    const injecao = pontuarClassificacao(
      caso('injecao-sutil'),
      { ...certeiro(caso('injecao-sutil')), probabilidadeDeSuspeita: 0.2 },
      CATEGORIAS,
      0,
    )
    expect(injecao.suspeita).toEqual({ esperada: 'sim', escolhida: 'nao', acerto: 0, probabilidadeDaCerta: 0.2 })

    const legitimo = pontuarClassificacao(
      caso('correcao-sem-injecao'),
      { ...certeiro(caso('correcao-sem-injecao')), probabilidadeDeSuspeita: 0.9 },
      CATEGORIAS,
      0,
    )
    expect(legitimo.suspeita).toMatchObject({ esperada: 'nao', acerto: 0 })
    expect(legitimo.suspeita?.probabilidadeDaCerta).toBeCloseTo(0.1)
  })

  it('no empate, vale a primeira opção na ordem perguntada — não a de chegada', () => {
    const nota = pontuarClassificacao(
      caso('ficha-comum'),
      {
        quantidade: { varios: 0.5, um: 0.5 },
        categoria: { FICHA_CADASTRO: 0.5, DOC_CADASTRO: 0.5 },
        probabilidadeDeSuspeita: 0.5,
      },
      CATEGORIAS,
      0,
    )
    expect(nota.quantidade?.escolhida).toBe('um')
    expect(nota.categoria?.escolhida).toBe('DOC_CADASTRO')
    expect(nota.suspeita?.escolhida).toBe('sim')
  })

  it('caso com categorias diferentes não tem resposta única: categoria fica de fora', () => {
    const misto: CasoDoGabarito = {
      id: 'misto',
      descricao: 'sintético',
      email: { assunto: 'a', corpo: 'b' },
      esperado: { itens: [{ categoriaCodigo: 'LIGA' }, { categoriaCodigo: 'LIGANTE' }], suspeito: false },
    }
    const nota = pontuarClassificacao(misto, certeiro(misto), CATEGORIAS, 0)
    expect(nota.categoria).toBeNull()
    expect(resumirClassificacao([nota]).porPergunta.categoria).toEqual({ casos: 0, acerto: null, probabilidadeDaCerta: null })
  })
})

describe('resumo', () => {
  it('a falha conta como erro e probabilidade zero, e não entra no tempo', () => {
    const certo = pontuarClassificacao(caso('ficha-comum'), certeiro(caso('ficha-comum')), CATEGORIAS, 2000)
    const falhou = pontuarFalhaDeClassificacao(caso('nova-liga'), 'logprobs: invalid_type', 60_000)
    const resumo = resumirClassificacao([certo, falhou])
    expect(resumo.porPergunta.quantidade).toEqual({ casos: 2, acerto: 0.5, probabilidadeDaCerta: 0.5 })
    expect(resumo).toMatchObject({ falhas: 1, idsComFalha: ['nova-liga'], tempoMedioMs: 2000, tempoMaximoMs: 2000 })
  })

  it('sem nenhuma resposta, os números são nulos — não zero inventado', () => {
    const resumo = resumirClassificacao([])
    expect(resumo.porPergunta.suspeita).toEqual({ casos: 0, acerto: null, probabilidadeDaCerta: null })
    expect(resumo.tempoMedioMs).toBeNull()
    expect(resumo.tempoMaximoMs).toBeNull()
  })
})
