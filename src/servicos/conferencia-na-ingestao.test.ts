import { beforeEach, describe, expect, it } from 'vitest'

import { EmailBrutoSchema, type ItemExtraido } from '../core/esquemas'
import type { AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo, semearBase } from '../testes/apoio'
import { sincronizar } from './ingestao'

/**
 * A conferência do que a IA extraiu, na ingestão (pendência 17, `§ H.4` 40).
 *
 * Antes, um item com confiança acima do limiar e sem campo faltando entrava
 * APROVADO mesmo com um valor que não está no e-mail — o nome reescrito, o
 * CPF com dígito trocado. A confiança é a própria IA que dá. Agora o código
 * confere cada valor contra o texto, e o que não bate vai para uma pessoa,
 * com o campo apontado.
 *
 * Dados 100% sintéticos (invariante 8); `111.444.777-35` é o CPF público de teste.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

const CORPO = 'Segue minha ficha para atualização cadastral.\nNome: Fulana Sintética\nCPF: 111.444.777-35'

function email(messageId: string, corpo = CORPO): IngestaoPort {
  return {
    nome: 'teste',
    buscarNovos: async () => [
      EmailBrutoSchema.parse({
        messageId,
        remetente: 'fulana@exemplo.test',
        assunto: 'Atualização cadastral',
        corpo,
        recebidoEm: new Date(),
      }),
    ],
  }
}

/** Uma IA que devolve exatamente estes itens, com confiança alta e nada faltando. */
function iaQueDevolve(...itens: Partial<ItemExtraido>[]): AiPort {
  return {
    nome: 'duble',
    interpretar: async () => ({
      itens: itens.map((item) => ({
        categoriaCodigo: 'FICHA_CADASTRO' as const,
        titulo: 'Atualização cadastral',
        confianca: 0.99,
        campos: {},
        camposAusentes: [],
        ligaMencionada: null,
        observacao: null,
        ...item,
      })),
      conteudoSuspeito: false,
      padroesSuspeitos: [],
      modelo: 'duble',
      versaoPrompt: 'teste',
    }),
  }
}

async function revisaoDoUnicoItem() {
  const itens = await banco.item.findMany({ select: { status: true, revisoes: { select: { motivo: true, campoIncerto: true } } } })
  expect(itens).toHaveLength(1)
  return { status: itens[0]!.status, revisao: itens[0]!.revisoes[0] ?? null }
}

describe('conferência do que a IA extraiu, na ingestão', () => {
  it('extração literal e confiança alta: o item entra aprovado, como antes', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    await sincronizar(
      {
        banco,
        ingestao: email('literal@teste.local'),
        ia: iaQueDevolve({ campos: { nome: 'FULANA SINTETICA', cpf: '11144477735' } }),
      },
      base.operador,
    )
    expect(await revisaoDoUnicoItem()).toEqual({ status: 'aprovado', revisao: null })
  })

  it('nome que não está no e-mail vai para a Revisão, apontando o campo', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    await sincronizar(
      {
        banco,
        ingestao: email('nome-reescrito@teste.local'),
        ia: iaQueDevolve({ campos: { nome: 'Fulana de Tal Sintética', cpf: '111.444.777-35' } }),
      },
      base.operador,
    )
    expect(await revisaoDoUnicoItem()).toEqual({
      status: 'aguardando_revisao',
      revisao: { motivo: 'valor_fora_do_texto', campoIncerto: 'nome' },
    })
  })

  it('CPF com dígito que não confere vai para a Revisão, mesmo copiado do e-mail', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    await sincronizar(
      {
        banco,
        ingestao: email('cpf-errado@teste.local', 'Nome: Fulana Sintética\nCPF: 111.444.777-36'),
        ia: iaQueDevolve({ campos: { nome: 'Fulana Sintética', cpf: '111.444.777-36' } }),
      },
      base.operador,
    )
    expect(await revisaoDoUnicoItem()).toEqual({
      status: 'aguardando_revisao',
      revisao: { motivo: 'cpf_invalido', campoIncerto: 'cpf' },
    })
  })

  it('liga que o e-mail não menciona vai para a Revisão', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    await sincronizar(
      {
        banco,
        ingestao: email('liga-inventada@teste.local'),
        ia: iaQueDevolve({
          categoriaCodigo: 'EMAIL_LIGA',
          campos: { nome: 'Fulana Sintética' },
          ligaMencionada: 'Liga Sintética Que Ninguém Citou',
        }),
      },
      base.operador,
    )
    expect(await revisaoDoUnicoItem()).toEqual({
      status: 'aguardando_revisao',
      revisao: { motivo: 'valor_fora_do_texto', campoIncerto: 'liga' },
    })
  })

  it('conteúdo suspeito continua vindo primeiro: é o motivo que a pessoa precisa ler antes', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const ia = iaQueDevolve({ campos: { nome: 'Nome Inventado' } })
    await sincronizar(
      {
        banco,
        ingestao: email('suspeito@teste.local'),
        ia: {
          ...ia,
          interpretar: async (bruto) => ({ ...(await ia.interpretar(bruto)), conteudoSuspeito: true }),
        },
      },
      base.operador,
    )
    const { revisao } = await revisaoDoUnicoItem()
    expect(revisao?.motivo).toBe('conteudo_suspeito')
  })
})
