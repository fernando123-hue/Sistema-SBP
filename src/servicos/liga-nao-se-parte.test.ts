import { beforeEach, describe, expect, it } from 'vitest'

import { hojeIso } from '../core/util/datas'
import { obterPrisma } from '../servidor/prisma'
import { atorDeTeste, limparTudo } from '../testes/apoio'
import { confirmar, planejarCategoria } from './distribuicao'

/**
 * A liga não se parte — nem no motor, nem na gravação (`A4`).
 *
 * ═══ O DEFEITO QUE ESTES TESTES FECHAM ═══
 *
 * O motor decidia certo: `alocarPorGrupos` entrega cada lote INTEIRO a alguém.
 * Quem gravava é que repartia os itens por POSIÇÃO — `itensIds.slice(cursor,
 * cursor + cota)` sobre uma lista ordenada por `criadoEm`. Com duas ligas cujos
 * e-mails chegaram intercalados, a fatia posicional cortava no meio de uma liga.
 *
 * E nada acusava: a soma continuava fechando, então a trava de conservação
 * passava; a rodada gravava a alocação correta EM NÚMERO; e a liga partida só
 * aparecia na mesa de quem atendia o associado.
 *
 * O teste que faltava era este — um que olhasse QUAIS itens, não quantos.
 */

const banco = obterPrisma()

async function semear() {
  const operador = await banco.colaborador.create({
    data: { nome: 'Operadora', email: 'op@teste.local', papel: 'operador' },
  })
  const ana = await banco.colaborador.create({
    data: { nome: 'Ana', email: 'ana@teste.local', papel: 'colaborador' },
  })
  const bruno = await banco.colaborador.create({
    data: { nome: 'Bruno', email: 'bruno@teste.local', papel: 'colaborador' },
  })

  const categoria = await banco.categoria.create({
    data: {
      codigo: 'LIGANTE',
      rotulo: 'Ligante',
      frente: 'CADASTRO',
      grupo: 'LIGA',
      // O que liga o `A4`.
      agrupaPorLiga: true,
      divisivel: true,
      // Baixo para o corte de "lote pequeno" não engolir o caso.
      limiarIndivisivel: 1,
    },
  })

  const ligaA = await banco.liga.create({ data: { nome: 'Liga Alfa' } })
  const ligaB = await banco.liga.create({ data: { nome: 'Liga Beta' } })

  // A data é HOJE, e não uma constante.
  //
  // Era `'2026-09-07'` fixo. Funcionou até a virada da meia-noite de 08/09/2026,
  // quando os cinco testes deste arquivo ficaram vermelhos de uma vez: os itens
  // nascem com `criadoEm` = agora, e `planejarCategoria` só recolhe item criado
  // ATÉ o fim do dia da rodada (`distribuicao.ts`, filtro por `limite`). Com a
  // data no passado, a rodada não encontra nada, e a conferência vê zero rodada.
  //
  // Um teste que passa hoje e falha amanhã sem ninguém tocar em nada é pior que
  // um teste ausente: ensina a equipe a desconfiar do vermelho.
  const data = hojeIso()
  for (const pessoa of [ana, bruno]) {
    await banco.habilitacao.create({
      data: { colaboradorId: pessoa.id, categoriaId: categoria.id, podeReceber: true },
    })
    await banco.escala.create({
      data: { data, colaboradorId: pessoa.id, disponivel: true },
    })
  }

  return { operador: atorDeTeste(operador.id, 'operador'), categoria, ligaA, ligaB, data, ana, bruno }
}

/**
 * Cria itens das duas ligas INTERCALADOS no tempo.
 *
 * É a forma exata do defeito: se as ligas chegassem em blocos contíguos, a
 * fatia posicional acertaria por acaso e o teste passaria com o código errado.
 */
async function criarItensIntercalados(
  categoriaId: string,
  ligaA: { id: string },
  ligaB: { id: string },
  porLiga: number,
): Promise<void> {
  let instante = new Date('2026-09-07T09:00:00.000Z').getTime()
  for (let i = 0; i < porLiga; i += 1) {
    for (const liga of [ligaA, ligaB]) {
      await banco.item.create({
        data: {
          categoriaId,
          titulo: `Ligante ${i} da liga ${liga.id.slice(-4)}`,
          status: 'aprovado',
          payload: '{}',
          ligaId: liga.id,
          criadoEm: new Date(instante),
        },
      })
      instante += 60_000
    }
  }
}

