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

    let resposta: ReadonlyMap<string, Date> | undefined
    const { porta } = adapter(async (pedido) => {
      resposta = await pedido.jaProcessados!(['<velho@exemplo.test>', '<novo@exemplo.test>'])
      return []
    })
    await sincronizar({ banco, ingestao: porta, ia: IA }, base.operador)

    expect([...resposta!.keys()]).toEqual(['<velho@exemplo.test>'])
    expect(resposta!.get('<velho@exemplo.test>')).toBeInstanceOf(Date)
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
    // Não é "falha que volta na próxima busca": volta recusada de novo. A tela
    // precisa mandar tratar na caixa, e para isso o contador é outro.
    expect(resumo.naoLidas).toBe(1)
    expect(resumo.falhas).toBe(0)
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

describe('identificador repetido com outra data fica visível (pendência do PR #59)', () => {
  it('as colisões avisadas pelo adapter viram UM evento por sincronização, sem contar como falha', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const { porta } = adapter(async (pedido) => {
      for (let indice = 0; indice < 30; indice += 1) {
        pedido.avisar!({ tipo: 'colisao', messageId: `<copia@exemplo.test>`, recebidoEm: `2026-09-16T12:${String(indice).padStart(2, '0')}:00Z` })
      }
      return []
    })

    const resumo = await sincronizar({ banco, ingestao: porta, ia: IA }, base.operador)

    // Uma cópia legítima (lista de e-mail, reentrega) também cai aqui: marcar o
    // dia de vermelho por ela ensinaria a ignorar vermelho.
    expect(resumo.falhas).toBe(0)
    // Mas aparece na tela: sem contador, a sincronização ficaria verde.
    expect(resumo.repetidas).toBe(30)
    const eventos = await banco.eventoProcessamento.findMany({ where: { mensagem: { contains: 'identificador' } } })
    expect(eventos).toHaveLength(1)
    expect(eventos[0]!.situacao).toBe('falha')
    expect(eventos[0]!.mensagem).toContain('30 mensagens')
    const detalhe = JSON.parse(eventos[0]!.detalhe!) as { exemplos: unknown[] }
    expect(detalhe.exemplos.length).toBeLessThanOrEqual(10)
  })

  it('adapter que não usa jaProcessados: a repetição com outra data também é registrada, sem pagar IA', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    let chamadas = 0
    const ia: AiPort = {
      nome: 'duble',
      interpretar: async (...argumentos) => {
        chamadas += 1
        return IA.interpretar(...argumentos)
      },
    }
    const primeiro = { ...email('<repetido@exemplo.test>'), recebidoEm: new Date('2026-09-16T10:00:00Z') }
    const segundo = { ...primeiro, recebidoEm: new Date('2026-09-16T11:00:00Z') }

    await sincronizar({ banco, ingestao: adapter(async () => [primeiro]).porta, ia }, base.operador)
    const resumo = await sincronizar({ banco, ingestao: adapter(async () => [segundo]).porta, ia }, base.operador)

    expect(chamadas).toBe(1)
    expect(resumo.duplicados).toBe(1)
    expect(resumo.falhas).toBe(0)
    expect(resumo.repetidas).toBe(1)
    const eventos = await banco.eventoProcessamento.findMany({ where: { referencia: '<repetido@exemplo.test>' } })
    expect(eventos.map((evento) => evento.situacao)).toEqual(['falha'])
  })

  it('várias repetições no laço, mais as do adapter, viram um evento só', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const originais = ['<r1@exemplo.test>', '<r2@exemplo.test>'].map((id) => ({
      ...email(id),
      recebidoEm: new Date('2026-09-16T10:00:00Z'),
    }))
    await sincronizar({ banco, ingestao: adapter(async () => originais).porta, ia: IA }, base.operador)

    const copias = originais.map((original) => ({ ...original, recebidoEm: new Date('2026-09-16T12:00:00Z') }))
    const { porta } = adapter(async (pedido) => {
      pedido.avisar!({ tipo: 'colisao', messageId: '<r3@exemplo.test>', recebidoEm: '2026-09-16T13:00:00Z' })
      return copias
    })
    const resumo = await sincronizar({ banco, ingestao: porta, ia: IA }, base.operador)

    expect(resumo.repetidas).toBe(3)
    const eventos = await banco.eventoProcessamento.findMany({
      where: { correlacaoId: resumo.correlacaoId, mensagem: { contains: 'identificador' } },
    })
    expect(eventos).toHaveLength(1)
    expect(eventos[0]!.mensagem).toContain('3 mensagens')
  })

  it('a mesma mensagem lida de novo (mesma data) continua silenciosa', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const mesmo = { ...email('<mesmo@exemplo.test>'), recebidoEm: new Date('2026-09-16T10:00:00Z') }

    await sincronizar({ banco, ingestao: adapter(async () => [mesmo]).porta, ia: IA }, base.operador)
    await sincronizar({ banco, ingestao: adapter(async () => [mesmo]).porta, ia: IA }, base.operador)

    const eventos = await banco.eventoProcessamento.findMany({ where: { referencia: '<mesmo@exemplo.test>' } })
    expect(eventos).toEqual([])
  })
})
