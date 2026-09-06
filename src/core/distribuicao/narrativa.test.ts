import { describe, expect, it } from 'vitest'

import { criarCategoria, criarElegivel } from '../testes/fabricas'
import type { ResultadoRodada } from '../tipos'
import { distribuir } from './motor'
import { narrarRodada } from './narrativa'

/**
 * Narrativa da rodada (`A6`).
 *
 * A decisão pede que o sistema deixe "um relatório legível do que fez, como fez
 * e por quê", com a regra de ouro junto: **o algoritmo decide; a narrativa só
 * descreve.**
 *
 * O que estes testes protegem é essa fronteira. A narrativa é montada a partir
 * do snapshot que `distribuir()` produziu — nunca de uma segunda conta —, então
 * os casos abaixo rodam o motor DE VERDADE e narram a saída dele. Se algum dia
 * a narrativa passar a calcular por conta própria, haverá duas fontes para o
 * mesmo número e a segunda vai divergir da primeira: é o `SUBTOTAL(109)` da
 * planilha reconstruído em forma de texto.
 */

const NOMES: Record<string, string> = { ana: 'Ana', bruno: 'Bruno', clara: 'Clara' }
const nomeDe = (id: string): string => NOMES[id] ?? id

function rodar(quantidade: number, creditos: [string, number][]): ResultadoRodada {
  return distribuir({
    data: '2026-09-06',
    categoria: criarCategoria(),
    quantidade,
    elegiveis: creditos.map(([id, credito]) =>
      criarElegivel(id, { creditoCategoria: credito, creditoGlobal: credito }),
    ),
  })
}

describe('narrarRodada', () => {
  it('conta o que entrou e com quantas pessoas', () => {
    const linhas = narrarRodada(rodar(7, [['ana', 0], ['bruno', 0]]), 'Ligante', nomeDe)

    expect(linhas[0]).toBe('Entraram 7 itens de Ligante, com 2 pessoas de plantão.')
  })

  it('concorda em número: um item, uma pessoa', () => {
    // `1 item` e `1 pessoa de plantão`, não `1 itens`. Texto que erra
    // concordância é lido como rascunho, e relatório lido como rascunho não é
    // usado para conferir nada.
    const linhas = narrarRodada(rodar(1, [['ana', 0]]), 'Ligante', nomeDe)

    expect(linhas[0]).toBe('Entraram 1 item de Ligante, com 1 pessoa de plantão.')
  })

  it('explica a sobra nomeando quem levou, e por quê', () => {
    // 7 para 2 pessoas: base 3, resto 1. Bruno está mais credor, então leva.
    const rodada = rodar(7, [['ana', 0], ['bruno', 2]])
    const linhas = narrarRodada(rodada, 'Ligante', nomeDe)

    expect(rodada.base).toBe(3)
    expect(rodada.resto).toBe(1)
    expect(linhas).toContain('Cada uma levou 3 itens.')
    expect(linhas.join(' ')).toContain(
      '1 item ficou de sobra, e foi para Bruno — quem estava mais credor no início da rodada.',
    )
  })

  it('lista as pessoas com "e" quando a sobra é de mais de uma', () => {
    // 8 para 3: base 2, resto 2 — os dois primeiros da ordem.
    const rodada = rodar(8, [['ana', 0], ['bruno', 5], ['clara', 3]])
    const linhas = narrarRodada(rodada, 'Ligante', nomeDe)

    expect(rodada.resto).toBe(2)
    expect(linhas.join(' ')).toContain('2 itens ficaram de sobra, e foram para Bruno e Clara')
  })

  it('diz por que o lote pequeno foi inteiro para uma pessoa', () => {
    const rodada = rodar(3, [['ana', 0], ['bruno', 1]])
    const linhas = narrarRodada(rodada, 'Ligante', nomeDe)

    expect(rodada.criterio).toBe('indivisivel')
    expect(linhas.join(' ')).toContain('O lote foi inteiro para Bruno')
    expect(linhas.join(' ')).toContain('dividir volume baixo custa mais atenção do que equilibra')
  })

  it('mostra o crédito que decidiu a ordem, na ordem em que decidiu', () => {
    const linhas = narrarRodada(
      rodar(9, [['ana', 0], ['bruno', 4], ['clara', 2]]),
      'Ligante',
      nomeDe,
    )
    const ordem = linhas.find((linha) => linha.startsWith('A ordem saiu'))!

    // Do mais credor ao menos: Bruno (4) · Clara (2) · Ana (0).
    expect(ordem).toContain('Bruno (4)')
    expect(ordem.indexOf('Bruno')).toBeLessThan(ordem.indexOf('Clara'))
    expect(ordem.indexOf('Clara')).toBeLessThan(ordem.indexOf('Ana'))
  })

  it('registra o dia sem demanda em vez de calar', () => {
    const linhas = narrarRodada(rodar(0, [['ana', 0]]), 'Ligante', nomeDe)

    expect(linhas[0]).toBe('Nada entrou em Ligante neste dia.')
    expect(linhas.join(' ')).toContain(
      'dia sem trabalho e dia sem registro não podem ser a mesma coisa',
    )
  })

  it('não inventa número nenhum: tudo que ela diz sai do snapshot', () => {
    const rodada = rodar(9, [['ana', 0], ['bruno', 4], ['clara', 2]])
    const texto = narrarRodada(rodada, 'Ligante', nomeDe).join(' ')

    // Cada número citado tem de existir no resultado do motor. É a fronteira
    // que o A6 exige: a narrativa descreve, não recalcula.
    expect(texto).toContain(String(rodada.quantidadeEntrada))
    expect(texto).toContain(String(rodada.base))
    expect(texto).toContain(rodada.cotaJusta.toLocaleString('pt-BR', { maximumFractionDigits: 2 }))
  })

  it('cai no id quando o nome não vier, em vez de sumir com a pessoa', () => {
    const linhas = narrarRodada(rodar(7, [['ana', 0], ['zed', 3]]), 'Ligante', nomeDe)

    expect(linhas.join(' ')).toContain('zed')
  })
})
