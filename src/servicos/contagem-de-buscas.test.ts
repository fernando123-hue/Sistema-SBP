import { beforeEach, describe, expect, it } from 'vitest'

import { deslocarDias } from '../core/util/datas'
import { protegerCpf } from '../servidor/cpf-protegido'
import { obterPrisma } from '../servidor/prisma'
import { atorDeTeste, limparTudo, semearBase, type BaseSemeada } from '../testes/apoio'
import { buscarPorChave } from './caixa'
import { contarBusca, expurgarContagemDeBuscas } from './contagem-de-buscas'
import { listarPrazos } from './retencao'
import { rodarLimpezaDiaria } from './rotinas'

/**
 * `A44(h)` e `A48` — a busca por CPF é CONTADA, sem bloquear ninguém.
 *
 * ═══ O QUE ESTE ARQUIVO PROVA ═══
 *
 * Os limites da proteção contra varredura só podem ser definidos depois de
 * semanas medindo o uso real. Medir exige saber, por pessoa e por dia, quantas
 * buscas foram feitas e quantas não encontraram nada — o sinal de `A44(a)`.
 *
 * ═══ O QUE ELE NÃO PERMITE ═══
 *
 * Nenhuma leitura desta contagem existe fora do banco (`A44(g)`: sem placar,
 * não há meta invisível para administrar). E a contagem tem prazo: 90 dias
 * por padrão, editável como os outros (`A48`).
 */

const banco = obterPrisma()

const HOJE = '2026-09-16'
const CPF_COM_ITEM = '111.444.777-35'
const CPF_SEM_ITEM = '529.982.247-25'

let base: BaseSemeada

async function contagem(colaboradorId: string, dia = HOJE) {
  return banco.contagemDeBusca.findUnique({ where: { colaboradorId_dia: { colaboradorId, dia } } })
}

beforeEach(async () => {
  await limparTudo(banco)
  base = await semearBase(banco, { totalDeDias: 1 })

  const categoria = await banco.categoria.findUniqueOrThrow({ where: { codigo: 'DOC_CADASTRO' } })
  await banco.item.create({
    data: {
      categoriaId: categoria.id,
      titulo: 'Documento sintético',
      status: 'aprovado',
      confianca: 1,
      payload: '{}',
      cpfProtegido: protegerCpf(CPF_COM_ITEM),
    },
  })
})

describe('cada busca é contada para quem buscou, no dia', () => {
  it('busca que encontra soma uma busca e nenhuma sem resultado', async () => {
    await buscarPorChave(banco, { texto: CPF_COM_ITEM }, base.operador, { hoje: HOJE })

    expect(await contagem(base.operadorId)).toMatchObject({ buscas: 1, semResultado: 0 })
  })

  it('busca que não encontra nada soma nas duas', async () => {
    await buscarPorChave(banco, { texto: CPF_COM_ITEM }, base.operador, { hoje: HOJE })
    await buscarPorChave(banco, { texto: CPF_SEM_ITEM }, base.operador, { hoje: HOJE })

    expect(await contagem(base.operadorId)).toMatchObject({ buscas: 2, semResultado: 1 })
  })

  it('o que a pessoa não pode ver conta como nada encontrado', async () => {
    // O item existe, mas não é dela (`A24`). Para quem buscou, a resposta foi
    // vazia — e é exatamente o que uma varredura feita por essa conta veria.
    const colaboradora = base.colaboradores[0]!
    await buscarPorChave(banco, { texto: CPF_COM_ITEM }, colaboradora.ator, { hoje: HOJE })

    expect(await contagem(colaboradora.id)).toMatchObject({ buscas: 1, semResultado: 1 })
  })

  it('texto recusado antes de procurar não conta', async () => {
    // Dígito verificador errado: o sistema nem chegou a procurar.
    await expect(
      buscarPorChave(banco, { texto: '111.444.777-00' }, base.operador, { hoje: HOJE }),
    ).rejects.toThrow()

    expect(await contagem(base.operadorId)).toBeNull()
  })

  it('pessoas e dias diferentes ficam em linhas diferentes', async () => {
    const amanha = deslocarDias(HOJE, 1)
    await buscarPorChave(banco, { texto: CPF_COM_ITEM }, base.operador, { hoje: HOJE })
    await buscarPorChave(banco, { texto: CPF_COM_ITEM }, base.operador, { hoje: amanha })
    await buscarPorChave(banco, { texto: CPF_COM_ITEM }, base.colaboradores[0]!.ator, { hoje: HOJE })

    expect(await contagem(base.operadorId)).toMatchObject({ buscas: 1 })
    expect(await contagem(base.operadorId, amanha)).toMatchObject({ buscas: 1 })
    expect(await contagem(base.colaboradores[0]!.id)).toMatchObject({ buscas: 1 })
  })

  it('buscas ao mesmo tempo não se perdem', async () => {
    // A primeira busca do dia cria a linha. Duas primeiras buscas simultâneas
    // tentam criar a mesma linha; a que perde precisa somar, não sumir.
    await Promise.all(
      Array.from({ length: 8 }, () =>
        buscarPorChave(banco, { texto: CPF_SEM_ITEM }, base.operador, { hoje: HOJE }),
      ),
    )

    expect(await contagem(base.operadorId)).toMatchObject({ buscas: 8, semResultado: 8 })
  })
})

