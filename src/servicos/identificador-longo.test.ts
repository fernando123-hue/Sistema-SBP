import { beforeEach, describe, expect, it } from 'vitest'

import { EmailBrutoSchema, TAMANHO_MAXIMO_MESSAGE_ID, type EmailBruto } from '../core/esquemas'
import type { AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { TAMANHO_MAXIMO_REFERENCIA } from '../servidor/observabilidade'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo, semearBase } from '../testes/apoio'
import { sincronizar } from './ingestao'

/**
 * Achado C-04 (`docs/auditoria/2026-09-17-achados-da-auditoria-por-agentes.md`).
 *
 * O `Message-ID` é escrito por quem manda o e-mail. O esquema aceitava até 500
 * caracteres e a coluna `Email.messageId` tem 191: um identificador longo
 * passava pela validação, pagava a IA e só falhava ao gravar — e, sem gravar,
 * voltava na sincronização seguinte para pagar de novo, para sempre. A
 * `referencia` do evento tem o mesmo tamanho, e gravar a falha também
 * quebrava, derrubando a sincronização inteira.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

async function tamanhoDaColuna(tabela: string, coluna: string): Promise<number> {
  const [linha] = await banco.$queryRaw<{ tamanho: bigint | number }[]>`
    SELECT CHARACTER_MAXIMUM_LENGTH AS tamanho
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${tabela} AND COLUMN_NAME = ${coluna}`
  return Number(linha!.tamanho)
}

describe('os limites do código são os das colunas', () => {
  it('messageId do esquema cabe em Email.messageId', async () => {
    expect(TAMANHO_MAXIMO_MESSAGE_ID).toBe(await tamanhoDaColuna('Email', 'messageId'))
  })

  it('a referência do evento cabe em EventoProcessamento.referencia', async () => {
    expect(TAMANHO_MAXIMO_REFERENCIA).toBe(await tamanhoDaColuna('EventoProcessamento', 'referencia'))
  })

  it('o esquema recusa um caractere a mais', () => {
    const base = { remetente: 'a@exemplo.test', recebidoEm: new Date() }
    expect(EmailBrutoSchema.safeParse({ ...base, messageId: 'x'.repeat(TAMANHO_MAXIMO_MESSAGE_ID) }).success).toBe(true)
    expect(EmailBrutoSchema.safeParse({ ...base, messageId: 'x'.repeat(TAMANHO_MAXIMO_MESSAGE_ID + 1) }).success).toBe(false)
  })
})

describe('um identificador longo não paga IA nem derruba a sincronização', () => {
  const LONGO = `<${'x'.repeat(300)}@exemplo.test>`

  function iaQueConta(): AiPort & { chamadas: number } {
    const estado = { chamadas: 0 }
    return {
      nome: 'duble',
      get chamadas() {
        return estado.chamadas
      },
      interpretar: async () => {
        estado.chamadas += 1
        return {
          itens: [],
          conteudoSuspeito: false,
          padroesSuspeitos: [],
          modelo: 'duble',
          versaoPrompt: 'teste',
        }
      },
    }
  }

  it('vindo do adapter sem validar: vira falha registrada, sem chamada à IA, duas vezes seguidas', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    // Um adapter que não valida (o port não obriga) entrega o identificador cru.
    const cru = { messageId: LONGO, remetente: 'a@exemplo.test', recebidoEm: new Date() } as unknown as EmailBruto
    const ingestao: IngestaoPort = { nome: 'teste', buscarNovos: async () => [cru] }
    const ia = iaQueConta()

    const primeira = await sincronizar({ banco, ingestao, ia }, base.operador)
    const segunda = await sincronizar({ banco, ingestao, ia }, base.operador)

    expect(ia.chamadas).toBe(0)
    expect(primeira.falhas).toBe(1)
    expect(segunda.falhas).toBe(1)
    const eventos = await banco.eventoProcessamento.findMany({ where: { referencia: { startsWith: '<xxxx' } } })
    expect(eventos).toHaveLength(2)
    expect(eventos.every((evento) => evento.referencia!.length <= TAMANHO_MAXIMO_REFERENCIA)).toBe(true)
  })

  it('recusado pelo adapter: o aviso com identificador longo é gravado, e a outra mensagem entra', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const bom = EmailBrutoSchema.parse({
      messageId: '<bom@exemplo.test>',
      remetente: 'a@exemplo.test',
      corpo: 'Segue a ficha.',
      recebidoEm: new Date(),
    })
    const ingestao: IngestaoPort = {
      nome: 'teste',
      buscarNovos: async (pedido = {}) => {
        pedido.avisar?.({ tipo: 'recusado', messageId: LONGO, recebidoEm: null, motivo: 'messageId: too_big' })
        return [bom]
      },
    }

    const resumo = await sincronizar({ banco, ingestao, ia: iaQueConta() }, base.operador)

    expect(resumo.falhas).toBe(1)
    expect(resumo.novos).toBe(1)
  })
})
