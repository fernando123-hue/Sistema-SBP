import { beforeEach, describe, expect, it } from 'vitest'

import { EmailBrutoSchema } from '../core/esquemas'
import type { AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo, semearBase } from '../testes/apoio'
import { sincronizar } from './ingestao'
import { listarPendentes, resolver } from './revisao'

/**
 * Depois da busca, a Distribuição diz quantos itens esperam conferência
 * (`A69`, 4A).
 *
 * O número que importa é o da fila INTEIRA, não o desta busca: o que ficou
 * na Revisão de ontem também não entra na distribuição de hoje. Dados 100%
 * sintéticos (invariante 8).
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

const NOMES = ['Diego Sintético Lima', 'Henrique Sintético Vilela', 'Isabela Sintética Rangel']

function caixaCom(...ids: string[]): IngestaoPort {
  return {
    nome: 'teste',
    buscarNovos: async () =>
      ids.map((id) =>
        EmailBrutoSchema.parse({
          messageId: id,
          remetente: 'secretaria.liga@exemplo.test',
          assunto: 'Inclusão de ligantes',
          corpo: `Prezados, incluir na liga: ${NOMES.join(', ')}.`,
          recebidoEm: new Date('2026-09-01T12:00:00Z'),
        }),
      ),
  }
}

/** Uma lista de três: o desdobramento manda os três para a Revisão. */
const ia: AiPort = {
  nome: 'duble',
  interpretar: async () => ({
    itens: NOMES.map((nome) => ({
      categoriaCodigo: 'LIGANTE' as const,
      titulo: `Inclusão de ligante — ${nome}`,
      confianca: 0.95,
      campos: { nome },
      camposAusentes: [],
      ligaMencionada: null,
      observacao: null,
    })),
    conteudoSuspeito: false,
    padroesSuspeitos: [],
    modelo: 'duble',
    versaoPrompt: 'teste',
  }),
}

describe('a busca diz quantas revisões esperam decisão (`A69`, 4A)', () => {
  it('conta a fila inteira, inclusive o que sobrou de buscas anteriores', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    const primeira = await sincronizar({ banco, ingestao: caixaCom('a@teste.local'), ia }, base.operador)
    expect(primeira.itensParaRevisao).toBe(3)
    expect(primeira.revisoesPendentes).toBe(3)

    const { itens } = await listarPendentes(banco, 10)
    await resolver(
      banco,
      { revisaoId: itens[0]!.revisaoId, categoriaCodigo: 'LIGANTE', titulo: itens[0]!.titulo, campos: {}, aprovar: true },
      base.operador,
    )

    const segunda = await sincronizar({ banco, ingestao: caixaCom('a@teste.local', 'b@teste.local'), ia }, base.operador)
    expect(segunda.itensParaRevisao).toBe(3)
    expect(segunda.revisoesPendentes).toBe(5)
  })

  it('busca sem nada novo ainda diz o que está esperando', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    await sincronizar({ banco, ingestao: caixaCom('a@teste.local'), ia }, base.operador)

    const vazia = await sincronizar({ banco, ingestao: caixaCom(), ia }, base.operador)
    expect(vazia.novos).toBe(0)
    expect(vazia.revisoesPendentes).toBe(3)
  })
})
