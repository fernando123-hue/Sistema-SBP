import { beforeEach, describe, expect, it } from 'vitest'

import { EmailBrutoSchema } from '../core/esquemas'
import type { AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { obterPrisma } from '../servidor/prisma'
import { atorDeTeste, limparTudo, semearBase } from '../testes/apoio'
import { listarCaixa } from './caixa'
import { sincronizar } from './ingestao'
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

/** Quem vê o setor inteiro; o recorte do colaborador tem teste próprio abaixo. */
const OPERADORA = atorDeTeste('operadora-sintetica', 'operador')

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

    const listadas = await listar(banco, OPERADORA)
    const nomes = listadas.map((liga) => liga.nome)

    expect(nomes.indexOf('Liga Alfa Sintética')).toBeLessThan(nomes.indexOf('Liga Zeta Sintética'))
  })

  it('liga inativa não entra na escolha', async () => {
    const liga = await ligaDeTeste('Liga Encerrada Sintética')
    await banco.liga.update({ where: { id: liga.id }, data: { status: 'encerrada' } })

    expect((await listar(banco, OPERADORA)).map((linha) => linha.id)).not.toContain(liga.id)
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
          payload: '{}',
        },
      })
    }

    const encontrada = (await listar(banco, base.operador)).find((linha) => linha.id === liga.id)
    expect(encontrada?.itens).toBe(3)
    expect(base.operadorId).toBeTruthy()
  })

  it('para o colaborador, conta só os itens que ele vê na Caixa (N-39)', async () => {
    // O seletor dizia "· 3" e a lista embaixo mostrava 1: a contagem era do
    // setor inteiro, a lista é recortada por `A24`. O número tem de bater com
    // o que a pessoa vai ver ao escolher a liga.
    const base = await semearBase(banco, { totalDeDias: 1 })
    const liga = await ligaDeTeste('Liga Recortada Sintética')
    const categoria = await banco.categoria.findFirstOrThrow({ where: { codigo: 'LIGANTE' } })
    const pessoa = base.colaboradores[0]!

    for (let indice = 0; indice < 3; indice += 1) {
      const item = await banco.item.create({
        data: {
          categoriaId: categoria.id,
          ligaId: liga.id,
          titulo: `Ligante sintético ${indice + 1}`,
          status: indice === 0 ? 'distribuido' : 'aprovado',
          confianca: 1,
          payload: '{}',
        },
      })
      if (indice === 0) {
        await banco.atribuicao.create({
          data: {
            itemId: item.id,
            colaboradorId: pessoa.id,
            motivo: 'algoritmo',
            atribuidoPor: base.operadorId,
            ativa: true,
          },
        })
      }
    }

    const vistaDaPessoa = (await listar(banco, pessoa.ator)).find((linha) => linha.id === liga.id)
    const naCaixaDela = await listarCaixa(banco, { ligaId: liga.id }, pessoa.ator)
    expect(vistaDaPessoa?.itens).toBe(1)
    expect(vistaDaPessoa?.itens).toBe(naCaixaDela.length)

    const vistaDoOperador = (await listar(banco, base.operador)).find((linha) => linha.id === liga.id)
    expect(vistaDoOperador?.itens).toBe(3)
  })

  it('conta só as notas VIVAS — arquivada não orienta ninguém', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!
    const liga = await ligaDeTeste('Liga Com Notas Sintética')

    const viva = await registrar(banco, { texto: 'Manda a ficha separada.', ligaId: liga.id }, pessoa.ator)
    const morta = await registrar(banco, { texto: 'Regra antiga.', ligaId: liga.id }, pessoa.ator)
    await arquivar(banco, morta.id, {}, pessoa.ator)

    const encontrada = (await listar(banco, OPERADORA)).find((linha) => linha.id === liga.id)

    // Um número que incluísse arquivadas prometeria, no seletor, memória que a
    // tela não vai mostrar quando a pessoa escolher a liga.
    expect(encontrada?.notas).toBe(1)
    expect(viva.ligaId).toBe(liga.id)
  })
})

