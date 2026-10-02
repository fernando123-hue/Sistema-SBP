import { beforeEach, describe, expect, it } from 'vitest'

import { EmailBrutoSchema } from '../core/esquemas'
import type { AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo, semearBase } from '../testes/apoio'
import { minhaFila } from './fila'
import { sincronizar } from './ingestao'

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

/** IA falsa: um item de e-mail, com ou sem o sinal. */
function iaCom(agradecimento: boolean | undefined): AiPort {
  return {
    nome: 'duble',
    interpretar: async () => ({
      itens: [
        {
          categoriaCodigo: 'EMAIL_CADASTRO' as const,
          titulo: 'E-mail sintético',
          confianca: 0.99,
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
})
