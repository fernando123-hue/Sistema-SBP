import { beforeEach, describe, expect, it } from 'vitest'

import { EmailBrutoSchema } from '../core/esquemas'
import type { AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo, semearBase } from '../testes/apoio'
import { minhaFila } from './fila'
import { sincronizar } from './ingestao'
import { listarPendentes, resolver } from './revisao'

/**
 * `A75`: o sinal de agradecimento que a IA marca chega ao item e à fila, onde
 * a tela escreve o texto fixo. Ausente vale "não" — o item comum não ganha
 * observação nenhuma. E-mails e nomes sintéticos.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

function umEmail(messageId: string): IngestaoPort {
  return {
    nome: 'teste',
    buscarNovos: async () => [
      EmailBrutoSchema.parse({
        messageId,
        remetente: 'associada@exemplo.test',
        assunto: 'Re: Retorno sobre o meu cadastro',
        corpo: 'Muito obrigada pelo retorno, deu tudo certo!\n',
        recebidoEm: new Date(),
      }),
    ],
  }
}

/** IA falsa: um item, de e-mail por padrão, com ou sem o sinal. */
function iaCom(
  agradecimento: boolean | undefined,
  { categoria = 'EMAIL_CADASTRO', confianca = 0.99 }: { categoria?: 'EMAIL_CADASTRO' | 'DOC_CADASTRO'; confianca?: number } = {},
): AiPort {
  return {
    nome: 'duble',
    interpretar: async () => ({
      itens: [
        {
          categoriaCodigo: categoria,
          titulo: 'E-mail sintético',
          confianca,
          campos: {},
          camposAusentes: [],
          ligaMencionada: null,
          observacao: null,
          ...(agradecimento === undefined ? {} : { agradecimento }),
        },
      ],
      conteudoSuspeito: false,
      padroesSuspeitos: [],
      modelo: 'duble',
      versaoPrompt: 'teste',
    }),
  }
}

async function ingerirEAtribuir(messageId: string, ia: AiPort) {
  const base = await semearBase(banco, { totalDeDias: 1 })
  await sincronizar({ banco, ingestao: umEmail(messageId), ia }, base.operador)
  const item = await banco.item.findFirstOrThrow({ where: { email: { messageId } } })
  const dona = base.colaboradores[0]!
  await banco.item.update({ where: { id: item.id }, data: { status: 'distribuido' } })
  await banco.atribuicao.create({
    data: { itemId: item.id, colaboradorId: dona.id, motivo: 'manual', atribuidoPor: base.operadorId, ativa: true },
  })
  return { item, fila: await minhaFila(banco, dona.id, dona.ator) }
}

describe('o agradecimento chega à fila (A75)', () => {
  it('a IA marcou: o item guarda o sinal e a fila o devolve', async () => {
    const { item, fila } = await ingerirEAtribuir('agradecimento-sim@teste.local', iaCom(true))
    expect(item.agradecimento).toBe(true)
    expect(fila.map((linha) => linha.agradecimento)).toEqual([true])
  })

  it('a IA não disse nada: não é agradecimento', async () => {
    const { item, fila } = await ingerirEAtribuir('agradecimento-ausente@teste.local', iaCom(undefined))
    expect(item.agradecimento).toBe(false)
    expect(fila.map((linha) => linha.agradecimento)).toEqual([false])
  })

  // Revisão de segurança do #190 (BAIXO-1): o "obrigado" é e-mail (`A75`).
  // Um documento marcado como agradecimento é engano ou manipulação, e o selo
  // faria um pedido real parecer cortesia.
  it('fora das categorias de e-mail, o sinal não vale', async () => {
    const { item } = await ingerirEAtribuir(
      'agradecimento-em-documento@teste.local',
      iaCom(true, { categoria: 'DOC_CADASTRO' }),
    )
    expect(item.agradecimento).toBe(false)
  })
})

describe('o agradecimento na revisão humana (A75)', () => {
  // Revisões do #190 (segurança MÉDIO-2, técnica LOW-2): a pessoa que corrige
  // a categoria não vê o sinal; sem isto, o selo sobrevivia num item que ela
  // reclassificou como ficha.
  it('a revisão que tira o item de e-mail apaga o selo; a que mantém, mantém', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    for (const [messageId, categoriaFinal, esperado] of [
      ['revisao-vira-ficha@teste.local', 'FICHA_CADASTRO', false],
      ['revisao-continua-email@teste.local', 'EMAIL_CADASTRO', true],
    ] as const) {
      await sincronizar({ banco, ingestao: umEmail(messageId), ia: iaCom(true, { confianca: 0.3 }) }, base.operador)
      const item = await banco.item.findFirstOrThrow({ where: { email: { messageId } } })
      expect(item.status).toBe('aguardando_revisao')
      expect(item.agradecimento).toBe(true)

      const { itens } = await listarPendentes(banco, 10)
      const pendente = itens.find((linha) => linha.itemId === item.id)!
      await resolver(
        banco,
        { revisaoId: pendente.revisaoId, categoriaCodigo: categoriaFinal, titulo: pendente.titulo, campos: {}, aprovar: true },
        base.operador,
      )
      const depois = await banco.item.findUniqueOrThrow({ where: { id: item.id } })
      expect(depois.agradecimento, categoriaFinal).toBe(esperado)
    }
  })
})
