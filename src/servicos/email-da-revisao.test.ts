import { beforeEach, describe, expect, it } from 'vitest'

import { EmailBrutoSchema } from '../core/esquemas'
import type { AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { obterPrisma } from '../servidor/prisma'
import { atorDeTeste, limparTudo, semearBase } from '../testes/apoio'
import { sincronizar } from './ingestao'
import { lerEmailDaRevisao, listarPendentes, resolver } from './revisao'

/**
 * O e-mail ao lado do que a IA leu, na Revisão (`A69`, 2A).
 *
 * O corpo tem nome e CPF de associado: sai só para quem revisa, só de revisão
 * pendente, como texto, e cada leitura fica na trilha sem o texto. Dados 100%
 * sintéticos.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

const CORPO =
  'Prezados,\nsegue a ficha de CARLA  Teste Sintética, CPF 123.456.789-09.\n' +
  'Arquivo: ‮fdp.exe‬\nObrigada.'

const ingestao: IngestaoPort = {
  nome: 'teste',
  buscarNovos: async () => [
    EmailBrutoSchema.parse({
      messageId: 'email-da-revisao@teste.local',
      remetente: 'associado@exemplo.test',
      assunto: 'Ficha sintética',
      corpo: CORPO,
      recebidoEm: new Date('2026-09-01T12:00:00Z'),
    }),
  ],
}

/** Confiança baixa e o nome faltando na lista de ausentes: o item vai para revisão apontando `nome`. */
const ia: AiPort = {
  nome: 'duble',
  interpretar: async () => ({
    itens: [
      {
        categoriaCodigo: 'DOC_CADASTRO' as const,
        titulo: 'Ficha sintética',
        confianca: 0.3,
        campos: { nome: 'Carla Teste Sintética' },
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

async function umaRevisaoPendente() {
  const base = await semearBase(banco, { totalDeDias: 1 })
  await sincronizar({ banco, ingestao, ia }, base.operador)
  const { itens } = await listarPendentes(banco, 10)
  expect(itens).toHaveLength(1)
  const pendente = itens[0]!
  // O campo apontado é decidido na ingestão; aqui ele é fixado para o teste
  // não depender de qual problema a conferência acha primeiro.
  await banco.revisao.update({ where: { id: pendente.revisaoId }, data: { campoIncerto: 'nome' } })
  return { base, pendente }
}

describe('lerEmailDaRevisao', () => {
  it('devolve o corpo como texto, com o trecho do campo apontado marcado', async () => {
    const { base, pendente } = await umaRevisaoPendente()

    const email = await lerEmailDaRevisao(banco, pendente.revisaoId, base.operador)

    expect(email.situacao).toBe('disponivel')
    if (email.situacao !== 'disponivel') return
    expect(email.remetente).toBe('associado@exemplo.test')
    expect(email.assunto).toBe('Ficha sintética')
    expect(email.campo).toBe('nome')
    expect(email.trecho).not.toBeNull()
    expect(email.corpo.slice(email.trecho!.inicio, email.trecho!.fim)).toBe('CARLA  Teste Sintética')
  })

  it('tira os controles de direção, que fariam a tela desenhar outra coisa', async () => {
    const { base, pendente } = await umaRevisaoPendente()

    const email = await lerEmailDaRevisao(banco, pendente.revisaoId, base.operador)

    if (email.situacao !== 'disponivel') throw new Error('esperava o e-mail disponível')
    expect(email.corpo).not.toMatch(/[‪-‮]/)
    expect(email.corpo).toContain('�')
  })

  it('valor que não está no e-mail fica sem trecho, e não com um trecho parecido', async () => {
    const { base, pendente } = await umaRevisaoPendente()
    await banco.revisao.update({
      where: { id: pendente.revisaoId },
      data: { sugestaoIa: JSON.stringify({ campos: { nome: 'Carlos Outro Nome' }, ligaMencionada: null }) },
    })

    const email = await lerEmailDaRevisao(banco, pendente.revisaoId, base.operador)

    if (email.situacao !== 'disponivel') throw new Error('esperava o e-mail disponível')
    expect(email.trecho).toBeNull()
    expect(email.campo).toBe('nome')
  })

  it('cada leitura fica na trilha, com quem leu e qual e-mail, e sem o texto', async () => {
    const { base, pendente } = await umaRevisaoPendente()

    await lerEmailDaRevisao(banco, pendente.revisaoId, base.operador)

    const linhas = await banco.logAuditoria.findMany({ where: { acao: 'email_lido_na_revisao' } })
    expect(linhas).toHaveLength(1)
    expect(linhas[0]!.usuario).toBe(base.operador.colaboradorId)
    expect(linhas[0]!.entidade).toBe('Email')
    const gravado = JSON.stringify(linhas[0])
    expect(gravado).not.toContain('Carla')
    expect(gravado).not.toContain('123.456')
  })

  it('colaborador não lê o e-mail, e a recusa não deixa leitura na trilha', async () => {
    const { base, pendente } = await umaRevisaoPendente()
    const colaborador = base.colaboradores[0]!.ator

    await expect(lerEmailDaRevisao(banco, pendente.revisaoId, colaborador)).rejects.toThrow()

    expect(await banco.logAuditoria.count({ where: { acao: 'email_lido_na_revisao' } })).toBe(0)
  })

  it('gestor lê', async () => {
    const { pendente } = await umaRevisaoPendente()
    const gestor = await banco.colaborador.create({
      data: { nome: 'Gestora Sintética', email: 'gestora@teste.local', papel: 'gestor' },
    })

    const email = await lerEmailDaRevisao(banco, pendente.revisaoId, atorDeTeste(gestor.id, 'gestor'))

    expect(email.situacao).toBe('disponivel')
  })

  it('revisão resolvida não é caminho para ler e-mail antigo', async () => {
    const { base, pendente } = await umaRevisaoPendente()
    await resolver(
      banco,
      {
        revisaoId: pendente.revisaoId,
        categoriaCodigo: pendente.categoriaCodigo,
        titulo: pendente.titulo,
        campos: {},
        aprovar: true,
      },
      base.operador,
    )

    await expect(lerEmailDaRevisao(banco, pendente.revisaoId, base.operador)).rejects.toThrow(/já foi resolvida/)
  })

  it('revisão inexistente é recusada', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    await expect(lerEmailDaRevisao(banco, 'nao-existe', base.operador)).rejects.toThrow(/não foi encontrada/)
  })

  it('conteúdo expurgado pela retenção diz que foi expurgado, e quando (invariante 11)', async () => {
    const { base, pendente } = await umaRevisaoPendente()
    const item = await banco.item.findUniqueOrThrow({ where: { id: pendente.itemId } })
    const quando = new Date('2026-09-20T03:00:00Z')
    await banco.emailConteudo.delete({ where: { emailId: item.emailId! } })
    await banco.email.update({ where: { id: item.emailId! }, data: { conteudoExpurgadoEm: quando } })

    const email = await lerEmailDaRevisao(banco, pendente.revisaoId, base.operador)

    expect(email).toEqual({ situacao: 'expurgado', expurgadoEm: quando.toISOString() })
    expect(await banco.logAuditoria.count({ where: { acao: 'email_lido_na_revisao' } })).toBe(0)
  })

  it('conteúdo sumido SEM carimbo de expurgo falha alto, em vez de fingir expurgo (invariante 7)', async () => {
    const { base, pendente } = await umaRevisaoPendente()
    const item = await banco.item.findUniqueOrThrow({ where: { id: pendente.itemId } })
    await banco.emailConteudo.delete({ where: { emailId: item.emailId! } })

    await expect(lerEmailDaRevisao(banco, pendente.revisaoId, base.operador)).rejects.toThrow(
      /sem conteúdo e sem carimbo de expurgo/,
    )
  })

  it('item registrado à mão diz que não há e-mail', async () => {
    const { base, pendente } = await umaRevisaoPendente()
    await banco.item.update({ where: { id: pendente.itemId }, data: { emailId: null } })

    expect(await lerEmailDaRevisao(banco, pendente.revisaoId, base.operador)).toEqual({ situacao: 'sem_email' })
  })
})
