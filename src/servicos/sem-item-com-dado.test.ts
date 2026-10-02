import { beforeEach, describe, expect, it } from 'vitest'

import { EmailBrutoSchema } from '../core/esquemas'
import type { AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo, semearBase } from '../testes/apoio'
import { sincronizar } from './ingestao'

/**
 * `AT-73`: o e-mail que a IA leu como "nenhum pedido" mas traz CPF, CRM ou
 * anexo não some — fica guardado como o suspeito (fora da limpeza, `AT-24`),
 * e o evento diz por quê, separado da manipulação. E-mails sintéticos.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

function umEmail(messageId: string, corpo: string, anexos: { nome: string; tipoDeclarado: string; tamanho: number }[] = []): IngestaoPort {
  return {
    nome: 'teste',
    buscarNovos: async () => [
      EmailBrutoSchema.parse({
        messageId,
        remetente: 'associada@exemplo.test',
        assunto: 'Resposta automática: fora do escritório',
        corpo,
        anexos,
        recebidoEm: new Date(),
      }),
    ],
  }
}

/** A IA leu como resposta automática: nenhum item, nada suspeito. */
const iaSemItem: AiPort = {
  nome: 'duble',
  interpretar: async () => ({
    itens: [],
    conteudoSuspeito: false,
    padroesSuspeitos: [],
    modelo: 'duble',
    versaoPrompt: 'teste',
  }),
}

async function ingerir(ingestao: IngestaoPort, messageId: string) {
  const base = await semearBase(banco, { totalDeDias: 1 })
  await sincronizar({ banco, ingestao, ia: iaSemItem }, base.operador)
  const email = await banco.email.findUniqueOrThrow({ where: { messageId } })
  const eventos = await banco.eventoProcessamento.findMany({ where: { referencia: messageId, etapa: 'ingestao' } })
  return { email, mensagens: eventos.map((evento) => evento.mensagem ?? '') }
}

describe('e-mail sem item com dado de trabalho (AT-73)', () => {
  it('resposta automática sem dado: segue a rotina, sai pela limpeza', async () => {
    const id = 'sem-dado@teste.local'
    const { email, mensagens } = await ingerir(umEmail(id, 'Estou fora do escritório até 20/01.'), id)
    expect(email.conteudoSuspeito).toBe(false)
    expect(mensagens.some((mensagem) => mensagem.includes('confira se havia trabalho ali'))).toBe(true)
  })

  it('com CPF no corpo: fica guardado, e o evento diz que tinha CPF', async () => {
    const id = 'com-cpf@teste.local'
    const { email, mensagens } = await ingerir(
      umEmail(id, 'Estou fora até 20/01.\nPS: corrijam meu cadastro, CPF 111.444.777-35.'),
      id,
    )
    expect(email.conteudoSuspeito).toBe(true)
    expect(mensagens.some((mensagem) => mensagem.includes('CPF'))).toBe(true)
    expect(mensagens.some((mensagem) => mensagem.includes('tentativa de fazer o trabalho desaparecer'))).toBe(false)
  })

  it('com anexo: fica guardado, e o evento diz que tinha anexo', async () => {
    const id = 'com-anexo@teste.local'
    const { email, mensagens } = await ingerir(
      umEmail(id, 'Estou fora até 20/01.', [{ nome: 'diploma.pdf', tipoDeclarado: 'image/png', tamanho: 1000 }]),
      id,
    )
    expect(email.conteudoSuspeito).toBe(true)
    expect(mensagens.some((mensagem) => mensagem.includes('anexo'))).toBe(true)
  })
})