beforeEach(async () => {
  await limparTudo(banco)
})

describe('agrupamento por liga na GRAVAÇÃO', () => {
  it('cada pessoa recebe ligas inteiras, nunca pedaços de duas', async () => {
    const base = await semear()
    await criarItensIntercalados(base.categoria.id, base.ligaA, base.ligaB, 3)

    await confirmar(banco, { data: base.data, categorias: ['LIGANTE'] }, base.operador)

    const atribuicoes = await banco.atribuicao.findMany({
      where: { ativa: true },
      include: { item: { select: { ligaId: true } } },
    })
    expect(atribuicoes).toHaveLength(6)

    // Para cada pessoa, o conjunto de ligas que ela recebeu.
    const ligasPorPessoa = new Map<string, Set<string>>()
    for (const atribuicao of atribuicoes) {
      const ligas = ligasPorPessoa.get(atribuicao.colaboradorId) ?? new Set<string>()
      ligas.add(atribuicao.item.ligaId!)
      ligasPorPessoa.set(atribuicao.colaboradorId, ligas)
    }

    // E, para cada liga, o conjunto de pessoas que a receberam. ESTA é a
    // asserção do `A4`: uma liga, uma pessoa.
    const pessoasPorLiga = new Map<string, Set<string>>()
    for (const atribuicao of atribuicoes) {
      const pessoas = pessoasPorLiga.get(atribuicao.item.ligaId!) ?? new Set<string>()
      pessoas.add(atribuicao.colaboradorId)
      pessoasPorLiga.set(atribuicao.item.ligaId!, pessoas)
    }

    for (const [ligaId, pessoas] of pessoasPorLiga) {
      expect(
        pessoas.size,
        `a liga ${ligaId} foi partida entre ${pessoas.size} pessoas`,
      ).toBe(1)
    }
  })

  it('a soma continua fechando — o A4 não pode custar a conservação', async () => {
    const base = await semear()
    await criarItensIntercalados(base.categoria.id, base.ligaA, base.ligaB, 4)

    await confirmar(banco, { data: base.data, categorias: ['LIGANTE'] }, base.operador)

    const rodada = await banco.rodadaDistribuicao.findFirstOrThrow()
    const atribuicoes = await banco.atribuicao.count({ where: { ativa: true } })
    expect(atribuicoes).toBe(rodada.quantidadeEntrada)
    expect(atribuicoes).toBe(8)
  })

  it('a entrega concreta bate com a alocação que a rodada gravou', async () => {
    const base = await semear()
    await criarItensIntercalados(base.categoria.id, base.ligaA, base.ligaB, 3)

    await confirmar(banco, { data: base.data, categorias: ['LIGANTE'] }, base.operador)

    const rodada = await banco.rodadaDistribuicao.findFirstOrThrow()
    const alocacao = JSON.parse(rodada.alocacao) as Record<string, number>

    for (const [colaboradorId, cota] of Object.entries(alocacao)) {
      const recebidos = await banco.atribuicao.count({
        where: { colaboradorId, ativa: true },
      })
      // O snapshot promete reconstruir a decisão. Se a entrega divergisse dele,
      // a auditoria contaria uma história que não aconteceu.
      expect(recebidos, `alocação de ${colaboradorId} não bate com o gravado`).toBe(cota)
    }
  })

  it('o plano leva o vínculo de liga, não só a contagem', async () => {
    const base = await semear()
    await criarItensIntercalados(base.categoria.id, base.ligaA, base.ligaB, 2)

    const plano = await planejarCategoria(banco, {
      id: base.categoria.id,
      codigo: 'LIGANTE',
      rotulo: 'Ligante',
      frente: 'CADASTRO',
      grupo: 'LIGA',
      divisivel: true,
      peso: 1,
      limiarIndivisivel: 1,
      entraNoRateio: true,
      agrupaPorLiga: true,
    }, base.data)

    expect(plano).not.toBeNull()
    expect(plano!.itens).toHaveLength(4)
    // Sem isto, quem grava não tem como saber a que lote cada item pertence.
    expect(plano!.itens.every((item) => item.ligaId !== null)).toBe(true)
    expect(plano!.resultado!.criterio).toBe('por_grupo')
    expect(plano!.resultado!.atribuicaoDeGrupos).toBeDefined()
  })
})
