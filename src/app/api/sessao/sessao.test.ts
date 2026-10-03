import { beforeEach, describe, expect, it, vi } from 'vitest'

import { limparCacheDeAmbiente } from '../../../servidor/ambiente'
import { obterPrisma } from '../../../servidor/prisma'
import { montarCookie } from '../../../servidor/sessao'
import { limparTudo } from '../../../testes/apoio'

/**
 * As duas rotas de `/api/sessao` que respondem SEM sessão, de propósito
 * (`rotas-exigem-sessao.test.ts` as lista como públicas): consultar a sessão e
 * sair. Até aqui só o comentário do arquivo dizia o que elas fazem sem cookie
 * (revisão de segurança do #196). O que se prova:
 *
 * - sem cookie, consultar não vaza nada além de "não autenticado";
 * - sem cookie, sair responde sucesso e não grava nada — não há quem revogar;
 * - com sessão, sair revoga de verdade: o MESMO cookie deixa de valer.
 */

const cookieDaVez = { valor: '' }
const gravados: { maxAge?: number; value?: string }[] = []

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) => (cookieDaVez.valor ? { name: nome, value: cookieDaVez.valor } : undefined),
    set: (opcoes: { maxAge?: number; value?: string }) => {
      gravados.push(opcoes)
    },
    delete: () => {},
  }),
}))

const banco = obterPrisma()

beforeEach(async () => {
  process.env['SESSAO_SECRET'] = 'segredo-de-teste-com-tamanho-suficiente'
  limparCacheDeAmbiente()
  cookieDaVez.valor = ''
  gravados.length = 0
  await limparTudo(banco)
})

describe('/api/sessao sem cookie', () => {
  it('GET diz só que não há sessão', async () => {
    const { GET } = await import('./route')
    const resposta = await GET()
    expect(resposta.status).toBe(200)
    expect(await resposta.json()).toEqual({ sucesso: true, dados: { autenticado: false, colaborador: null }, erro: null })
  })

  it('DELETE responde sucesso, apaga o cookie e não grava nada no banco', async () => {
    const pessoa = await banco.colaborador.create({
      data: { nome: 'Pessoa Sintética', email: 'pessoa-sessao@teste.local', papel: 'colaborador' },
    })
    const { DELETE } = await import('./route')
    const resposta = await DELETE()
    expect(resposta.status).toBe(200)
    expect(((await resposta.json()) as { dados: unknown }).dados).toEqual({ encerrada: true })
    expect(gravados).toEqual([expect.objectContaining({ value: '', maxAge: 0 })])
    const depois = await banco.colaborador.findUniqueOrThrow({ where: { id: pessoa.id } })
    expect(depois.sessoesInvalidasAntes).toBeNull()
  })
})

describe('/api/sessao com sessão', () => {
  it('DELETE revoga de verdade: o mesmo cookie deixa de valer', async () => {
    const pessoa = await banco.colaborador.create({
      data: {
        nome: 'Pessoa Sintética',
        email: 'pessoa-sessao@teste.local',
        papel: 'colaborador',
        senhaDefinidaEm: new Date(),
      },
    })
    cookieDaVez.valor = montarCookie(pessoa.id, 'colaborador', pessoa.senhaDefinidaEm)
    const { DELETE, GET } = await import('./route')

    expect(((await (await GET()).json()) as { dados: { autenticado: boolean } }).dados.autenticado).toBe(true)

    // O carimbo de revogação é comparado ao instante em que o cookie foi
    // emitido; sem esta folga, os dois caem no mesmo milissegundo.
    await new Promise((resolver) => setTimeout(resolver, 5))
    expect((await DELETE()).status).toBe(200)

    const depois = await banco.colaborador.findUniqueOrThrow({ where: { id: pessoa.id } })
    expect(depois.sessoesInvalidasAntes).not.toBeNull()
    // O navegador apagaria o cookie; uma CÓPIA dele, levada da máquina, não vale mais.
    expect(((await (await GET()).json()) as { dados: { autenticado: boolean } }).dados.autenticado).toBe(false)
  })
})
