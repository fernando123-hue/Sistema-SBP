import { beforeEach, describe, expect, it } from 'vitest'

import { protegerCpf } from '../servidor/cpf-protegido'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo, semearBase, type BaseSemeada } from '../testes/apoio'
import { buscarPorChave, listarCaixa, resumirCaixa } from './caixa'
import { porPessoa } from './painel'

/**
 * `A24` — cada colaborador vê o próprio trabalho.
 *
 * ═══ O QUE ESTE ARQUIVO PROVA ═══
 *
 * Até a fase 2, `GET /api/itens` e `GET /api/painel` exigiam sessão e **nada
 * mais**: qualquer pessoa autenticada via remetente e assunto de TODOS os
 * e-mails, quem estava com cada item, e os números de cada colega. A razão do
 * dono para mudar isso é de operação — cada um focado no próprio trabalho —, e
 * a consequência de privacidade vem junto: remetente e assunto são dado de
 * associado.
 *
 * ═══ POR QUE O RECORTE MORA NO SERVIÇO ═══
 *
 * "A restrição é aplicada no servidor, na rota — esconder na tela deixaria o
 * dado na resposta HTTP" (`A24`). E, dentro do servidor, ela mora no SERVIÇO e
 * não no arquivo da rota, pelo mesmo motivo de `minhaFila`: quem escreve uma
 * segunda rota — ou um agente, um dia — passa pelo serviço, não pela rota. Uma
 * guarda que vive só na rota é uma guarda que a próxima porta não tem.
 *
 * ═══ O QUE CONTINUA ABERTO A TODO MUNDO, E POR QUÊ ═══
 *
 * `porCategoria` e a conferência de conservação: são números do SETOR, sem
 * pessoa nenhuma dentro. Esconder o volume do próprio setor de quem trabalha
 * nele não protege ninguém e tiraria da equipe a noção de quanto entrou no dia.
 */

const banco = obterPrisma()

const CPF_DO_ASSOCIADO = '111.444.777-35'

let base: BaseSemeada
let itemDeA: string
let itemDeB: string
let itemNoPool: string

beforeEach(async () => {
  await limparTudo(banco)
  base = await semearBase(banco, { totalDeDias: 1 })

  const categoria = await banco.categoria.findUniqueOrThrow({ where: { codigo: 'DOC_CADASTRO' } })

  const criarItem = async (titulo: string, dono: { id: string } | null): Promise<string> => {
    const item = await banco.item.create({
      data: {
        categoriaId: categoria.id,
        titulo,
        status: dono ? 'distribuido' : 'aprovado',
        confianca: 1,
        payload: '{}',
        cpfProtegido: protegerCpf(CPF_DO_ASSOCIADO),
      },
      select: { id: true },
    })

    if (dono) {
      await banco.atribuicao.create({
        data: {
          itemId: item.id,
          colaboradorId: dono.id,
          motivo: 'algoritmo',
          atribuidoPor: base.operadorId,
          ativa: true,
        },
      })
    }

    return item.id
  }

  itemDeA = await criarItem('Documento na mesa da A', base.colaboradores[0]!)
  itemDeB = await criarItem('Documento na mesa da B', base.colaboradores[1]!)
  // Item aprovado e ainda não distribuído: é trabalho do setor, de ninguém.
  itemNoPool = await criarItem('Documento ainda sem dono', null)
})

describe('caixa de entrada', () => {
  it('colaborador vê só os itens em que é o responsável ativo', async () => {
    const daA = await listarCaixa(banco, {}, base.colaboradores[0]!.ator)

    expect(daA.map((item) => item.itemId)).toEqual([itemDeA])
    // O item da colega e o que ainda não tem dono não aparecem — nem o título,
    // nem o remetente, nem quem está com ele.
    expect(daA.map((item) => item.itemId)).not.toContain(itemDeB)
    expect(daA.map((item) => item.itemId)).not.toContain(itemNoPool)
  })

  it('operador e gestor continuam vendo a caixa inteira', async () => {
    const doOperador = await listarCaixa(banco, {}, base.operador)

    expect(new Set(doOperador.map((item) => item.itemId))).toEqual(
      new Set([itemDeA, itemDeB, itemNoPool]),
    )
  })

  it('o resumo conta o MESMO universo que a lista mostra', async () => {
    // Sem isto, o cabeçalho diria "3 itens" sobre uma lista de 1 — o número que
    // não fecha com a tela é a doença que este sistema existe para eliminar.
    const resumoDaA = await resumirCaixa(banco, base.colaboradores[0]!.ator)
    expect(resumoDaA.total).toBe(1)

    const resumoDoOperador = await resumirCaixa(banco, base.operador)
    expect(resumoDoOperador.total).toBe(3)
  })
})

describe('busca por CPF', () => {
  it('a busca herda o recorte da caixa: colaborador não acha item de colega', async () => {
    // Os três itens têm o MESMO CPF de propósito: sem o recorte, a busca seria
    // a porta lateral que devolve o que a listagem esconde.
    const daA = await buscarPorChave(banco, { texto: CPF_DO_ASSOCIADO }, base.colaboradores[0]!.ator)

    expect(daA.map((item) => item.itemId)).toEqual([itemDeA])
  })

  it('operador acha todos os itens daquele CPF', async () => {
    const doOperador = await buscarPorChave(banco, { texto: CPF_DO_ASSOCIADO }, base.operador)

    expect(doOperador).toHaveLength(3)
  })
})

describe('painel por pessoa', () => {
  it('colaborador vê só a própria linha', async () => {
    const linhas = await porPessoa(banco, base.colaboradores[0]!.ator)

    expect(linhas.map((linha) => linha.colaboradorId)).toEqual([base.colaboradores[0]!.id])
    expect(linhas[0]!.atribuidos).toBe(1)
  })

  it('operador e gestor veem a equipe — é com esses números que se equilibra a carga', async () => {
    const linhas = await porPessoa(banco, base.operador)
    const ids = linhas.map((linha) => linha.colaboradorId)

    expect(ids).toContain(base.colaboradores[0]!.id)
    expect(ids).toContain(base.colaboradores[1]!.id)
  })
})
