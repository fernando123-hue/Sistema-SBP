import { describe, expect, it } from 'vitest'

import { criarCategoria, criarElegivel } from '../testes/fabricas'
import type { GrupoIndivisivel } from '../tipos'
import { distribuir } from './motor'

/**
 * Agrupamento por liga (`A4`) — o segundo modo do motor.
 *
 * A regra: **a liga é a unidade que não se separa; o e-mail não é.** Todos os
 * ligantes de uma liga num mesmo dia vão inteiros para uma pessoa, ainda que
 * tenham chegado em e-mails diferentes (`A4.1`).
 *
 * O que estes testes protegem, em ordem:
 *   1. nenhuma liga é partida entre duas pessoas — é a garantia central;
 *   2. a conservação continua valendo (`Σ alocação == Q`), que é o invariante
 *      que o projeto descreve como sua razão de existir;
 *   3. o desequilíbrio do dia é INTENCIONAL e some no crédito;
 *   4. sem `grupos`, nada muda — nenhuma rodada existente é afetada.
 */

const LIGANTE = criarCategoria({ codigo: 'LIGANTE', agrupaPorLiga: true, limiarIndivisivel: 3 })

function rodar(grupos: GrupoIndivisivel[], creditos: [string, number][]) {
  const quantidade = grupos.reduce((soma, grupo) => soma + grupo.tamanho, 0)
  return distribuir({
    data: '2026-09-06',
    categoria: LIGANTE,
    quantidade,
    grupos,
    elegiveis: creditos.map(([id, credito]) =>
      criarElegivel(id, { creditoCategoria: credito, creditoGlobal: credito }),
    ),
  })
}

/** Quem ficou com cada grupo, deduzido da alocação. */
function totais(alocacao: Record<string, number>): number[] {
  return Object.values(alocacao).sort((a, b) => b - a)
}

describe('a liga não se separa — a garantia central do A4', () => {
  it('duas ligas do mesmo dia vão inteiras, para pessoas diferentes', () => {
    const rodada = rodar(
      [
        { chave: 'liga:cardio', tamanho: 30 },
        { chave: 'liga:pediatria', tamanho: 20 },
      ],
      [['ana', 0], ['bruno', 0]],
    )

    expect(rodada.criterio).toBe('por_grupo')
    // 30 e 20 inteiros — nunca 25/25, que é o que o resto-maior faria.
    expect(totais(rodada.alocacao)).toEqual([30, 20])
  })

  it('a maior liga é entregue primeiro', () => {
    // Empate de crédito: quem leva a maior é o primeiro da ordem estável.
    const rodada = rodar(
      [
        { chave: 'liga:pequena', tamanho: 5 },
        { chave: 'liga:grande', tamanho: 40 },
      ],
      [['ana', 0], ['bruno', 0]],
    )

    // Ana é a primeira da ordem com crédito empatado, então leva a de 40.
    expect(rodada.alocacao['ana']).toBe(40)
    expect(rodada.alocacao['bruno']).toBe(5)
  })

  it('a ordem NÃO depende de como os grupos chegaram', () => {
    const creditos: [string, number][] = [['ana', 0], ['bruno', 0], ['clara', 0]]
    const grupos = [
      { chave: 'liga:a', tamanho: 12 },
      { chave: 'liga:b', tamanho: 7 },
      { chave: 'liga:c', tamanho: 3 },
    ]

    const direto = rodar(grupos, creditos)
    const invertido = rodar([...grupos].reverse(), creditos)

    // Mesma entrada em ordem diferente tem de produzir a MESMA saída: sem isso
    // a rodada deixaria de ser reproduzível, e o snapshot de auditoria não
    // provaria mais nada.
    expect(invertido.alocacao).toEqual(direto.alocacao)
  })

  it('empate de tamanho desempata pela chave, não pela posição', () => {
    const a = rodar(
      [
        { chave: 'liga:aaa', tamanho: 10 },
        { chave: 'liga:zzz', tamanho: 10 },
      ],
      [['ana', 0], ['bruno', 0]],
    )
    const b = rodar(
      [
        { chave: 'liga:zzz', tamanho: 10 },
        { chave: 'liga:aaa', tamanho: 10 },
      ],
      [['ana', 0], ['bruno', 0]],
    )

    expect(a.alocacao).toEqual(b.alocacao)
  })
})

