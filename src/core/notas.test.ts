import { describe, expect, it } from 'vitest'

import {
  LIMITE_DE_NOTAS_EXIBIDAS,
  selecionarNotas,
  type NotaSelecionavel,
} from './notas'

/**
 * Seleção de notas do setor.
 *
 * O que estes testes protegem não é a ordenação em si — é a promessa de que a
 * memória aparece no lugar CERTO. Uma nota que surge no contexto errado é pior
 * que nota nenhuma: a pessoa aprende a ignorar o bloco inteiro, e aí toda a
 * funcionalidade morre sem que nada acuse.
 *
 * Estes testes valem duas vezes. Hoje eles cobrem o que a tela mostra; no dia
 * em que a decisão do dono liberar a memória para o modelo (`DECISOES.md § H.4`,
 * item 14), eles passam a cobrir o que entra no prompt — sem uma linha de
 * mudança, porque a função é a mesma.
 */

const INSTANTE = new Date('2026-09-01T12:00:00.000Z')

function nota(parcial: Partial<NotaSelecionavel> & { id: string }): NotaSelecionavel {
  return {
    texto: `nota ${parcial.id}`,
    categoriaId: null,
    ligaId: null,
    criadoEm: INSTANTE,
    arquivadaEm: null,
    ...parcial,
  }
}

describe('vínculo que não bate elimina a nota', () => {
  it('nota de outra liga não vaza para a liga em que se está trabalhando', () => {
    const notas = [
      nota({ id: 'a', ligaId: 'liga-1' }),
      nota({ id: 'b', ligaId: 'liga-2' }),
    ]

    const escolhidas = selecionarNotas(notas, { ligaId: 'liga-1' })

    expect(escolhidas.map((linha) => linha.id)).toEqual(['a'])
  })

  it('nota de outra categoria não vaza para a categoria em que se está trabalhando', () => {
    const notas = [
      nota({ id: 'a', categoriaId: 'cat-1' }),
      nota({ id: 'b', categoriaId: 'cat-2' }),
    ]

    const escolhidas = selecionarNotas(notas, { categoriaId: 'cat-2' })

    expect(escolhidas.map((linha) => linha.id)).toEqual(['b'])
  })

  it('sem contexto nenhum, nota vinculada não aparece — só a geral', () => {
    const notas = [
      nota({ id: 'vinculada', categoriaId: 'cat-1' }),
      nota({ id: 'geral' }),
    ]

    const escolhidas = selecionarNotas(notas, {})

    expect(escolhidas.map((linha) => linha.id)).toEqual(['geral'])
  })
})

describe('nota geral vale em todo contexto', () => {
  it('aparece junto com a nota da categoria, nunca no lugar dela', () => {
    const notas = [nota({ id: 'geral' }), nota({ id: 'da-categoria', categoriaId: 'cat-1' })]

    const escolhidas = selecionarNotas(notas, { categoriaId: 'cat-1' })

    // As duas entram: `null` no vínculo significa "vale para o setor inteiro",
    // nunca "não sei a que se refere". Descartar a geral quando há contexto
    // esconderia justamente o aviso que vale para tudo.
    expect(escolhidas.map((linha) => linha.id)).toEqual(['da-categoria', 'geral'])
  })
})

describe('ordem: da mais específica para a mais geral', () => {
  it('liga vem antes de categoria, que vem antes de geral', () => {
    const notas = [
      nota({ id: 'geral' }),
      nota({ id: 'categoria', categoriaId: 'cat-1' }),
      nota({ id: 'liga', ligaId: 'liga-1' }),
    ]

    const escolhidas = selecionarNotas(notas, { categoriaId: 'cat-1', ligaId: 'liga-1' })

    expect(escolhidas.map((linha) => linha.id)).toEqual(['liga', 'categoria', 'geral'])
  })

  it('no mesmo peso, a mais recente ganha — o setor corrige o que aprendeu antes', () => {
    const notas = [
      nota({ id: 'antiga', categoriaId: 'cat-1', criadoEm: new Date('2026-01-01T00:00:00Z') }),
      nota({ id: 'nova', categoriaId: 'cat-1', criadoEm: new Date('2026-08-01T00:00:00Z') }),
    ]

    const escolhidas = selecionarNotas(notas, { categoriaId: 'cat-1' })

    expect(escolhidas.map((linha) => linha.id)).toEqual(['nova', 'antiga'])
  })

  it('empate exato de instante desempata por id — a saída é determinística', () => {
    // Sem isto, duas notas gravadas no mesmo instante poderiam sair em ordens
    // diferentes entre dois carregamentos idênticos da mesma tela. Ninguém
    // confia num painel que muda de conteúdo sozinho.
    const notas = [
      nota({ id: 'zz', categoriaId: 'cat-1' }),
      nota({ id: 'aa', categoriaId: 'cat-1' }),
    ]

    const primeira = selecionarNotas(notas, { categoriaId: 'cat-1' })
    const segunda = selecionarNotas([...notas].reverse(), { categoriaId: 'cat-1' })

    expect(primeira.map((linha) => linha.id)).toEqual(['aa', 'zz'])
    expect(segunda.map((linha) => linha.id)).toEqual(primeira.map((linha) => linha.id))
  })
})

describe('arquivada não orienta ninguém', () => {
  it('sai da seleção mesmo com o vínculo batendo', () => {
    const notas = [
      nota({ id: 'viva', categoriaId: 'cat-1' }),
      nota({ id: 'arquivada', categoriaId: 'cat-1', arquivadaEm: INSTANTE }),
    ]

    const escolhidas = selecionarNotas(notas, { categoriaId: 'cat-1' })

    expect(escolhidas.map((linha) => linha.id)).toEqual(['viva'])
  })
})

describe('teto', () => {
  it('corta no limite, mantendo as mais específicas', () => {
    const notas = [
      ...Array.from({ length: 8 }, (_, indice) => nota({ id: `geral-${indice}` })),
      nota({ id: 'liga', ligaId: 'liga-1' }),
    ]

    const escolhidas = selecionarNotas(notas, { ligaId: 'liga-1' })

    expect(escolhidas).toHaveLength(LIMITE_DE_NOTAS_EXIBIDAS)
    expect(escolhidas[0]!.id).toBe('liga')
  })

  it('limite zero devolve vazio, e limite negativo não estoura', () => {
    const notas = [nota({ id: 'a' })]

    expect(selecionarNotas(notas, {}, 0)).toEqual([])
    expect(selecionarNotas(notas, {}, -3)).toEqual([])
  })
})

describe('não muda a entrada', () => {
  it('a lista recebida sai na mesma ordem em que entrou', () => {
    // A função ordena uma cópia pontuada, nunca o array do chamador. Se
    // ordenasse no lugar, o serviço que a chama duas vezes com a mesma lista
    // veria a segunda chamada operar sobre dados já rearranjados.
    const notas = [
      nota({ id: 'b', categoriaId: 'cat-1' }),
      nota({ id: 'a', categoriaId: 'cat-1' }),
    ]
    const ordemOriginal = notas.map((linha) => linha.id)

    selecionarNotas(notas, { categoriaId: 'cat-1' })

    expect(notas.map((linha) => linha.id)).toEqual(ordemOriginal)
  })
})
