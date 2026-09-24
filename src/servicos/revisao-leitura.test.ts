import { beforeEach, describe, expect, it } from 'vitest'

import { EmailBrutoSchema } from '../core/esquemas'
import type { AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { obterPrisma, type Banco } from '../servidor/prisma'
import { limparTudo, semearBase } from '../testes/apoio'
import { sincronizar } from './ingestao'
import { listarPendentes, resolver } from './revisao'

/**
 * O que a revisão lê do banco, e o que ela faz quando a leitura não fecha.
 *
 * N-34: a lista usava só remetente e assunto, mas trazia o corpo inteiro
 * (LongText, até 200 mil caracteres) de cada e-mail pendente, a cada abertura.
 * N-35: payload ilegível virava padrão vazio e era gravado por cima, apagando
 * o que a IA extraiu sem deixar rastro. Dados 100% sintéticos.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

const ingestao: IngestaoPort = {
  nome: 'teste',
  buscarNovos: async () => [
    EmailBrutoSchema.parse({
      messageId: 'revisao-leitura@teste.local',
      remetente: 'associado@exemplo.test',
      assunto: 'Documento sintético',
      corpo: 'Corpo longo que a lista de revisão não usa.\n',
      recebidoEm: new Date(),
    }),
  ],
}

/** Confiança baixa: o item vai para revisão. */
const ia: AiPort = {
  nome: 'duble',
  interpretar: async () => ({
    itens: [
      {
        categoriaCodigo: 'DOC_CADASTRO' as const,
        titulo: 'Documento sintético',
        confianca: 0.3,
        campos: { crm: '000000' },
        camposAusentes: [],
        ligaMencionada: 'Liga Sintética',
        observacao: null,
      },
    ],
    conteudoSuspeito: false,
    padroesSuspeitos: [],
    modelo: 'duble',
    versaoPrompt: 'teste',
  }),
}

async function umaRevisaoPendente() {
  const base = await semearBase(banco, { totalDeDias: 1 })
  await sincronizar({ banco, ingestao, ia }, base.operador)
  const { itens } = await listarPendentes(banco, 10)
  expect(itens).toHaveLength(1)
  return { base, pendente: itens[0]! }
}

/** Banco que guarda o que `revisao.findMany` devolveu, cru. */
function bancoQueGuardaALista(original: Banco, guardado: unknown[]): Banco {
  return new Proxy(original, {
    get(alvo, chave) {
      const valor: unknown = Reflect.get(alvo, chave)
      if (chave !== 'revisao') return valor
      return new Proxy(valor as object, {
        get(delegate, metodo) {
          const funcao: unknown = Reflect.get(delegate, metodo)
          if (metodo !== 'findMany' || typeof funcao !== 'function') return funcao
          return async (...argumentos: unknown[]) => {
            const linhas = await (funcao as (...a: unknown[]) => Promise<unknown[]>).apply(
              delegate,
              argumentos,
            )
            guardado.push(...linhas)
            return linhas
          }
        },
      })
    },
  })
}

describe('lista de revisão (N-34)', () => {
  it('não traz o corpo do e-mail do banco — só remetente e assunto', async () => {
    await umaRevisaoPendente()

    const cru: unknown[] = []
    const { itens } = await listarPendentes(bancoQueGuardaALista(banco, cru), 10)

    expect(itens[0]!.remetente).toBe('associado@exemplo.test')
    expect(itens[0]!.assunto).toBe('Documento sintético')
    const conteudo = (cru[0] as { item: { email: { conteudo: Record<string, unknown> } } }).item
      .email.conteudo
    expect(Object.keys(conteudo).sort()).toEqual(['assunto', 'remetente'])
  })
})

describe('resolver com payload ilegível (N-35)', () => {
  it('falha alto e deixa o payload original no banco, sem aprovar o item', async () => {
    const { base, pendente } = await umaRevisaoPendente()
    // Forma que uma versão anterior poderia ter gravado: `campos` não é objeto.
    const ilegivel = '{"campos":5,"ligaMencionada":"Liga Sintética"}'
    await banco.item.update({ where: { id: pendente.itemId }, data: { payload: ilegivel } })

    await expect(
      resolver(
        banco,
        {
          revisaoId: pendente.revisaoId,
          categoriaCodigo: pendente.categoriaCodigo,
          titulo: pendente.titulo,
          campos: { crm: '111111' },
          aprovar: true,
        },
        base.operador,
      ),
    ).rejects.toThrow(/Item\.payload ilegível/)

    const depois = await banco.item.findUniqueOrThrow({ where: { id: pendente.itemId } })
    expect(depois.payload).toBe(ilegivel)
    expect(depois.status).toBe('aguardando_revisao')
    const revisao = await banco.revisao.findUniqueOrThrow({ where: { id: pendente.revisaoId } })
    expect(revisao.resolvidoEm).toBeNull()
  })

  it('a mensagem do erro não carrega o conteúdo do payload (vai para o log)', async () => {
    const { base, pendente } = await umaRevisaoPendente()
    await banco.item.update({
      where: { id: pendente.itemId },
      data: { payload: '{"campos":5,"observacao":"Fulano Sintético"}' },
    })

    const erro = await resolver(
      banco,
      {
        revisaoId: pendente.revisaoId,
        categoriaCodigo: pendente.categoriaCodigo,
        titulo: pendente.titulo,
        campos: {},
        aprovar: true,
      },
      base.operador,
    ).catch((e: unknown) => e)

    expect(erro).toBeInstanceOf(Error)
    expect((erro as Error).message).not.toContain('Fulano')
  })
})
