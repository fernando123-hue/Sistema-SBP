import { beforeEach, describe, expect, it } from 'vitest'

import { EmailBrutoSchema, type EmailBruto } from '../core/esquemas'
import type { AiPort } from '../ports/ia'
import type { IngestaoPort, PedidoDeBusca } from '../ports/ingestao'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo, semearBase } from '../testes/apoio'
import { JANELA_DE_RELEITURA_DIAS, sincronizar } from './ingestao'

/**
 * O que a ingestão pede ao adapter e o que faz com os avisos dele
 * (achados C-02 e C-03). Dados sintéticos.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

function email(messageId: string): EmailBruto {
  return EmailBrutoSchema.parse({
    messageId,
    remetente: 'associado@exemplo.test',
    assunto: 'Ficha sintética',
    corpo: 'Segue a ficha.',
    recebidoEm: new Date(),
  })
}

const IA: AiPort = {
  nome: 'duble',
  interpretar: async () => ({
    itens: [
      {
        categoriaCodigo: 'FICHA_CADASTRO' as const,
        titulo: 'Ficha sintética',
        confianca: 0.99,
        campos: {},
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

/** Adapter que guarda o pedido e responde com o roteiro dado. */
function adapter(roteiro: (pedido: PedidoDeBusca) => Promise<EmailBruto[]>) {
  const pedidos: PedidoDeBusca[] = []
  const porta: IngestaoPort = {
    nome: 'teste',
    buscarNovos: async (pedido = {}) => {
      pedidos.push(pedido)
      return roteiro(pedido)
    },
  }
  return { pedidos, porta }
}

describe('a ingestão pede uma janela e diz o que já foi processado', () => {
  it('pede só a janela de releitura, não a caixa inteira', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const { pedidos, porta } = adapter(async () => [])
    const antes = Date.now()

    await sincronizar({ banco, ingestao: porta, ia: IA }, base.operador)

    const desde = pedidos[0]!.desde!.getTime()
    const janela = JANELA_DE_RELEITURA_DIAS * 24 * 60 * 60 * 1000
    expect(desde).toBeGreaterThanOrEqual(antes - janela - 1000)
    expect(desde).toBeLessThanOrEqual(Date.now() - janela + 1000)
  })

  it('`jaProcessados` responde com o que já virou trabalho, e só isso', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    await sincronizar({ banco, ingestao: adapter(async () => [email('<velho@exemplo.test>')]).porta, ia: IA }, base.operador)

    let resposta: ReadonlySet<string> | undefined
    const { porta } = adapter(async (pedido) => {
      resposta = await pedido.jaProcessados!(['<velho@exemplo.test>', '<novo@exemplo.test>'])
      return []
    })
    await sincronizar({ banco, ingestao: porta, ia: IA }, base.operador)

    expect([...resposta!]).toEqual(['<velho@exemplo.test>'])
  })
})

describe('os avisos do adapter ficam registrados', () => {
  it('mensagem recusada vira falha com o identificador, sem derrubar as outras', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const { porta } = adapter(async (pedido) => {
      pedido.avisar!({
        tipo: 'recusado',
        messageId: '<ruim@exemplo.test>',
        recebidoEm: '2026-09-16T12:00:00Z',
        motivo: 'corpo: too_big',
      })
      return [email('<bom@exemplo.test>')]
    })

    const resumo = await sincronizar({ banco, ingestao: porta, ia: IA }, base.operador)

    expect(resumo.novos).toBe(1)
    expect(resumo.falhas).toBe(1)
    const evento = await banco.eventoProcessamento.findFirstOrThrow({
      where: { referencia: '<ruim@exemplo.test>' },
    })
    expect(evento.situacao).toBe('falha')
    expect(evento.mensagem).toContain('corpo: too_big')
    expect(evento.mensagem).toContain('2026-09-16')
  })

  it('mensagens adiadas ficam registradas com a quantidade', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const { porta } = adapter(async (pedido) => {
      pedido.avisar!({ tipo: 'adiados', quantidade: 7 })
      return []
    })

    const resumo = await sincronizar({ banco, ingestao: porta, ia: IA }, base.operador)

    expect(resumo.falhas).toBe(0)
    const evento = await banco.eventoProcessamento.findFirstOrThrow({
      where: { mensagem: { contains: '7 mensagens' } },
    })
    expect(evento.situacao).toBe('reprocessavel')
  })
})
