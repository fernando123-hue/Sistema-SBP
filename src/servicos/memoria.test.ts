import { beforeEach, describe, expect, it } from 'vitest'

import { DOMINIO_ATUAL } from '../core/esquemas'
import { rota } from '../servidor/http'
import { obterPrisma } from '../servidor/prisma'
import { registrarEvento } from '../servidor/observabilidade'
import { atorDeTeste, limparTudo, semearBase } from '../testes/apoio'
import { auditar } from './auditoria'
import { registrarManual } from './itens'
import { porCorrelacao, porEntidade } from './memoria'

/**
 * Memória consultável.
 *
 * Estes testes protegem duas coisas diferentes. A primeira é óbvia: que a
 * consulta devolve o que foi gravado. A segunda é a que importa — que a
 * memória **nasce identificada por domínio**. Enquanto a trilha é append-only
 * por invariante, uma linha gravada sem domínio não pode ser corrigida depois
 * sem fazer justamente a escrita que o projeto promete nunca fazer.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

describe('identidade de domínio', () => {
  it('toda linha de auditoria nasce com o domínio deste sistema', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    await registrarManual(
      banco,
      {
        categoriaCodigo: 'INADIMP',
        titulo: 'Inadimplente',
        colaboradorId: base.colaboradores[0]!.id,
      },
      base.operador,
    )

    const linhas = await banco.logAuditoria.findMany()
    expect(linhas.length).toBeGreaterThan(0)
    expect(linhas.every((linha) => linha.dominio === DOMINIO_ATUAL)).toBe(true)
  })

  it('todo evento de processamento nasce com o domínio deste sistema', async () => {
    await registrarEvento(banco, {
      correlacaoId: 'corr-1',
      etapa: 'ingestao',
      situacao: 'sucesso',
    })

    const evento = await banco.eventoProcessamento.findFirstOrThrow()
    expect(evento.dominio).toBe(DOMINIO_ATUAL)
  })

  it('memória de outro domínio não vaza para a consulta deste', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    await auditar(banco, {
      entidade: 'Item',
      entidadeId: 'item-1',
      acao: 'concluido',
      usuario: base.operadorId,
      correlacaoId: 'corr-compartilhada',
    })

    // Uma linha que um segundo sistema teria escrito. Sem a coluna de domínio,
    // as duas histórias se somariam numa consulta e ninguém notaria.
    await banco.logAuditoria.create({
      data: {
        dominio: 'documentos',
        entidade: 'Documento',
        entidadeId: 'doc-1',
        acao: 'analisado',
        usuario: base.operadorId,
        correlacaoId: 'corr-compartilhada',
      },
    })

    const lembrancas = await porCorrelacao(banco, 'corr-compartilhada', base.operador)

    expect(lembrancas).toHaveLength(1)
    expect(lembrancas[0]!.entidade).toBe('Item')
  })
})

describe('consulta por correlação', () => {
  it('costura auditoria e evento na ordem em que aconteceram', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const correlacaoId = 'corr-ciclo'

    await registrarEvento(banco, {
      correlacaoId,
      etapa: 'ingestao',
      situacao: 'iniciado',
      mensagem: 'começou',
    })
    await auditar(banco, {
      entidade: 'Email',
      entidadeId: 'email-1',
      acao: 'ingerido',
      usuario: base.operadorId,
      correlacaoId,
    })
    await registrarEvento(banco, {
      correlacaoId,
      etapa: 'ingestao',
      situacao: 'sucesso',
      mensagem: 'terminou',
    })

    const lembrancas = await porCorrelacao(banco, correlacaoId, base.operador)

    expect(lembrancas.map((l) => l.o_que)).toEqual([
      'ingestao/iniciado',
      'ingerido',
      'ingestao/sucesso',
    ])
    // Ordem crescente: quem investiga lê causa e efeito do começo para o fim.
    const instantes = lembrancas.map((l) => l.instante.getTime())
    expect([...instantes].sort((a, b) => a - b)).toEqual(instantes)
  })

  it('a falha de rota deixa de existir só no stdout', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    // É o que `http.ts` grava num 500, junto do id que entrega ao usuário
    // dizendo que ele "permite rastrear a falha". Antes disto, esse id não
    // estava em tabela nenhuma — a promessa da mensagem de erro era falsa.
    await registrarEvento(banco, {
      correlacaoId: 'corr-500',
      etapa: 'rota',
      situacao: 'falha',
      mensagem: 'Erro inesperado',
    })

    const lembrancas = await porCorrelacao(banco, 'corr-500', base.operador)

    expect(lembrancas).toHaveLength(1)
    expect(lembrancas[0]!.o_que).toBe('rota/falha')
    expect(lembrancas[0]!.mensagem).toBe('Erro inesperado')
  })

  it('o id que o 500 entrega ao usuário resolve de verdade — ponta a ponta', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    // Uma rota que estoura, como qualquer defeito não previsto em produção.
    const resposta = await rota(async () => {
      throw new Error('defeito inesperado no servidor')
    })
    expect(resposta.status).toBe(500)

    const corpo = (await resposta.json()) as { correlacaoId?: string; erro: string }
    expect(corpo.erro).toContain('rastrear a falha')
    expect(corpo.correlacaoId).toBeTruthy()

    // ESTE é o teste que faltava existir. A mensagem acima promete que o
    // identificador permite rastrear a falha; até agora ele era sorteado,
    // entregue e gravado só em stdout — nenhuma tabela o continha e nenhuma
    // rota o buscava. A promessa e a entrega passam a ser a mesma coisa.
    const lembrancas = await porCorrelacao(banco, corpo.correlacaoId!, base.operador)

    expect(lembrancas).toHaveLength(1)
    expect(lembrancas[0]!.o_que).toBe('rota/falha')
    expect(lembrancas[0]!.mensagem).toBe('defeito inesperado no servidor')
  })

  it('correlação sem nada devolve lista vazia, não erro', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    expect(await porCorrelacao(banco, 'corr-que-nao-existe', base.operador)).toEqual([])
  })
})

describe('consulta por entidade', () => {
  it('devolve a história de um item, com antes e depois desserializados', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    const feito = await registrarManual(
      banco,
      {
        categoriaCodigo: 'INADIMP',
        titulo: 'Inadimplente',
        colaboradorId: base.colaboradores[0]!.id,
      },
      base.operador,
    )
    const itemId = feito.itensCriados[0]!

    const lembrancas = await porEntidade(banco, 'Item', itemId, base.operador)

    expect(lembrancas).toHaveLength(1)
    expect(lembrancas[0]!.o_que).toBe('item_registrado_manualmente')
    expect(lembrancas[0]!.usuario).toBe(base.operadorId)
    // JSON gravado volta como objeto, não como texto: quem investiga não
    // deveria precisar de `JSON.parse` na mão para ler a própria trilha.
    expect((lembrancas[0]!.depois as { titulo: string }).titulo).toBe('Inadimplente')
  })

  it('JSON ilegível desfalca a linha sem derrubar a consulta', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    await banco.logAuditoria.create({
      data: {
        entidade: 'Item',
        entidadeId: 'item-torto',
        acao: 'concluido',
        usuario: base.operadorId,
        depois: '{isto não é JSON',
      },
    })

    // Investigar uma falha é justamente quando uma linha corrompida não pode
    // impedir de ver as outras.
    const lembrancas = await porEntidade(banco, 'Item', 'item-torto', base.operador)
    expect(lembrancas).toHaveLength(1)
    expect(lembrancas[0]!.depois).toBeNull()
  })
})

describe('quem pode consultar', () => {
  it('colaborador não lê a trilha — ela carrega quem fez o quê sobre todo mundo', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!

    await expect(porCorrelacao(banco, 'qualquer', pessoa.ator)).rejects.toThrow(/papel|permissão/i)
    await expect(porEntidade(banco, 'Item', 'x', pessoa.ator)).rejects.toThrow(/papel|permissão/i)
  })

  it('gestor lê', async () => {
    await semearBase(banco, { totalDeDias: 1 })
    const gestor = await banco.colaborador.create({
      data: { nome: 'Gestora de Teste', email: 'gestora@teste.local', papel: 'gestor' },
    })

    await expect(
      porCorrelacao(banco, 'qualquer', atorDeTeste(gestor.id, 'gestor')),
    ).resolves.toEqual([])
  })
})