describe('conflito do banco na hora de contar', () => {
  // Deadlock não se provoca de propósito num teste; o banco falso entrega o
  // erro que o Prisma entregaria.
  function bancoQueFalha(erros: unknown[]) {
    const chamadas = { create: 0 }
    const banco = {
      contagemDeBusca: {
        updateMany: async () => ({ count: 0 }),
        create: async () => {
          chamadas.create++
          const erro = erros.shift()
          if (erro) throw erro
          return {}
        },
        update: async () => ({}),
      },
    } as unknown as Parameters<typeof contarBusca>[0]
    return { banco, chamadas }
  }

  it('deadlock é tentado de novo, e a contagem acontece', async () => {
    const { banco: falso, chamadas } = bancoQueFalha([{ code: 'P2034' }])

    await expect(contarBusca(falso, 'pessoa', true, HOJE)).resolves.toBeUndefined()
    expect(chamadas.create).toBe(2)
  })

  it('deadlock que não passa falha alto', async () => {
    const { banco: falso } = bancoQueFalha([{ code: 'P2034' }, { code: 'P2034' }, { code: 'P2034' }])

    await expect(contarBusca(falso, 'pessoa', true, HOJE)).rejects.toMatchObject({ code: 'P2034' })
  })

  it('outro erro não é tentado de novo', async () => {
    const { banco: falso, chamadas } = bancoQueFalha([{ code: 'P1001' }])

    await expect(contarBusca(falso, 'pessoa', true, HOJE)).rejects.toMatchObject({ code: 'P1001' })
    expect(chamadas.create).toBe(1)
  })
})

describe('a contagem tem prazo', () => {
  async function gravar(dia: string): Promise<void> {
    await banco.contagemDeBusca.create({
      data: { colaboradorId: base.operadorId, dia, buscas: 3, semResultado: 1 },
    })
  }

  it('sai no dia em que completa o prazo, e não antes', async () => {
    await gravar(deslocarDias(HOJE, -90))
    await gravar(deslocarDias(HOJE, -89))

    const resultado = await expurgarContagemDeBuscas(banco, { diasDeRetencao: 90, hoje: HOJE })

    expect(resultado.apagadas).toBe(1)
    expect(await contagem(base.operadorId, deslocarDias(HOJE, -90))).toBeNull()
    expect(await contagem(base.operadorId, deslocarDias(HOJE, -89))).not.toBeNull()
  })

  it('prazo inválido falha antes de apagar qualquer linha', async () => {
    await gravar(deslocarDias(HOJE, -1))

    await expect(expurgarContagemDeBuscas(banco, { diasDeRetencao: 0, hoje: HOJE })).rejects.toThrow()
    expect(await contagem(base.operadorId, deslocarDias(HOJE, -1))).not.toBeNull()
  })

  it('a limpeza diária usa o prazo padrão de 90 dias', async () => {
    await gravar(deslocarDias(HOJE, -90))
    await gravar(deslocarDias(HOJE, -89))

    const resultado = await rodarLimpezaDiaria(banco, { hoje: HOJE })

    expect(resultado).toMatchObject({
      executou: true,
      situacao: 'sucesso',
      resumo: { contagemDeBuscas: { apagadas: 1, prazoEmDias: 90 } },
    })
  })

  it('a gestora vê e edita o prazo junto com os outros', async () => {
    const gestora = atorDeTeste(base.operadorId, 'gestor')
    const prazos = await listarPrazos(banco, gestora)

    expect(prazos.find((prazo) => prazo.chave === 'contagem_de_buscas')).toMatchObject({
      dias: 90,
      padrao: 90,
    })
  })
})
