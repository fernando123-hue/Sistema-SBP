import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { limparCacheDeAmbiente } from '../servidor/ambiente'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo } from '../testes/apoio'
import { DOMINIO_SINTETICO, exigirBaseSintetica } from './base-sintetica'

/**
 * A demo aprova em massa toda revisão pendente da base apontada, e o seed põe
 * gente inventada nela. Antes desta trava, os dois rodavam contra a base da
 * operação sem perguntar (auditoria de 01/10/2026).
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

async function pessoa(endereco: string): Promise<void> {
  await banco.colaborador.create({ data: { nome: 'Pessoa Sintética', email: endereco } })
}

async function email(origem: string, remetente = `alguem${DOMINIO_SINTETICO}`): Promise<void> {
  await banco.email.create({
    data: {
      messageId: `<${origem}-${randomUUID()}>`,
      origem,
      recebidoEm: new Date(),
      conteudo: { create: { remetente, assunto: 'Assunto sintético', corpo: 'Corpo sintético.' } },
    },
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
  limparCacheDeAmbiente()
})

describe('demo e seed só rodam em base sintética', () => {
  it('base vazia passa: é o primeiro seed de quem acabou de clonar', async () => {
    await expect(exigirBaseSintetica(banco, 'o teste')).resolves.toBeUndefined()
  })

  it('base só com o cadastro e os e-mails sintéticos passa: a demo roda depois do seed', async () => {
    await pessoa(`ana${DOMINIO_SINTETICO}`)
    await email('mock')
    await expect(exigirBaseSintetica(banco, 'o teste')).resolves.toBeUndefined()
  })

  // Toda origem que o schema prevê além do dublê (`Email.origem`).
  it.each(['graph', 'imap', 'gmail', 'manual'])('um e-mail de origem "%s" recusa', async (origem) => {
    await pessoa(`ana${DOMINIO_SINTETICO}`)
    await email(origem, 'remetente@outro.example')
    const recusa = await exigirBaseSintetica(banco, 'a demo').catch((erro: unknown) => erro)
    expect((recusa as Error).message).toMatch(/a demo não roda nesta base.*caixa de verdade/)
    expect((recusa as Error).message).not.toMatch(/outro\.example|remetente/)
  })

  it('uma pessoa fora do domínio sintético recusa, sem dizer quem é', async () => {
    await pessoa(`ana${DOMINIO_SINTETICO}`)
    await pessoa('fulana@outro.example')
    const recusa = await exigirBaseSintetica(banco, 'o seed').catch((erro: unknown) => erro)
    expect(recusa).toBeInstanceOf(Error)
    expect((recusa as Error).message).toMatch(/o seed não roda nesta base.*domínio sintético/)
    expect((recusa as Error).message).not.toMatch(/fulana|outro\.example/)
  })

  it('o domínio é o fim do endereço, não um pedaço dele', async () => {
    await pessoa(`ana${DOMINIO_SINTETICO}.outro.example`)
    await expect(exigirBaseSintetica(banco, 'o seed')).rejects.toThrow(/domínio sintético/)
  })

  it('NODE_ENV=production recusa mesmo com a base vazia', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SESSAO_SECRET', 'q8Zr2vN6pW1xT4kL9mB3cF7hJ0sD5gYa')
    vi.stubEnv('BUSCA_SECRET', 'q8Zr2vN6pW1xT4kL9mB3cF7hJ0sD5gYa-busca')
    vi.stubEnv('ANEXOS_SECRET', randomUUID())
    vi.stubEnv('SESSAO_SECRET_ANTERIOR', '')
    vi.stubEnv('INGESTAO_ADAPTER', 'mock')
    vi.stubEnv('IA_ADAPTER', 'mock')
    vi.stubEnv('ACESSO_LOCAL_SEM_SENHA', '')
    limparCacheDeAmbiente()
    await expect(exigirBaseSintetica(banco, 'a demo')).rejects.toThrow(/a demo grava dado sintético e não roda com NODE_ENV=production/)
  })
})

/**
 * A trava só vale se for chamada. Apagar a linha do seed ou da demo deixaria
 * todos os testes acima verdes (revisão técnica do #175): esta varredura não.
 */
describe('a demo e o seed chamam a trava antes de gravar', () => {
  it.each([
    ['scripts/demo.ts', 'a demo'],
    ['prisma/seed.ts', 'o seed'],
  ])('%s', (arquivo, rotina) => {
    const fonte = readFileSync(join(process.cwd(), arquivo), 'utf8')
    const principal = fonte.slice(fonte.indexOf('async function principal'))
    // A primeira coisa depois de abrir o banco, com só comentário no meio.
    expect(principal).toMatch(
      new RegExp(`const banco = obterPrisma\\(\\)\\r?\\n(?:\\s*//.*\\r?\\n)*\\s*await exigirBaseSintetica\\(banco, '${rotina}'\\)`),
    )
  })
})
