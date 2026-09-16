import { beforeEach, describe, expect, it } from 'vitest'

import { EmailBrutoSchema } from '../core/esquemas'
import type { AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { protegerCpf } from '../servidor/cpf-protegido'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo, semearBase } from '../testes/apoio'
import { sincronizar } from './ingestao'
import { listarPendentes, resolver } from './revisao'

/**
 * A chave de busca nasce onde o CPF e a matrícula chegam (`A23(b)`, `A41`).
 *
 * Ela fica sem data de exclusão, então é gravada no mesmo momento em que o
 * campo existe: na ingestão, com o que a IA leu, e na revisão, com o que a
 * pessoa confirmou ou corrigiu. CPF e matrícula são sintéticos.
 */

const banco = obterPrisma()

const CPF_A = '111.444.777-35'
const CPF_B = '529.982.247-25'

beforeEach(async () => {
  await limparTudo(banco)
})

function umEmail(messageId: string): IngestaoPort {
  return {
    nome: 'teste',
    buscarNovos: async () => [
      EmailBrutoSchema.parse({
        messageId,
        remetente: 'associado@exemplo.test',
        assunto: 'Documento sintético',
        corpo: 'Segue documento.\n',
        recebidoEm: new Date(),
      }),
    ],
  }
}

/** IA falsa que devolve UM item com os campos dados. */
function iaCom(campos: Record<string, string>, confianca = 0.99): AiPort {
  return {
    nome: 'duble',
    interpretar: async () => ({
      itens: [
        {
          categoriaCodigo: 'DOC_CADASTRO' as const,
          titulo: 'Documento sintético',
          confianca,
          campos,
          camposAusentes: [],
          ligaMencionada: null,
          observacao: null,
        },
      ],
      conteudoSuspeito: false,
      padroesSuspeitos: [],
      modelo: 'duble',
      versaoPrompt: 'teste',
    }),
  }
}

async function ingerir(messageId: string, ia: AiPort) {
  const base = await semearBase(banco, { totalDeDias: 1 })
  await sincronizar({ banco, ingestao: umEmail(messageId), ia }, base.operador)
  const item = await banco.item.findFirstOrThrow({
    where: { email: { messageId } },
    select: { id: true, cpfProtegido: true, matricula: true, status: true },
  })
  return { base, item }
}

describe('na ingestão', () => {
  it('grava o CPF protegido e a matrícula, com o nome do campo escrito de qualquer jeito', async () => {
    const { item } = await ingerir('chave-ok@teste.local', iaCom({ CPF: CPF_A, 'Matrícula': '12.345' }))

    expect(item.cpfProtegido).toBe(protegerCpf(CPF_A))
    expect(item.matricula).toBe('12345')
  })

  it('o CPF em si nunca vai para a coluna da chave', async () => {
    const { item } = await ingerir('chave-sem-cpf@teste.local', iaCom({ cpf: CPF_A }))

    expect(item.cpfProtegido).not.toBeNull()
    expect(item.cpfProtegido).not.toContain('11144477735')
  })

  it('CPF com erro e matrícula com tamanho de CPF não viram chave', async () => {
    const { item } = await ingerir(
      'chave-errada@teste.local',
      iaCom({ cpf: '111.444.777-36', matricula: '11144477735' }),
    )

    expect(item.cpfProtegido).toBeNull()
    expect(item.matricula).toBeNull()
  })

  it('sem CPF nem matrícula, sem chave — o item se acha pela data de chegada', async () => {
    const { item } = await ingerir('chave-vazia@teste.local', iaCom({ nome: 'Fulano Sintético' }))

    expect(item.cpfProtegido).toBeNull()
    expect(item.matricula).toBeNull()
  })
})

describe('na revisão', () => {
  it('CPF corrigido pela pessoa faz a chave nascer certa', async () => {
    const { base, item } = await ingerir(
      'revisao-corrige@teste.local',
      iaCom({ cpf: '111.444.777-36' }, 0.3),
    )
    expect(item.status).toBe('aguardando_revisao')
    expect(item.cpfProtegido).toBeNull()

    const { itens } = await listarPendentes(banco, 10)
    const pendente = itens.find((linha) => linha.itemId === item.id)!
    await resolver(
      banco,
      {
        revisaoId: pendente.revisaoId,
        categoriaCodigo: pendente.categoriaCodigo,
        titulo: pendente.titulo,
        campos: { cpf: CPF_A },
        aprovar: true,
      },
      base.operador,
    )

    const depois = await banco.item.findUniqueOrThrow({ where: { id: item.id } })
    expect(depois.cpfProtegido).toBe(protegerCpf(CPF_A))
  })

  it('CPF trocado pela pessoa troca a chave — a antiga não fica', async () => {
    const { base, item } = await ingerir('revisao-troca@teste.local', iaCom({ cpf: CPF_A }, 0.3))
    expect(item.cpfProtegido).toBe(protegerCpf(CPF_A))

    const { itens } = await listarPendentes(banco, 10)
    const pendente = itens.find((linha) => linha.itemId === item.id)!
    await resolver(
      banco,
      {
        revisaoId: pendente.revisaoId,
        categoriaCodigo: pendente.categoriaCodigo,
        titulo: pendente.titulo,
        campos: { cpf: CPF_B, matricula: '9876' },
        aprovar: true,
      },
      base.operador,
    )

    const depois = await banco.item.findUniqueOrThrow({ where: { id: item.id } })
    expect(depois.cpfProtegido).toBe(protegerCpf(CPF_B))
    expect(depois.matricula).toBe('9876')
  })

  it('item extra criado na revisão também ganha a chave', async () => {
    const { base, item } = await ingerir('revisao-extra@teste.local', iaCom({}, 0.3))

    const { itens } = await listarPendentes(banco, 10)
    const pendente = itens.find((linha) => linha.itemId === item.id)!
    const feito = await resolver(
      banco,
      {
        revisaoId: pendente.revisaoId,
        categoriaCodigo: pendente.categoriaCodigo,
        titulo: pendente.titulo,
        campos: {},
        aprovar: true,
        itensExtras: [{ titulo: 'Documento sintético extra', campos: { cpf: CPF_B } }],
      },
      base.operador,
    )

    const extra = await banco.item.findUniqueOrThrow({ where: { id: feito.itensExtrasCriados[0]! } })
    expect(extra.cpfProtegido).toBe(protegerCpf(CPF_B))
  })
})
