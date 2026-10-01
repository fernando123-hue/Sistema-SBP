import { beforeEach, describe, expect, it } from 'vitest'

import { EmailBrutoSchema } from '../core/esquemas'
import type { AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo, semearBase } from '../testes/apoio'
import { sincronizar } from './ingestao'
import { listarPendentes, resolver, resolverEmailDaRevisao } from './revisao'

/**
 * Um cartão por e-mail na Revisão (`A69`, 1A).
 *
 * Uma lista de ligantes vira N itens, e cada um ia para a Revisão com o
 * formulário inteiro. A decisão real é uma só — "estes N nomes são os que o
 * e-mail pede?" —, e agora ela é tomada de uma vez: tirar, corrigir e
 * acrescentar nomes antes, e "Aprovar os N". No banco continua sendo revisão
 * a revisão, com a mesma trilha e a mesma medida de acerto da IA.
 *
 * Dados 100% sintéticos (invariante 8).
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

const NOMES = ['Diego Sintético Lima', 'Henrique Sintético Vilela', 'Isabela Sintética Rangel']

function ingestaoCom(...emails: { id: string; corpo: string }[]): IngestaoPort {
  return {
    nome: 'teste',
    buscarNovos: async () =>
      emails.map((email) =>
        EmailBrutoSchema.parse({
          messageId: email.id,
          remetente: 'secretaria.liga@exemplo.test',
          assunto: 'Inclusão de ligantes',
          corpo: email.corpo,
          recebidoEm: new Date('2026-09-01T12:00:00Z'),
        }),
      ),
  }
}

/** A IA separa cada e-mail em um item por nome: o desdobramento manda todos para a Revisão. */
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

const CORPO = `Prezados, incluir na liga: ${NOMES.join(', ')}.`

async function umaListaNaRevisao(quantosEmails = 1) {
  const base = await semearBase(banco, { totalDeDias: 1 })
  const emails = Array.from({ length: quantosEmails }, (_, posicao) => ({ id: `lista-${posicao}@teste.local`, corpo: CORPO }))
  await sincronizar({ banco, ingestao: ingestaoCom(...emails), ia }, base.operador)
  const { itens } = await listarPendentes(banco, 100)
  return { base, itens }
}

function decisaoDe(itens: Awaited<ReturnType<typeof umaListaNaRevisao>>['itens']) {
  return itens.map((item) => ({ revisaoId: item.revisaoId, titulo: item.titulo, campos: {}, aprovar: true }))
}

describe('listarPendentes diz de que e-mail é cada revisão', () => {
  it('traz o emailId e quantas revisões do e-mail estão pendentes, mesmo com a lista cortada', async () => {
    const { itens } = await umaListaNaRevisao()
    expect(itens).toHaveLength(3)
    expect(new Set(itens.map((item) => item.emailId)).size).toBe(1)
    expect(itens.every((item) => item.pendentesNoEmail === 3)).toBe(true)

    // Lista cortada em 2: o cartão do e-mail não pode fingir que tem tudo.
    const cortada = await listarPendentes(banco, 2)
    expect(cortada.itens.every((item) => item.pendentesNoEmail === 3)).toBe(true)
  })
})

