import { beforeEach, describe, expect, it, vi } from 'vitest'

import { sequenciaDeDatas } from '../core/util/datas'
import { IaMock } from '../adapters/ia-mock'
import { IngestaoMock } from '../adapters/ingestao-mock'
import { obterPrisma } from '../servidor/prisma'
import { DATA_BASE, aprovarTudoNoBanco, limparTudo, semearBase } from '../testes/apoio'
import { sincronizar } from './ingestao'

/**
 * Conservação no caminho de ESCRITA.
 *
 * ═══ O BURACO QUE ESTE ARQUIVO FECHA ═══
 *
 * A conservação era testada em três lugares, e nenhum deles gravava:
 * `pipeline.test.ts` roda 30 dias que dão certo, `conservacao-nao-e-ruido.test.ts`
 * confere o painel DEPOIS do fato, e `distribuicao-falhas.test.ts` mocka o motor
 * mas exercita a `previa`, que não abre transação.
 *
 * As duas travas de dentro de `gravarRodada` — a que compara a fatia concreta
 * com a cota decidida, e a que compara o total gravado com a quantidade de
 * entrada — nunca tinham sido disparadas por teste nenhum. E o que elas
 * protegem não é o número: é a promessa de que uma rodada ou entra INTEIRA ou
 * não entra. Sem prova, alguém que envolvesse `gravarRodada` num `try/catch`
 * (ou movesse a chamada para fora do `$transaction`) deixaria metade da rodada
 * gravada — itens `distribuido`, `SaldoCarga` incrementado, e nenhuma
 * `RodadaDistribuicao` que os explique — com a suíte inteira verde.
 *
 * O invariante nº 3 do `CLAUDE.md` é a razão declarada de o sistema existir. A
 * planilha erra isso em 29% dos dias.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
  vi.restoreAllMocks()
})

async function prepararDia() {
  const base = await semearBase(banco, { totalDeDias: 1 })
  const datas = sequenciaDeDatas(DATA_BASE, 1)
  await sincronizar(
    { banco, ingestao: new IngestaoMock({ datas, semente: 5 }), ia: new IaMock() },
    base.operador,
  )
  await aprovarTudoNoBanco(banco)
  return { base, data: datas[0]! }
}

/** O que existe no banco depois da tentativa. Zero em tudo é o esperado. */
async function oQueFicouGravado() {
  const [rodadas, atribuicoes, saldos, saldosGlobais, distribuidos] = await Promise.all([
    banco.rodadaDistribuicao.count(),
    banco.atribuicao.count(),
    banco.saldoCarga.count(),
    banco.saldoCargaGlobal.count(),
    banco.item.count({ where: { status: 'distribuido' } }),
  ])
  return { rodadas, atribuicoes, saldos, saldosGlobais, distribuidos }
}

describe('conservação na gravação', () => {
  it('cota maior que a entrega concreta aborta a transação inteira', async () => {
    const { base, data } = await prepararDia()

    const motor = await import('../core/distribuicao/motor')
    const distribuirDeVerdade = motor.distribuir

    // Uma pessoa recebe UM item a mais do que existe para entregar. É o defeito
    // que a primeira trava de `gravarRodada` procura: a decisão do motor e a
    // fatia concreta deixaram de bater.
    vi.spyOn(motor, 'distribuir').mockImplementation((entrada) => {
      const resultado = distribuirDeVerdade(entrada)
      const primeiro = Object.keys(resultado.alocacao)[0]
      if (!primeiro) return resultado
      return {
        ...resultado,
        alocacao: { ...resultado.alocacao, [primeiro]: (resultado.alocacao[primeiro] ?? 0) + 1 },
      }
    })

    const { confirmar } = await import('./distribuicao')

    await expect(confirmar(banco, { data, categorias: [] }, base.operador)).rejects.toThrow(
      /Conservação violada/i,
    )

    // NADA pode ter sobrado. Meia rodada gravada é pior que rodada nenhuma:
    // os itens sairiam da fila sem uma rodada que explique para onde foram.
    expect(await oQueFicouGravado()).toEqual({
      rodadas: 0,
      atribuicoes: 0,
      saldos: 0,
      saldosGlobais: 0,
      distribuidos: 0,
    })
  })

  it('alocação que não soma a entrada aborta antes do commit', async () => {
    const { base, data } = await prepararDia()

    const motor = await import('../core/distribuicao/motor')
    const distribuirDeVerdade = motor.distribuir

    // Some com a alocação de uma pessoa: a soma passa a ser menor que a
    // quantidade de entrada. É a segunda trava — a que conta os itens que
    // realmente foram gravados, não a aritmética do motor.
    vi.spyOn(motor, 'distribuir').mockImplementation((entrada) => {
      const resultado = distribuirDeVerdade(entrada)
      const nomes = Object.keys(resultado.alocacao)
      if (nomes.length < 2) return resultado
      const alocacao = { ...resultado.alocacao }
      alocacao[nomes[0]!] = 0
      return { ...resultado, alocacao }
    })

    const { confirmar } = await import('./distribuicao')

    await expect(confirmar(banco, { data, categorias: [] }, base.operador)).rejects.toThrow(
      /Conservação violada/i,
    )

    expect(await oQueFicouGravado()).toEqual({
      rodadas: 0,
      atribuicoes: 0,
      saldos: 0,
      saldosGlobais: 0,
      distribuidos: 0,
    })
  })

  it('sem sabotagem, a mesma rodada grava e os itens saem da fila', async () => {
    // O par de controle: sem ele, os dois testes acima passariam mesmo se
    // `confirmar` estivesse quebrado por qualquer outro motivo.
    const { base, data } = await prepararDia()

    const { confirmar } = await import('./distribuicao')
    await confirmar(banco, { data, categorias: [] }, base.operador)

    const gravado = await oQueFicouGravado()
    expect(gravado.rodadas).toBeGreaterThan(0)
    expect(gravado.atribuicoes).toBeGreaterThan(0)
    expect(gravado.distribuidos).toBeGreaterThan(0)
  })
})
