import { beforeEach, describe, expect, it } from 'vitest'

import { EmailBrutoSchema } from '../core/esquemas'
import type { AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo, semearBase } from '../testes/apoio'
import { TETO_DE_LIGAS_NOVAS_POR_EMAIL, sincronizar } from './ingestao'

/**
 * Quantas ligas um único e-mail pode criar (achado N-12).
 *
 * ═══ O QUE ESTAVA ABERTO ═══
 *
 * `Liga` nasce de conteúdo externo: o nome vem do corpo do e-mail, passa pela
 * IA e vira linha nova sempre que a grafia normalizada ainda não existe. Sem
 * teto, um e-mail com trinta nomes inventados criava trinta ligas; e como
 * `indiceDeLigas` lê a tabela INTEIRA a cada lote, cada linha plantada
 * encarece toda sincronização seguinte, para sempre. Ninguém precisa de
 * intenção maligna para isso acontecer — basta um e-mail de lista com
 * assinaturas variadas e uma interpretação ruim.
 *
 * ═══ O QUE FOI ESCOLHIDO, E POR QUÊ ═══
 *
 * Teto por E-MAIL, não global: o global pararia a operação no dia em que a
 * associação realmente cadastrasse muitas ligas, e a pergunta "este e-mail
 * sozinho deveria inventar tantas ligas?" é a que separa o caso legítimo do
 * absurdo. Passando do teto, o item **não é descartado** — ele fica sem liga e
 * vai para revisão humana, que é onde a menção pode virar liga de verdade.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

/**
 * Nomes únicos por caso: `limparTudo` não apaga `Liga` (o cadastro base
 * sobrevive entre testes, de propósito), então dois casos que usassem os
 * mesmos nomes reaproveitariam as ligas do primeiro — e o segundo mediria
 * zero criações sem que nada estivesse errado.
 */
function ligantesDeLigasDiferentes(quantas: number, marca: string): AiPort {
  return {
    nome: 'duble',
    interpretar: async () => ({
      itens: Array.from({ length: quantas }, (_, indice) => ({
        categoriaCodigo: 'LIGANTE' as const,
        titulo: `Pessoa Sintética ${indice + 1}`,
        confianca: 0.99,
        campos: {},
        camposAusentes: [],
        ligaMencionada: `Liga Sintética ${marca} Número ${indice + 1}`,
        observacao: null,
      })),
      conteudoSuspeito: false,
      padroesSuspeitos: [],
      modelo: 'duble',
      versaoPrompt: 'teste',
    }),
  }
}

const umEmail: IngestaoPort = {
  nome: 'teste',
  buscarNovos: async () => [
    EmailBrutoSchema.parse({
      messageId: 'muitas-ligas@teste.local',
      remetente: 'contato@exemplo.test',
      assunto: 'Lista com muitos nomes de liga',
      corpo: 'Segue a lista.\n',
      recebidoEm: new Date(),
    }),
  ],
}

