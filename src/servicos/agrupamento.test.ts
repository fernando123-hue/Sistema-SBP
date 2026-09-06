import { beforeEach, describe, expect, it } from 'vitest'

import { chaveDaLiga } from '../core/ligas'
import { obterPrisma } from '../servidor/prisma'
import { DATA_BASE, limparTudo, semearBase } from '../testes/apoio'
import { confirmar, previa } from './distribuicao'

/**
 * Agrupamento por liga, ponta a ponta (`A4` e `A4.1`).
 *
 * O teste do motor (`core/distribuicao/agrupamento.test.ts`) prova a
 * matemática. Aqui se prova a parte que só existe contra banco:
 *
 *   1. a unidade é `(liga, DIA)`, não `(liga, e-mail)` — dois e-mails da mesma
 *      liga no mesmo dia vão para a MESMA pessoa (decisão `A4.1`);
 *   2. entre DIAS não há vínculo — a liga não fica presa a ninguém;
 *   3. item sem liga continua sendo unidade de um.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

/**
 * Cria itens de LIGANTE já aprovados, ligados a uma liga (ou sem nenhuma).
 *
 * Vai direto ao banco de propósito: o caminho da IA já tem testes próprios, e
 * o que importa aqui é o agrupamento, não a extração.
 */
async function semearLigantes(
  nomeDaLiga: string | null,
  quantidade: number,
  criadoEm = new Date(`${DATA_BASE}T12:00:00.000Z`),
): Promise<void> {
  const categoria = await banco.categoria.findFirstOrThrow({ where: { codigo: 'LIGANTE' } })

  const ligaId =
    nomeDaLiga === null
      ? null
      : (
          (await banco.liga.findFirst({ where: { nome: nomeDaLiga } })) ??
          (await banco.liga.create({ data: { nome: nomeDaLiga } }))
        ).id

  for (let i = 0; i < quantidade; i += 1) {
    await banco.item.create({
      data: {
        categoriaId: categoria.id,
        ligaId,
        titulo: `${nomeDaLiga ?? 'sem liga'} ${i + 1}`,
        status: 'aprovado',
        confianca: 1,
        criadoEm,
      },
    })
  }
}

describe('chaveDaLiga — identidade por nome normalizado (AT-10)', () => {
  it('junta o que é só diferença de digitação', () => {
    const esperada = 'liga de cardiologia'
    expect(chaveDaLiga('Liga de Cardiologia')).toBe(esperada)
    expect(chaveDaLiga('  liga  de   cardiologia  ')).toBe(esperada)
    expect(chaveDaLiga('LIGA DE CARDIOLOGIA.')).toBe(esperada)
    expect(chaveDaLiga('Liga-de-Cardiologia')).toBe(esperada)
  })

  it('remove acento — a mesma palavra digitada de dois jeitos', () => {
    expect(chaveDaLiga('Liga de Pediatria Acadêmica')).toBe(chaveDaLiga('liga de pediatria academica'))
  })

  it('NÃO adivinha que nomes diferentes são a mesma liga', () => {
    // Este é o ponto do AT-10. Unir por semelhança entregaria o trabalho de
    // uma liga como se fosse de outra, e ninguém descobriria.
    expect(chaveDaLiga('Liga de Cardiologia da UFMG')).not.toBe(chaveDaLiga('Liga Cardio UFMG'))
  })

  it('texto sem letra nenhuma não identifica liga', () => {
    expect(chaveDaLiga('   ')).toBeNull()
    expect(chaveDaLiga('---')).toBeNull()
    expect(chaveDaLiga(null)).toBeNull()
  })
})

describe('A4.1 — a unidade é (liga, dia), não (liga, e-mail)', () => {
  it('a mesma liga em DOIS e-mails do mesmo dia vai para UMA pessoa', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 2 })

    // Dois lotes da mesma liga, criados separadamente — é o que dois e-mails
    // do mesmo dia produzem. Mais uma liga menor, para haver o que repartir.
    await semearLigantes('Liga de Cardiologia', 12)
    await semearLigantes('Liga de Cardiologia', 8)
    await semearLigantes('Liga de Pediatria', 9)

    const plano = await previa(banco, { data: DATA_BASE, categorias: ['LIGANTE'] }, base.operador)
    const rodada = plano.planos[0]!.resultado!

    expect(rodada.criterio).toBe('por_grupo')

    // Cardiologia = 12 + 8 = 20 numa pessoa só; Pediatria = 9 na outra.
    // Se a unidade fosse o e-mail, sairiam três grupos (12, 9, 8) e a
    // cardiologia poderia rachar entre duas pessoas.
    const quantias = Object.values(rodada.alocacao).sort((a, b) => b - a)
    expect(quantias).toEqual([20, 9])
  })

  it('entre DIAS a liga não fica presa a ninguém', async () => {
    const base = await semearBase(banco, { totalDeDias: 2, pessoasDePlantao: 2 })
    const [hoje, amanha] = base.datas as [string, string]

    await semearLigantes('Liga de Cardiologia', 30, new Date(`${hoje}T12:00:00.000Z`))
    await semearLigantes('Liga de Pediatria', 10, new Date(`${hoje}T12:00:00.000Z`))
    await confirmar(banco, { data: hoje, categorias: ['LIGANTE'] }, base.operador)

    const primeiroDia = await banco.atribuicao.findMany({
      where: { ativa: true },
      include: { item: { select: { ligaId: true } } },
    })
    const donoDaCardio = primeiroDia.find(
      (atribuicao) => atribuicao.item.ligaId !== null,
    )!.colaboradorId

    // Amanhã, a mesma liga de novo — sozinha, para não haver escolha de tamanho.
    await semearLigantes('Liga de Cardiologia', 10, new Date(`${amanha}T12:00:00.000Z`))
    await confirmar(banco, { data: amanha, categorias: ['LIGANTE'] }, base.operador)

    const doSegundoDia = await banco.atribuicao.findMany({
      where: { ativa: true, item: { criadoEm: { gte: new Date(`${amanha}T00:00:00.000Z`) } } },
      select: { colaboradorId: true },
    })

    // Quem levou 30 ontem ficou devendo; hoje a liga vai para a OUTRA pessoa.
    // É exatamente o que o A4 pede: sem afinidade fixa entre dias.
    expect(doSegundoDia.length).toBeGreaterThan(0)
    for (const atribuicao of doSegundoDia) {
      expect(atribuicao.colaboradorId).not.toBe(donoDaCardio)
    }
  })

  it('item sem liga é unidade de um, e não gruda em ninguém', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 2 })

    await semearLigantes(null, 6)

    const plano = await previa(banco, { data: DATA_BASE, categorias: ['LIGANTE'] }, base.operador)
    const rodada = plano.planos[0]!.resultado!

    // Seis grupos de um: reparte por igual, como o resto-maior faria.
    expect(Object.values(rodada.alocacao).sort((a, b) => b - a)).toEqual([3, 3])
  })

  it('a conservação continua fechando com liga grande e desequilíbrio real', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 3 })

    await semearLigantes('Liga Grande', 31)
    await semearLigantes('Liga Média', 12)
    await semearLigantes(null, 4)

    await confirmar(banco, { data: DATA_BASE, categorias: ['LIGANTE'] }, base.operador)

    const distribuidos = await banco.atribuicao.count({ where: { ativa: true } })
    expect(distribuidos).toBe(47)

    const rodada = await banco.rodadaDistribuicao.findFirstOrThrow()
    expect(rodada.quantidadeEntrada).toBe(47)
    expect(rodada.criterio).toBe('por_grupo')
  })
})