describe('a caixa filtra por liga', () => {
  it('devolve só os itens daquela liga, e traz o nome para a tela mostrar', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const categoria = await banco.categoria.findFirstOrThrow({ where: { codigo: 'LIGANTE' } })
    const alfa = await ligaDeTeste('Liga Alfa Sintética')
    const beta = await ligaDeTeste('Liga Beta Sintética')

    await banco.item.create({
      data: { categoriaId: categoria.id, ligaId: alfa.id, titulo: 'Da alfa', status: 'aprovado', confianca: 1, payload: '{}' },
    })
    await banco.item.create({
      data: { categoriaId: categoria.id, ligaId: beta.id, titulo: 'Da beta', status: 'aprovado', confianca: 1, payload: '{}' },
    })
    await banco.item.create({
      data: { categoriaId: categoria.id, titulo: 'Sem liga', status: 'aprovado', confianca: 1, payload: '{}' },
    })

    // Como operadora: o recorte por pessoa de `A24` tem teste próprio em
    // `quem-ve-o-que.test.ts`; aqui o que se mede é o filtro por liga.
    const soAlfa = await listarCaixa(banco, { ligaId: alfa.id }, base.operador)

    expect(soAlfa.map((item) => item.titulo)).toEqual(['Da alfa'])
    expect(soAlfa[0]!.ligaNome).toBe('Liga Alfa Sintética')

    // Sem filtro, os três — inclusive o que não tem liga, que continua sendo
    // trabalho real e não pode sumir da caixa por não pertencer a ninguém.
    const todos = await listarCaixa(banco, {}, base.operador)
    expect(todos).toHaveLength(3)
    expect(todos.find((item) => item.titulo === 'Sem liga')?.ligaNome).toBeNull()
  })
})

describe('identidade de liga com o índice de lote', () => {
  /**
   * O índice de ligas é montado uma vez por lote — a correção do N+1 que varria
   * a tabela `Liga` inteira por ITEM, dentro da transação de escrita.
   *
   * O risco que ele introduz é o oposto do defeito que corrige: se a liga criada
   * NO MEIO do lote não entrar no índice, a menção seguinte ao mesmo nome cria
   * uma segunda linha — e aí o `A4` deixa de valer, porque a liga se parte em
   * duas e cada metade pode ir para uma pessoa diferente no mesmo dia.
   *
   * O duble devolve dois itens com a MESMA liga, que ainda não existe no banco.
   * Com `IaMock` isto não seria testável: ele extrai um item por e-mail.
   */
  const doisLigantesDaMesmaLiga: AiPort = {
    nome: 'duble',
    interpretar: async () => ({
      itens: [
        {
          categoriaCodigo: 'LIGANTE' as const,
          titulo: 'Pessoa Um',
          confianca: 0.99,
          campos: {},
          camposAusentes: [],
          ligaMencionada: 'Liga Acadêmica de Pediatria do Vale',
          observacao: null,
        },
        {
          categoriaCodigo: 'LIGANTE' as const,
          titulo: 'Pessoa Dois',
          confianca: 0.99,
          campos: {},
          camposAusentes: [],
          // O MESMO nome, com acentuação e caixa diferentes: `chaveDaLiga`
          // normaliza os dois para a mesma chave, por decisão (`AT-10`).
          ligaMencionada: 'liga academica de pediatria do vale',
          observacao: null,
        },
      ],
      conteudoSuspeito: false,
      padroesSuspeitos: [],
      modelo: 'duble',
      versaoPrompt: 'teste',
    }),
  }

  it('a mesma liga mencionada duas vezes no lote continua sendo UMA linha', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    const ingestao: IngestaoPort = {
      nome: 'teste',
      buscarNovos: async () => [
        EmailBrutoSchema.parse({
          messageId: 'liga-repetida@teste.local',
          remetente: 'contato@exemplo.test',
          assunto: 'Dois ligantes da mesma liga',
          corpo: 'Seguem dois ligantes.\n',
          recebidoEm: new Date(),
        }),
      ],
    }

    // A base semeada já tem ligas: o que interessa é quantas NASCEM deste lote.
    const antes = new Set((await banco.liga.findMany({ select: { id: true } })).map((l) => l.id))

    await sincronizar({ banco, ingestao, ia: doisLigantesDaMesmaLiga }, base.operador)

    const depois = await banco.liga.findMany({ select: { id: true, nome: true } })
    const nascidas = depois.filter((liga) => !antes.has(liga.id))
    expect(nascidas).toHaveLength(1)

    const itens = await banco.item.findMany({
      where: { ligaId: { not: null } },
      select: { ligaId: true },
    })
    expect(itens).toHaveLength(2)
    expect(new Set(itens.map((item) => item.ligaId)).size).toBe(1)
  })
})