describe('teto de ligas novas por e-mail', () => {
  it('um e-mail não cria mais ligas do que o teto, e o que passa disso vai para revisão', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const excedente = 3
    const quantas = TETO_DE_LIGAS_NOVAS_POR_EMAIL + excedente

    const antes = new Set((await banco.liga.findMany({ select: { id: true } })).map((liga) => liga.id))

    await sincronizar({ banco, ingestao: umEmail, ia: ligantesDeLigasDiferentes(quantas, 'do teto') }, base.operador)

    const nascidas = (await banco.liga.findMany({ select: { id: true } })).filter(
      (liga) => !antes.has(liga.id),
    )
    expect(nascidas).toHaveLength(TETO_DE_LIGAS_NOVAS_POR_EMAIL)

    // Nenhum item some: os que passaram do teto ficam sem liga e esperam gente.
    const itens = await banco.item.findMany({ select: { ligaId: true, status: true } })
    expect(itens).toHaveLength(quantas)
    expect(itens.filter((item) => item.ligaId === null)).toHaveLength(excedente)
    // TODO item sem liga espera gente. Hoje quem garante é o desdobramento
    // (mais de um item sempre vai para a revisão); se essa regra mudar, o item
    // barrado passaria aprovado sem ninguém ver o nome da liga — e isto fica
    // vermelho.
    expect(
      itens.filter((item) => item.ligaId === null).every((item) => item.status === 'aguardando_revisao'),
    ).toBe(true)
  })

  it('um e-mail comum, dentro do teto, continua criando as ligas que menciona', async () => {
    // O contraponto: um teto escrito apertado demais quebraria a operação
    // normal, que é justamente criar liga a partir do que chega.
    const base = await semearBase(banco, { totalDeDias: 1 })
    const antes = new Set((await banco.liga.findMany({ select: { id: true } })).map((liga) => liga.id))

    await sincronizar({ banco, ingestao: umEmail, ia: ligantesDeLigasDiferentes(2, 'comum') }, base.operador)

    const nascidas = (await banco.liga.findMany({ select: { id: true } })).filter(
      (liga) => !antes.has(liga.id),
    )
    expect(nascidas).toHaveLength(2)
    expect(await banco.item.count({ where: { ligaId: null } })).toBe(0)
  })

  it('o teto que foi atingido vira evento — alguém precisa poder investigar depois', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    await sincronizar(
      { banco, ingestao: umEmail, ia: ligantesDeLigasDiferentes(TETO_DE_LIGAS_NOVAS_POR_EMAIL + 1, 'do evento') },
      base.operador,
    )

    const evento = await banco.eventoProcessamento.findFirst({
      where: { etapa: 'ingestao', referencia: 'muitas-ligas@teste.local', situacao: 'reprocessavel' },
    })
    expect(evento?.mensagem).toMatch(/liga/i)
  })

  it('exatamente o teto, sem nada barrado, não vira evento', async () => {
    // Três ligas novas num e-mail é o caso legítimo que o teto foi desenhado
    // para não incomodar. Um evento dizendo "menções ficaram sem liga" quando
    // nenhuma ficou seria memória falsa (achado da revisão técnica do PR #89).
    const base = await semearBase(banco, { totalDeDias: 1 })

    await sincronizar(
      { banco, ingestao: umEmail, ia: ligantesDeLigasDiferentes(TETO_DE_LIGAS_NOVAS_POR_EMAIL, 'no limite') },
      base.operador,
    )

    expect(await banco.item.count({ where: { ligaId: null } })).toBe(0)
    expect(
      await banco.eventoProcessamento.count({
        where: { etapa: 'ingestao', referencia: 'muitas-ligas@teste.local', situacao: 'reprocessavel' },
      }),
    ).toBe(0)
  })

  it('menção vazia ou só pontuação não manda o item para a revisão', async () => {
    // Modelo pequeno devolve `"-"` ou `""` em vez de `null` quando o e-mail não
    // fala de liga. Se isso contasse como "menção que ficou sem liga", todo item
    // sem liga iria para a revisão, e a revisão viraria a fila principal. O
    // item com `"-"` tem de sair igual ao item com `null`.
    const base = await semearBase(banco, { totalDeDias: 1 })
    const comMencao = (ligaMencionada: string | null, messageId: string) => ({
      banco,
      ingestao: {
        nome: 'teste',
        buscarNovos: async () => [
          EmailBrutoSchema.parse({
            messageId,
            remetente: 'contato@exemplo.test',
            assunto: 'Cadastro',
            corpo: 'Segue o cadastro.\n',
            recebidoEm: new Date(),
          }),
        ],
      } satisfies IngestaoPort,
      ia: {
        nome: 'duble',
        interpretar: async () => ({
          itens: [
            {
              categoriaCodigo: 'EMAIL_CADASTRO' as const,
              titulo: 'Pessoa Sintética',
              confianca: 0.99,
              campos: {},
              camposAusentes: [],
              ligaMencionada,
              observacao: null,
            },
          ],
          conteudoSuspeito: false,
          padroesSuspeitos: [],
          modelo: 'duble',
          versaoPrompt: 'teste',
        }),
      } satisfies AiPort,
    })

    await sincronizar(comMencao(null, 'sem-mencao@teste.local'), base.operador)
    await sincronizar(comMencao('-', 'mencao-vazia@teste.local'), base.operador)

    const itens = await banco.item.findMany({
      select: { status: true, email: { select: { messageId: true } } },
    })
    const statusDe = (messageId: string) => itens.find((item) => item.email?.messageId === messageId)?.status
    // Sem isto, os dois poderiam ir para a revisão por outro motivo e o teste
    // passaria sem provar nada.
    expect(statusDe('sem-mencao@teste.local')).not.toBe('aguardando_revisao')
    expect(statusDe('mencao-vazia@teste.local')).toBe(statusDe('sem-mencao@teste.local'))
  })
})
