import { beforeEach, describe, expect, it } from 'vitest'

import { EmailBrutoSchema, TAMANHO_MAXIMO_ANEXO_BYTES, type EmailBruto } from '../core/esquemas'
import type { AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo, semearBase } from '../testes/apoio'
import { sincronizar } from './ingestao'

/**
 * O que a origem diz sobre um anexo, e o que a ingestão faz com isso
 * (achados N-02 e N-27). Dados sintéticos.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

const IA: AiPort = {
  nome: 'duble',
  interpretar: async () => ({
    itens: [
      {
        categoriaCodigo: 'DOC_CADASTRO' as const,
        titulo: 'Documento sintético',
        confianca: 0.99,
        campos: { nome: 'Fulano Sintético' },
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

function comAnexo(messageId: string, anexo: Record<string, unknown>): IngestaoPort {
  const email: EmailBruto = EmailBrutoSchema.parse({
    messageId,
    remetente: 'associado@exemplo.test',
    assunto: 'Documento',
    corpo: 'Segue o documento.',
    recebidoEm: new Date(),
    anexos: [anexo],
  })
  return { nome: 'teste', buscarNovos: async () => [email] }
}

describe('anexo recusado pela origem', () => {
  it('link de nuvem com nome de .docx é recusado com o motivo da origem, e o item vai para revisão', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const ingestao = comAnexo('<link@exemplo.test>', {
      nome: 'contrato.docx',
      tamanho: 120,
      recusa: 'link para arquivo na nuvem, não é arquivo — abra no Outlook',
    })

    const resumo = await sincronizar({ banco, ingestao, ia: IA }, base.operador)

    expect(resumo.anexosRejeitados).toBe(1)
    const anexo = await banco.anexo.findFirstOrThrow({ where: { email: { messageId: '<link@exemplo.test>' } } })
    expect(anexo.aceito).toBe(false)
    expect(anexo.motivo).toContain('não é arquivo')
    const revisoes = await banco.revisao.count({ where: { item: { email: { messageId: '<link@exemplo.test>' } } } })
    expect(revisoes).toBe(1)
  })
})

describe('o tamanho que vale é o dos bytes, não o declarado (N-27)', () => {
  it('bytes acima do teto com tamanho declarado pequeno: recusado, e o tamanho gravado é o real', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const bytes = new Uint8Array(TAMANHO_MAXIMO_ANEXO_BYTES + 1)
    const ingestao = comAnexo('<mentiroso@exemplo.test>', { nome: 'grande.pdf', tamanho: 10, conteudo: bytes })

    const resumo = await sincronizar({ banco, ingestao, ia: IA }, base.operador)

    expect(resumo.anexosRejeitados).toBe(1)
    const anexo = await banco.anexo.findFirstOrThrow({ where: { email: { messageId: '<mentiroso@exemplo.test>' } } })
    expect(anexo.aceito).toBe(false)
    expect(anexo.tamanho).toBe(TAMANHO_MAXIMO_ANEXO_BYTES + 1)
  })
})
