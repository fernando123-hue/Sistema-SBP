import { beforeEach, describe, expect, it } from 'vitest'

import { obterPrisma } from '../servidor/prisma'
import { limparTudo, semearBase } from '../testes/apoio'
import { listarCaixa } from './caixa'
import { listar } from './ligas'
import { arquivar, registrar } from './notas'

/**
 * Ligas na tela.
 *
 * A liga governa o rateio de `LIGANTE` e `EMAIL_LIGA` desde o `A4` e, até
 * 07/09/2026, não aparecia em tela nenhuma — decidia a distribuição sem nunca
 * ser vista por quem opera. A consequência prática apareceu na entrega das
 * notas: o vínculo de nota com liga existia no banco, na API e nos testes, e
 * não havia como criá-lo pela interface porque não havia como escolher a liga.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

async function ligaDeTeste(nome: string, instituicao: string | null = null) {
  return (
    (await banco.liga.findFirst({ where: { nome, instituicao } })) ??
    (await banco.liga.create({ data: { nome, instituicao } }))
  )
}

describe('listagem', () => {
  it('ordena por nome, não por movimento — quem escolhe procura pelo nome que leu', async () => {
    await ligaDeTeste('Liga Zeta Sintética')
    await ligaDeTeste('Liga Alfa Sintética')

    const listadas = await listar(banco)
    const nomes = listadas.map((liga) => liga.nome)

    expect(nomes.indexOf('Liga Alfa Sintética')).toBeLessThan(nomes.indexOf('Liga Zeta Sintética'))
  })

  it('liga inativa não entra na escolha', async () => {
    const liga = await ligaDeTeste('Liga Encerrada Sintética')
    await banco.liga.update({ where: { id: liga.id }, data: { status: 'encerrada' } })

    expect((await listar(banco)).map((linha) => linha.id)).not.toContain(liga.id)
  })

  it('conta os itens da liga', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const liga = await ligaDeTeste('Liga Com Itens Sintética')
    const categoria = await banco.categoria.findFirstOrThrow({ where: { codigo: 'LIGANTE' } })

    for (let indice = 0; indice < 3; indice += 1) {
      await banco.item.create({
        data: {
          categoriaId: categoria.id,
          ligaId: liga.id,
          titulo: `Ligante sintético ${indice + 1}`,
          status: 'aprovado',
          confianca: 1,
        },
      })
    }

    const encontrada = (await listar(banco)).find((linha) => linha.id === liga.id)
    expect(encontrada?.itens).toBe(3)
    expect(base.operadorId).toBeTruthy()
  })

  it('conta só as notas VIVAS — arquivada não orienta ninguém', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!
    const liga = await ligaDeTeste('Liga Com Notas Sintética')

    const viva = await registrar(banco, { texto: 'Manda a ficha separada.', ligaId: liga.id }, pessoa.ator)
    const morta = await registrar(banco, { texto: 'Regra antiga.', ligaId: liga.id }, pessoa.ator)
    await arquivar(banco, morta.id, {}, pessoa.ator)

    const encontrada = (await listar(banco)).find((linha) => linha.id === liga.id)

    // Um número que incluísse arquivadas prometeria, no seletor, memória que a
    // tela não vai mostrar quando a pessoa escolher a liga.
    expect(encontrada?.notas).toBe(1)
    expect(viva.ligaId).toBe(liga.id)
  })
})

describe('a caixa filtra por liga', () => {
  it('devolve só os itens daquela liga, e traz o nome para a tela mostrar', async () => {
    await semearBase(banco, { totalDeDias: 1 })
    const categoria = await banco.categoria.findFirstOrThrow({ where: { codigo: 'LIGANTE' } })
    const alfa = await ligaDeTeste('Liga Alfa Sintética')
    const beta = await ligaDeTeste('Liga Beta Sintética')

    await banco.item.create({
      data: { categoriaId: categoria.id, ligaId: alfa.id, titulo: 'Da alfa', status: 'aprovado', confianca: 1 },
    })
    await banco.item.create({
      data: { categoriaId: categoria.id, ligaId: beta.id, titulo: 'Da beta', status: 'aprovado', confianca: 1 },
    })
    await banco.item.create({
      data: { categoriaId: categoria.id, titulo: 'Sem liga', status: 'aprovado', confianca: 1 },
    })

    const soAlfa = await listarCaixa(banco, { ligaId: alfa.id })

    expect(soAlfa.map((item) => item.titulo)).toEqual(['Da alfa'])
    expect(soAlfa[0]!.ligaNome).toBe('Liga Alfa Sintética')

    // Sem filtro, os três — inclusive o que não tem liga, que continua sendo
    // trabalho real e não pode sumir da caixa por não pertencer a ninguém.
    const todos = await listarCaixa(banco)
    expect(todos).toHaveLength(3)
    expect(todos.find((item) => item.titulo === 'Sem liga')?.ligaNome).toBeNull()
  })
})
