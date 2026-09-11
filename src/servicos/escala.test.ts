import { beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'

import { IaMock } from '../adapters/ia-mock'
import { IngestaoMock } from '../adapters/ingestao-mock'
import { sequenciaDeDatas } from '../core/util/datas'
import { PermissaoNegadaError } from '../servidor/ator'
import { obterPrisma } from '../servidor/prisma'
import { DATA_BASE, aprovarTudoNoBanco, limparTudo, semearBase } from '../testes/apoio'
import { previa } from './distribuicao'
import { definirEscala } from './escala'
import { sincronizar } from './ingestao'

/**
 * `definirEscala` — a porta que decide quem recebe trabalho no dia.
 *
 * Achado 10 da auditoria de 08/09/2026: nenhum teste a chamava. A checagem de
 * papel, o upsert, a auditoria e a trava `z.literal(1)` da capacidade estavam
 * todos sem prova. O cenário que isso deixava aberto: alguém troca o literal por
 * `z.number().min(0).max(2)` para "liberar meio período", esquece que o motor
 * não lê o campo, e a pessoa marcada com 0,5 recebe a cota cheia — o defeito do
 * `Mov. Extra` da planilha, de volta, com a suíte verde.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
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

/** Quem apareceu como elegível em alguma categoria da prévia. */
async function elegiveisDaPrevia(
  base: Awaited<ReturnType<typeof semearBase>>,
  data: string,
): Promise<Set<string>> {
  const relatorio = await previa(banco, { data, categorias: [] }, base.operador)
  const comResultado = relatorio.planos.filter((plano) => plano.resultado)
  // Prévia sem nenhuma rodada provaria ausência de todo mundo, não de uma pessoa.
  expect(comResultado.length).toBeGreaterThan(0)
  return new Set(
    comResultado.flatMap((plano) => plano.resultado!.elegiveis.map((e) => e.colaboradorId)),
  )
}

describe('definirEscala', () => {
  it('colaborador não define escala — nem a própria', async () => {
    const { colaboradores, datas } = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = colaboradores[0]!

    await expect(
      definirEscala(banco, { data: datas[0], colaboradorId: pessoa.id, disponivel: false }, pessoa.ator),
    ).rejects.toBeInstanceOf(PermissaoNegadaError)

    const escala = await banco.escala.findUnique({
      where: { data_colaboradorId: { data: datas[0]!, colaboradorId: pessoa.id } },
    })
    expect(escala?.disponivel).toBe(true)
  })

  it.each([0.5, 0, 2])(
    'capacidade %s é recusada enquanto o motor não a lê',
    async (capacidadeRelativa) => {
      const { operador, colaboradores, datas } = await semearBase(banco, { totalDeDias: 1 })

      await expect(
        definirEscala(
          banco,
          { data: datas[0], colaboradorId: colaboradores[0]!.id, disponivel: true, capacidadeRelativa },
          operador,
        ),
      ).rejects.toBeInstanceOf(ZodError)

      expect(await banco.logAuditoria.count({ where: { acao: 'escala_definida' } })).toBe(0)
    },
  )

  it('redefinir o mesmo dia sobrescreve a linha e deixa antes e depois na trilha', async () => {
    const { operador, operadorId, colaboradores, datas } = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = colaboradores[0]!
    const data = datas[0]!

    const linhas = await definirEscala(
      banco,
      { data, colaboradorId: pessoa.id, disponivel: false },
      operador,
    )
    await definirEscala(banco, { data, colaboradorId: pessoa.id, disponivel: true }, operador)

    expect(linhas.find((linha) => linha.colaboradorId === pessoa.id)?.disponivel).toBe(false)
    expect(await banco.escala.count({ where: { data, colaboradorId: pessoa.id } })).toBe(1)

    const trilha = await banco.logAuditoria.findMany({
      where: { entidade: 'Escala', entidadeId: `${data}:${pessoa.id}`, acao: 'escala_definida' },
    })
    // Sem ordenar por `timestamp`: as duas escritas cabem no mesmo milissegundo.
    // O conteúdo de cada linha já diz qual veio primeiro.
    const registros = trilha.map((linha) => ({
      antes: JSON.parse(linha.antes ?? 'null'),
      depois: JSON.parse(linha.depois ?? 'null'),
      usuario: linha.usuario,
    }))
    expect(registros).toHaveLength(2)
    expect(registros).toEqual(
      expect.arrayContaining([
        { antes: { disponivel: true }, depois: { disponivel: false }, usuario: operadorId },
        { antes: { disponivel: false }, depois: { disponivel: true }, usuario: operadorId },
      ]),
    )
  })

  it('quem a escala tira do plantão sai do rateio do dia', async () => {
    const { base, data } = await prepararDia()
    const pessoa = base.colaboradores[0]!

    // O par de controle: a mesma pessoa, antes, estava lá.
    expect((await elegiveisDaPrevia(base, data)).has(pessoa.id)).toBe(true)

    await definirEscala(banco, { data, colaboradorId: pessoa.id, disponivel: false }, base.operador)

    const depois = await elegiveisDaPrevia(base, data)
    expect(depois.has(pessoa.id)).toBe(false)
    expect(depois.has(base.colaboradores[1]!.id)).toBe(true)
  })

  it('sem linha de escala para o dia, a pessoa não entra no rateio', async () => {
    // O padrão é conservador de propósito: distribuir para quem não está
    // trabalhando é o defeito que a planilha corrige à mão com `Mov. Extra`.
    const { base, data } = await prepararDia()
    const pessoa = base.colaboradores[0]!

    await banco.escala.deleteMany({ where: { data, colaboradorId: pessoa.id } })

    expect((await elegiveisDaPrevia(base, data)).has(pessoa.id)).toBe(false)
  })
})
