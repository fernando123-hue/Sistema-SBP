import { beforeEach, describe, expect, it } from 'vitest'

import { EmailBrutoSchema, type EmailBruto, type Interpretacao } from '../core/esquemas'
import { FalhaDeArmazenamento } from '../ports/armazenamento'
import type { AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo, semearBase } from '../testes/apoio'
import { ArmazenamentoEmMemoria } from '../testes/armazenamento-em-memoria'
import { sincronizar } from './ingestao'

/**
 * Bytes gravados por uma tentativa que NÃO virou linha de `Anexo` saem na
 * hora, com o processo vivo — não esperam a varredura dos 7 dias (`A78`).
 * Revisão técnica do #211, M4. Dados sintéticos.
 */

const banco = obterPrisma()
const PDF = new TextEncoder().encode('%PDF-1.4\nconteudo sintetico\n%%EOF')

beforeEach(async () => {
  await limparTudo(banco)
})

const INTERPRETACAO: Interpretacao = {
  itens: [
    {
      categoriaCodigo: 'DOC_CADASTRO',
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
}

function comDoisAnexos(messageId: string): IngestaoPort {
  const email: EmailBruto = EmailBrutoSchema.parse({
    messageId,
    remetente: 'associado@exemplo.test',
    assunto: 'Documentos',
    corpo: 'Seguem os documentos.',
    recebidoEm: new Date(),
    anexos: [
      { nome: 'primeiro.pdf', tamanho: PDF.byteLength, conteudo: PDF },
      { nome: 'segundo.pdf', tamanho: PDF.byteLength, conteudo: PDF },
    ],
  })
  return { nome: 'teste', buscarNovos: async () => [email] }
}

/** Grava o primeiro arquivo e falha no segundo — disco cheio no meio do e-mail. */
class ArmazenamentoQueEnche extends ArmazenamentoEmMemoria {
  private gravados = 0

  override async guardar(bytes: Uint8Array, extensao = ''): Promise<string> {
    this.gravados += 1
    if (this.gravados === 2) throw new FalhaDeArmazenamento('guardar', 'disco cheio (simulado)')
    return super.guardar(bytes, extensao)
  }
}

describe('a ingestão não deixa arquivo sem linha com o processo vivo', () => {
  it('um guardar que falha no meio do e-mail desfaz o que os outros anexos já gravaram', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const armazenamento = new ArmazenamentoQueEnche()
    const ia: AiPort = { nome: 'duble', interpretar: async () => INTERPRETACAO }

    await sincronizar({ banco, ingestao: comDoisAnexos('<enche@exemplo.test>'), ia, armazenamento }, base.operador)

    expect(await banco.anexo.count()).toBe(0)
    expect(await armazenamento.listar()).toEqual([])
  })

  it('outra sincronização gravou o mesmo e-mail primeiro: os arquivos desta tentativa saem', async () => {
    // A corrida entre duas sincronizações: a checagem de fora passa, e a de
    // dentro da transação acha o e-mail já processado pela outra. Simulada
    // gravando o e-mail processado enquanto "a IA lê".
    const base = await semearBase(banco, { totalDeDias: 1 })
    const armazenamento = new ArmazenamentoEmMemoria()
    const ia: AiPort = {
      nome: 'duble',
      interpretar: async () => {
        await banco.email.create({
          data: { messageId: '<corrida@exemplo.test>', recebidoEm: new Date(), processadoEm: new Date() },
        })
        return INTERPRETACAO
      },
    }

    await sincronizar({ banco, ingestao: comDoisAnexos('<corrida@exemplo.test>'), ia, armazenamento }, base.operador)

    expect(await banco.anexo.count()).toBe(0)
    expect(await armazenamento.listar()).toEqual([])
  })
})
