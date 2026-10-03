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
    // Os valores LITERAIS, não `OPCOES_DO_COOKIE` (seria comparar a constante
    // com ela mesma): o navegador só apaga o cookie se nome e caminho forem os
    // do original. `secure` é `false` aqui porque a suíte não roda em produção
    // e o getter lê o ambiente da hora (revisão de segurança do PR).
    expect(gravados).toEqual([
      expect.objectContaining({ name: 'sbp_sessao', path: '/', httpOnly: true, sameSite: 'lax', value: '', maxAge: 0 }),
    ])
    const depois = await banco.colaborador.findUniqueOrThrow({ where: { id: pessoa.id } })
    expect(depois.sessoesInvalidasAntes).toBeNull()
  })

  it('DELETE com cookie forjado com o id de OUTRA pessoa não grava em ninguém', async () => {
    const alvo = await banco.colaborador.create({
      data: { nome: 'Alvo Sintético', email: 'alvo-sessao@teste.local', papel: 'gestor', senhaDefinidaEm: new Date() },
    })
    // Assinado com outro segredo: a assinatura não confere, e `atorAtual` dá null.
    process.env['SESSAO_SECRET'] = 'outro-segredo-qualquer-com-tamanho-suficiente'
    limparCacheDeAmbiente()
    cookieDaVez.valor = montarCookie(alvo.id, 'gestor', alvo.senhaDefinidaEm)
    process.env['SESSAO_SECRET'] = 'segredo-de-teste-com-tamanho-suficiente'
    limparCacheDeAmbiente()

    const { DELETE } = await import('./route')
    expect((await DELETE()).status).toBe(200)
    const depois = await banco.colaborador.findUniqueOrThrow({ where: { id: alvo.id } })
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

    const antes = (await (await GET()).json()) as { dados: { autenticado: boolean; colaborador: object } }
    expect(antes.dados.autenticado).toBe(true)
    // Só estes campos: um refactor para `include` ou um `select` apagado
    // devolveria `senhaHash`, tentativas e o carimbo de revogação.
    expect(Object.keys(antes.dados.colaborador).sort()).toEqual(['email', 'id', 'nome', 'papel', 'precisaTrocarSenha'])

    // O carimbo de revogação é comparado ao instante em que o cookie foi
    // emitido; sem esta folga, os dois caem no mesmo milissegundo.
    await new Promise((resolver) => setTimeout(resolver, 5))
    expect((await DELETE()).status).toBe(200)

    const depois = await banco.colaborador.findUniqueOrThrow({ where: { id: pessoa.id } })
    expect(depois.sessoesInvalidasAntes).not.toBeNull()
    // O navegador apagaria o cookie; uma CÓPIA dele, levada da máquina, não vale mais.
    expect(((await (await GET()).json()) as { dados: { autenticado: boolean } }).dados.autenticado).toBe(false)
  })

  // A rota usa `atorAtual`, e não `exigirAtor`, para que a senha provisória
  // consiga SAIR — e sair de verdade. O status 200 sozinho (testado no #196)
  // não distingue isso de "não havia sessão" (revisão de segurança do PR).
  it('com senha provisória, DELETE também revoga', async () => {
    const pessoa = await banco.colaborador.create({
      data: {
        nome: 'Pessoa Provisória',
        email: 'provisoria-sessao@teste.local',
        papel: 'colaborador',
        precisaTrocarSenha: true,
        senhaDefinidaEm: new Date(),
      },
    })
    cookieDaVez.valor = montarCookie(pessoa.id, 'colaborador', pessoa.senhaDefinidaEm)
    await new Promise((resolver) => setTimeout(resolver, 5))

    const { DELETE } = await import('./route')
    expect((await DELETE()).status).toBe(200)
    const depois = await banco.colaborador.findUniqueOrThrow({ where: { id: pessoa.id } })
    expect(depois.sessoesInvalidasAntes).not.toBeNull()
  })
})
