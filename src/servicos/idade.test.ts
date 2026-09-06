import { beforeEach, describe, expect, it } from 'vitest'

import { diasEntre } from '../core/util/datas'
import { obterPrisma } from '../servidor/prisma'
import { DATA_BASE, limparTudo, semearBase } from '../testes/apoio'
import { minhaFila } from './fila'
import { registrarManual } from './itens'
import { porCategoria } from './painel'

/**
 * Prioridade por idade (`A7`).
 *
 * A decisão do dono do negócio: o setor de cadastro **não tem tarefa com
 * prazo** — não existe item que "não pode esperar". Mas os mais antigos têm
 * prioridade, para impedir que backlog envelheça escondido e vire sobrecarga.
 *
 * Duas metades. A distribuição já escolhia por chegada; faltavam:
 *   1. a fila individual, que ordenava por `atribuidoEm` — a idade da
 *      ATRIBUIÇÃO, não a do trabalho;
 *   2. um indicador que tornasse o envelhecimento visível no painel.
 *
 * O caso que separa as duas idades é o item devolvido: ele volta ao pool, é
 * redistribuído hoje, e por `atribuidoEm` apareceria como o mais novo da fila.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

/** Envelhece um item no banco, que é a única forma de simular passagem de tempo. */
async function envelhecer(itemId: string, dias: number): Promise<void> {
  const quando = new Date(`${DATA_BASE}T12:00:00.000Z`)
  quando.setUTCDate(quando.getUTCDate() - dias)
  await banco.item.update({ where: { id: itemId }, data: { criadoEm: quando } })
}

describe('diasEntre', () => {
  it('conta dias de calendário, não períodos de 24h', () => {
    expect(diasEntre('2026-09-01', '2026-09-06')).toBe(5)
    expect(diasEntre('2026-09-06', '2026-09-06')).toBe(0)
  })

  it('atravessa virada de mês e de ano sem depender do fuso do servidor', () => {
    expect(diasEntre('2026-08-30', '2026-09-02')).toBe(3)
    expect(diasEntre('2025-12-30', '2026-01-02')).toBe(3)
  })
})

describe('A7 — Minha Fila mostra o mais antigo primeiro', () => {
  it('ordena pela idade do ITEM, não pela da atribuição', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 1 })
    const pessoa = base.colaboradores[0]!

    // Três itens de exceção: nascem já atribuídos, sem passar pelo motor, o que
    // deixa o teste falar só sobre ordenação.
    const antigo = await registrarManual(
      banco,
      { categoriaCodigo: 'INADIMP', titulo: 'Parado há três semanas', colaboradorId: pessoa.id },
      base.operador,
    )
    const meio = await registrarManual(
      banco,
      { categoriaCodigo: 'INADIMP', titulo: 'Parado há uma semana', colaboradorId: pessoa.id },
      base.operador,
    )
    const novo = await registrarManual(
      banco,
      { categoriaCodigo: 'INADIMP', titulo: 'Chegou hoje', colaboradorId: pessoa.id },
      base.operador,
    )

    // Envelhecidos DEPOIS de criados, e em ordem inversa à de criação: assim a
    // ordem correta não pode sair por acaso de `criadoEm` coincidir com a
    // ordem de inserção nem com `atribuidoEm`.
    await envelhecer(antigo.itensCriados[0]!, 21)
    await envelhecer(meio.itensCriados[0]!, 7)

    const fila = await minhaFila(banco, pessoa.id, pessoa.ator)

    expect(fila.map((item) => item.titulo)).toEqual([
      'Parado há três semanas',
      'Parado há uma semana',
      'Chegou hoje',
    ])
    expect(fila[0]!.itemId).toBe(antigo.itensCriados[0]!)
    expect(novo.itensCriados).toContain(fila[2]!.itemId)
  })

  it('expõe a data pela qual ordena, para a ordem não parecer arbitrária', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 1 })
    const pessoa = base.colaboradores[0]!

    const feito = await registrarManual(
      banco,
      { categoriaCodigo: 'ISENTO', titulo: 'Isento', colaboradorId: pessoa.id },
      base.operador,
    )
    await envelhecer(feito.itensCriados[0]!, 10)

    const fila = await minhaFila(banco, pessoa.id, pessoa.ator)

    expect(fila).toHaveLength(1)
    // `criadoEm` é anterior a `atribuidoEm`: são grandezas diferentes, e é
    // justamente por isso que a fila precisa mandar as duas.
    expect(fila[0]!.criadoEm.getTime()).toBeLessThan(fila[0]!.atribuidoEm.getTime())
  })
})

describe('A7 — indicador de atraso no painel', () => {
  it('mostra há quantos dias o item aberto mais antigo está parado', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 1 })
    const pessoa = base.colaboradores[0]!

    const feito = await registrarManual(
      banco,
      { categoriaCodigo: 'INADIMP', titulo: 'Parado', colaboradorId: pessoa.id },
      base.operador,
    )
    await envelhecer(feito.itensCriados[0]!, 12)

    const linhas = await porCategoria(banco)
    const inadimp = linhas.find((linha) => linha.categoriaCodigo === 'INADIMP')!

    expect(inadimp.diasDoMaisAntigo).toBe(12)
  })

  it('é nulo quando não há nada aberto — ausência de fila não é atraso zero', async () => {
    await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 1 })

    const linhas = await porCategoria(banco)

    for (const linha of linhas) {
      expect(linha.diasDoMaisAntigo).toBeNull()
    }
  })

  it('ignora o recorte de período: o item de março aparece para quem olha setembro', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 1 })
    const pessoa = base.colaboradores[0]!

    const feito = await registrarManual(
      banco,
      { categoriaCodigo: 'INADIMP', titulo: 'Esquecido', colaboradorId: pessoa.id },
      base.operador,
    )
    await envelhecer(feito.itensCriados[0]!, 200)

    // Período estreito, que NÃO contém o item: mesmo assim o atraso aparece.
    // É o ponto do indicador — recorte de mês esconderia exatamente o que ele
    // existe para revelar.
    const linhas = await porCategoria(banco, { de: DATA_BASE, ate: DATA_BASE })
    const inadimp = linhas.find((linha) => linha.categoriaCodigo === 'INADIMP')!

    expect(inadimp.entrouNoPeriodo).toBe(0)
    expect(inadimp.diasDoMaisAntigo).toBe(200)
  })

  it('para de contar quando o item fecha', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 1 })
    const pessoa = base.colaboradores[0]!

    const feito = await registrarManual(
      banco,
      { categoriaCodigo: 'INADIMP', titulo: 'Vai fechar', colaboradorId: pessoa.id },
      base.operador,
    )
    const itemId = feito.itensCriados[0]!
    await envelhecer(itemId, 30)

    const antes = await porCategoria(banco)
    expect(antes.find((linha) => linha.categoriaCodigo === 'INADIMP')!.diasDoMaisAntigo).toBe(30)

    const { concluir } = await import('./fila')
    await concluir(banco, { itemId }, pessoa.ator)

    const depois = await porCategoria(banco)
    expect(depois.find((linha) => linha.categoriaCodigo === 'INADIMP')!.diasDoMaisAntigo).toBeNull()
  })
})