describe('conservação — o invariante que o projeto existe para garantir', () => {
  it('a soma distribuída bate com a entrada, com grupos desiguais', () => {
    const grupos = [
      { chave: 'liga:a', tamanho: 31 },
      { chave: 'liga:b', tamanho: 17 },
      { chave: 'liga:c', tamanho: 5 },
      { chave: 'liga:d', tamanho: 1 },
    ]
    const rodada = rodar(grupos, [['ana', 0], ['bruno', 2], ['clara', -1]])

    const soma = Object.values(rodada.alocacao).reduce((acc, valor) => acc + valor, 0)
    expect(soma).toBe(54)
    expect(rodada.quantidadeEntrada).toBe(54)
  })

  it('recusa quando a soma dos grupos não bate com a quantidade', () => {
    // Falhar aqui NOMEIA a causa. Sem esta checagem, a trava de conservação
    // pegaria o sintoma depois, já dentro da transação.
    expect(() =>
      distribuir({
        data: '2026-09-06',
        categoria: LIGANTE,
        quantidade: 50,
        grupos: [{ chave: 'liga:a', tamanho: 30 }],
        elegiveis: [criarElegivel('ana')],
      }),
    ).toThrow(/não bate com a quantidade/i)
  })

  it('recusa grupos com a mesma chave', () => {
    // Chave repetida significa o mesmo lote montado duas vezes: a soma poderia
    // bater e a liga seria partida entre duas pessoas — o que o A4 proíbe.
    expect(() =>
      distribuir({
        data: '2026-09-06',
        categoria: LIGANTE,
        quantidade: 20,
        grupos: [
          { chave: 'liga:a', tamanho: 10 },
          { chave: 'liga:a', tamanho: 10 },
        ],
        elegiveis: [criarElegivel('ana'), criarElegivel('bruno')],
      }),
    ).toThrow(/mesma chave/i)
  })

  it('recusa grupo de tamanho zero ou negativo', () => {
    expect(() =>
      distribuir({
        data: '2026-09-06',
        categoria: LIGANTE,
        quantidade: 10,
        grupos: [
          { chave: 'liga:a', tamanho: 10 },
          { chave: 'liga:b', tamanho: 0 },
        ],
        elegiveis: [criarElegivel('ana')],
      }),
    ).toThrow(/tamanho inválido/i)
  })
})

describe('o desequilíbrio do dia é intencional, e some no crédito', () => {
  it('quem leva a liga maior fica devedor na mesma proporção', () => {
    const rodada = rodar(
      [
        { chave: 'liga:grande', tamanho: 30 },
        { chave: 'liga:pequena', tamanho: 20 },
      ],
      [['ana', 0], ['bruno', 0]],
    )

    // Cota justa: 50 / 2 = 25. Quem levou 30 fica com −5; quem levou 20, +5.
    expect(rodada.cotaJusta).toBe(25)
    expect(rodada.creditoCategoriaDepois['ana']).toBe(-5)
    expect(rodada.creditoCategoriaDepois['bruno']).toBe(5)

    // A soma dos créditos continua zero: nada vaza do livro-razão.
    const soma =
      rodada.creditoCategoriaDepois['ana']! + rodada.creditoCategoriaDepois['bruno']!
    expect(soma).toBe(0)
  })

  it('no dia seguinte, quem ficou devendo recebe menos', () => {
    // Ana entra devendo 5 (levou a liga grande ontem); Bruno, credor de 5.
    const rodada = rodar(
      [
        { chave: 'liga:x', tamanho: 30 },
        { chave: 'liga:y', tamanho: 20 },
      ],
      [['ana', -5], ['bruno', 5]],
    )

    // Bruno está mais credor, então leva a MAIOR — o inverso de ontem. É assim
    // que o A4 equilibra: pelo crédito acumulado, não por afinidade fixa.
    expect(rodada.alocacao['bruno']).toBe(30)
    expect(rodada.alocacao['ana']).toBe(20)
  })

  it('recalcula a cada entrega — o mesmo credor não leva tudo', () => {
    // Três grupos iguais e três pessoas empatadas: uma por pessoa. Sem
    // recalcular depois de cada entrega, a primeira levaria as três.
    const rodada = rodar(
      [
        { chave: 'liga:a', tamanho: 10 },
        { chave: 'liga:b', tamanho: 10 },
        { chave: 'liga:c', tamanho: 10 },
      ],
      [['ana', 0], ['bruno', 0], ['clara', 0]],
    )

    expect(totais(rodada.alocacao)).toEqual([10, 10, 10])
  })
})

describe('o que NÃO muda', () => {
  it('sem grupos, a categoria que agrupa volta ao resto-maior', () => {
    const rodada = distribuir({
      data: '2026-09-06',
      categoria: LIGANTE,
      quantidade: 7,
      elegiveis: [criarElegivel('ana'), criarElegivel('bruno')],
    })

    expect(rodada.criterio).toBe('resto_maior')
    expect(totais(rodada.alocacao)).toEqual([4, 3])
  })

  it('categoria que não agrupa ignora os grupos', () => {
    const rodada = distribuir({
      data: '2026-09-06',
      categoria: criarCategoria({ codigo: 'DOC_CADASTRO', agrupaPorLiga: false }),
      quantidade: 50,
      grupos: [
        { chave: 'liga:a', tamanho: 30 },
        { chave: 'liga:b', tamanho: 20 },
      ],
      elegiveis: [criarElegivel('ana'), criarElegivel('bruno')],
    })

    // Reparte por igual: a liga só é indivisível onde a decisão diz que é.
    expect(rodada.criterio).toBe('resto_maior')
    expect(totais(rodada.alocacao)).toEqual([25, 25])
  })

  it('o corte de lote pequeno vem antes do agrupamento', () => {
    // `Q = 3` com limiar 3: vale a regra de sempre. O A4 PERMITE que ligas
    // diferentes vão para pessoas diferentes; não obriga.
    const rodada = rodar(
      [
        { chave: 'liga:a', tamanho: 2 },
        { chave: 'liga:b', tamanho: 1 },
      ],
      [['ana', 0], ['bruno', 0]],
    )

    expect(rodada.criterio).toBe('indivisivel')
    expect(rodada.alocacao['ana']).toBe(3)
  })

  it('uma liga só, com muita gente, vai inteira para uma pessoa', () => {
    const rodada = rodar([{ chave: 'liga:unica', tamanho: 40 }], [
      ['ana', 0],
      ['bruno', 0],
      ['clara', 0],
    ])

    expect(totais(rodada.alocacao)).toEqual([40, 0, 0])
  })
})