describe('resolverEmailDaRevisao (1A)', () => {
  it('aprova, corrige, tira e acrescenta numa decisão só, revisão a revisão no banco', async () => {
    const { base, itens } = await umaListaNaRevisao()
    const [primeiro, segundo, terceiro] = itens
    const emailId = primeiro!.emailId!

    const feito = await resolverEmailDaRevisao(
      banco,
      {
        emailId,
        revisoes: [
          { revisaoId: primeiro!.revisaoId, titulo: primeiro!.titulo, campos: {}, aprovar: true },
          { revisaoId: segundo!.revisaoId, titulo: 'Inclusão de ligante — Henrique S. Vilela', campos: { nome: 'Henrique S. Vilela' }, aprovar: true },
          { revisaoId: terceiro!.revisaoId, titulo: terceiro!.titulo, campos: {}, aprovar: false },
        ],
        novos: [{ titulo: 'Inclusão de ligante — Joana Sintética', campos: { nome: 'Joana Sintética' } }],
      },
      base.operador,
    )

    expect(feito).toEqual({ aprovados: 2, descartados: 1, criados: 1 })
    const revisoes = await banco.revisao.findMany({ where: { itemId: { in: itens.map((item) => item.itemId) } } })
    expect(revisoes.every((revisao) => revisao.resolvidoEm !== null && revisao.resolvidoPor === base.operadorId)).toBe(true)
    const doEmail = await banco.item.findMany({ where: { emailId }, orderBy: { sequencia: 'asc' } })
    expect(doEmail).toHaveLength(4)
    expect(doEmail.filter((item) => item.status === 'aprovado')).toHaveLength(3)
    expect(doEmail.filter((item) => item.status === 'cancelado')).toHaveLength(1)
    expect(doEmail.find((item) => item.id === segundo!.itemId)!.titulo).toBe('Inclusão de ligante — Henrique S. Vilela')
    // A pessoa acrescentada nasce aprovada, no mesmo e-mail, com sequência nova.
    const novo = doEmail.find((item) => item.titulo.includes('Joana'))!
    expect(novo.status).toBe('aprovado')
    expect(new Set(doEmail.map((item) => item.sequencia)).size).toBe(4)

    // A trilha é a de sempre, uma linha por decisão, numa correlação só.
    const trilha = await banco.logAuditoria.findMany({
      where: { acao: { in: ['revisao_aprovada', 'revisao_recusada', 'item_criado_por_divisao_de_revisao'] } },
    })
    expect(trilha.filter((linha) => linha.acao === 'revisao_aprovada')).toHaveLength(2)
    expect(trilha.filter((linha) => linha.acao === 'revisao_recusada')).toHaveLength(1)
    expect(trilha.filter((linha) => linha.acao === 'item_criado_por_divisao_de_revisao')).toHaveLength(1)
    expect(new Set(trilha.map((linha) => linha.correlacaoId)).size).toBe(1)
    expect(trilha.map((linha) => `${linha.antes ?? ''}${linha.depois ?? ''}`).join('')).not.toContain('Henrique')
  })

  it('descartar o e-mail inteiro cancela todos', async () => {
    const { base, itens } = await umaListaNaRevisao()

    const feito = await resolverEmailDaRevisao(
      banco,
      { emailId: itens[0]!.emailId!, revisoes: decisaoDe(itens).map((linha) => ({ ...linha, aprovar: false })), novos: [] },
      base.operador,
    )

    expect(feito).toEqual({ aprovados: 0, descartados: 3, criados: 0 })
    expect(await banco.item.count({ where: { status: 'cancelado' } })).toBe(3)
  })

  // Tudo ou nada: a decisão foi sobre os N nomes que a tela mostrou. Se a
  // fila do e-mail mudou, nenhuma revisão é resolvida.
  it('faltar uma revisão do e-mail recusa tudo', async () => {
    const { base, itens } = await umaListaNaRevisao()

    await expect(
      resolverEmailDaRevisao(banco, { emailId: itens[0]!.emailId!, revisoes: decisaoDe(itens).slice(0, 2), novos: [] }, base.operador),
    ).rejects.toThrow('Nada foi decidido')
    expect(await banco.revisao.count({ where: { resolvidoEm: { not: null } } })).toBe(0)
  })

  it('revisão já resolvida por outra pessoa recusa tudo', async () => {
    const { base, itens } = await umaListaNaRevisao()
    await resolver(
      banco,
      { revisaoId: itens[0]!.revisaoId, categoriaCodigo: 'LIGANTE', titulo: itens[0]!.titulo, campos: {}, aprovar: true },
      base.operador,
    )

    await expect(
      resolverEmailDaRevisao(banco, { emailId: itens[0]!.emailId!, revisoes: decisaoDe(itens), novos: [] }, base.operador),
    ).rejects.toThrow('Nada foi decidido')
    expect(await banco.revisao.count({ where: { resolvidoEm: { not: null } } })).toBe(1)
  })

  it('revisão de outro e-mail recusa tudo', async () => {
    const { base, itens } = await umaListaNaRevisao(2)
    const emailId = itens[0]!.emailId!
    const doOutro = itens.find((item) => item.emailId !== emailId)!
    const doMesmo = itens.filter((item) => item.emailId === emailId)

    await expect(
      resolverEmailDaRevisao(banco, { emailId, revisoes: decisaoDe([...doMesmo, doOutro]), novos: [] }, base.operador),
    ).rejects.toThrow('Nada foi decidido')
    expect(await banco.revisao.count({ where: { resolvidoEm: { not: null } } })).toBe(0)
  })

  it('revisão repetida na lista é recusada', async () => {
    const { base, itens } = await umaListaNaRevisao()
    const linhas = decisaoDe(itens)

    await expect(
      resolverEmailDaRevisao(banco, { emailId: itens[0]!.emailId!, revisoes: [...linhas, linhas[0]!], novos: [] }, base.operador),
    ).rejects.toThrow()
    expect(await banco.revisao.count({ where: { resolvidoEm: { not: null } } })).toBe(0)
  })

  // A revisão existe para o caso de segurança: e-mail que tentou dar ordens
  // continua decidido item a item, olhando cada um.
  it('e-mail com conteúdo suspeito não é decidido de uma vez', async () => {
    const { base, itens } = await umaListaNaRevisao()
    await banco.email.update({ where: { id: itens[0]!.emailId! }, data: { conteudoSuspeito: true } })

    await expect(
      resolverEmailDaRevisao(banco, { emailId: itens[0]!.emailId!, revisoes: decisaoDe(itens), novos: [] }, base.operador),
    ).rejects.toThrow('item a item')
    expect(await banco.revisao.count({ where: { resolvidoEm: { not: null } } })).toBe(0)
  })

  it('revisão que aponta um valor para conferir tira o e-mail do cartão', async () => {
    const { base, itens } = await umaListaNaRevisao()
    await banco.revisao.update({ where: { id: itens[1]!.revisaoId }, data: { motivo: 'cpf_invalido' } })

    await expect(
      resolverEmailDaRevisao(banco, { emailId: itens[0]!.emailId!, revisoes: decisaoDe(itens), novos: [] }, base.operador),
    ).rejects.toThrow('item a item')
    expect(await banco.revisao.count({ where: { resolvidoEm: { not: null } } })).toBe(0)
  })

  // O achado Alto da revisão de segurança do #167: numa lista, o motivo é
  // sempre `desdobramento`, e o CPF que não fechou fica só no campo apontado.
  it('campo apontado com valor para conferir tira o e-mail do cartão, mesmo com motivo desdobramento', async () => {
    const { base, itens } = await umaListaNaRevisao()
    await banco.revisao.update({ where: { id: itens[1]!.revisaoId }, data: { campoIncerto: 'nome' } })

    await expect(
      resolverEmailDaRevisao(banco, { emailId: itens[0]!.emailId!, revisoes: decisaoDe(itens), novos: [] }, base.operador),
    ).rejects.toThrow('item a item')
    expect(await banco.revisao.count({ where: { resolvidoEm: { not: null } } })).toBe(0)
  })

  it('campo apontado que faltou não tira o e-mail do cartão', async () => {
    const { base, itens } = await umaListaNaRevisao()
    await banco.revisao.update({ where: { id: itens[1]!.revisaoId }, data: { campoIncerto: 'crm' } })

    const feito = await resolverEmailDaRevisao(banco, { emailId: itens[0]!.emailId!, revisoes: decisaoDe(itens), novos: [] }, base.operador)
    expect(feito.aprovados).toBe(3)
  })

  // A medida de acerto da IA é a mesma da decisão avulsa (`A23(c)`).
  it('grava valorFinal e acerto da IA em cada revisão, como a decisão avulsa', async () => {
    const { base, itens } = await umaListaNaRevisao()
    await resolverEmailDaRevisao(banco, { emailId: itens[0]!.emailId!, revisoes: decisaoDe(itens), novos: [] }, base.operador)

    const revisoes = await banco.revisao.findMany()
    expect(revisoes.every((revisao) => revisao.valorFinal !== null && revisao.desfecho !== null)).toBe(true)
  })

  // A decisão avulsa e o cartão no mesmo e-mail, ao mesmo tempo: uma vence
  // inteira, a outra é recusada inteira. Nunca metade de cada.
  it('corrida com a decisão avulsa: só uma vence', async () => {
    const { base, itens } = await umaListaNaRevisao()

    const resultados = await Promise.allSettled([
      resolverEmailDaRevisao(
        banco,
        { emailId: itens[0]!.emailId!, revisoes: decisaoDe(itens).map((linha) => ({ ...linha, aprovar: false })), novos: [] },
        base.operador,
      ),
      resolver(
        banco,
        { revisaoId: itens[0]!.revisaoId, categoriaCodigo: 'LIGANTE', titulo: itens[0]!.titulo, campos: {}, aprovar: true },
        base.operador,
      ),
    ])

    expect(resultados.filter((resultado) => resultado.status === 'fulfilled')).toHaveLength(1)
    const resolvidas = await banco.revisao.count({ where: { resolvidoEm: { not: null } } })
    // O cartão venceu: as 3 resolvidas por ele. A avulsa venceu: só ela.
    expect(resolvidas).toBe(resultados[0]!.status === 'fulfilled' ? 3 : 1)
  })

  it('acrescentar gente sem aprovar ninguém é recusado', async () => {
    const { base, itens } = await umaListaNaRevisao()

    await expect(
      resolverEmailDaRevisao(
        banco,
        {
          emailId: itens[0]!.emailId!,
          revisoes: decisaoDe(itens).map((linha) => ({ ...linha, aprovar: false })),
          novos: [{ titulo: 'Inclusão de ligante — Joana Sintética', campos: {} }],
        },
        base.operador,
      ),
    ).rejects.toThrow('aprove pelo menos um')
    expect(await banco.revisao.count({ where: { resolvidoEm: { not: null } } })).toBe(0)
  })

  it('colaborador não decide revisão', async () => {
    const { base, itens } = await umaListaNaRevisao()

    await expect(
      resolverEmailDaRevisao(banco, { emailId: itens[0]!.emailId!, revisoes: decisaoDe(itens), novos: [] }, base.colaboradores[0]!.ator),
    ).rejects.toThrow()
    expect(await banco.revisao.count({ where: { resolvidoEm: { not: null } } })).toBe(0)
  })

  // Invariante 5: quem decide vem do Ator, e o corpo não carrega "quem".
  it('corpo com campo a mais é recusado', async () => {
    const { base, itens } = await umaListaNaRevisao()

    await expect(
      resolverEmailDaRevisao(
        banco,
        { emailId: itens[0]!.emailId!, revisoes: decisaoDe(itens), novos: [], resolvidoPor: base.colaboradores[0]!.id },
        base.operador,
      ),
    ).rejects.toThrow()
  })
})
