import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { limparCacheDeAmbiente } from '../../../../servidor/ambiente'
import { obterPrisma } from '../../../../servidor/prisma'
import {
  SenhaProvisoriaError,
  exigirAtor,
  montarCookie,
  perfilAtual,
} from '../../../../servidor/sessao'
import { limparTudo } from '../../../../testes/apoio'
import { GET, POST } from './route'

/**
 * A rota do acesso local sem senha, ponta a ponta com o banco.
 *
 * O duble de `next/headers` GUARDA o cookie que a rota entrega e o devolve nas
 * leituras seguintes — é assim que o teste confere a sessão com o MESMO
 * `perfilAtual` que as telas usam, em vez de supor que ela funciona.
 */

const jarra = { valor: '' }

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) => (jarra.valor ? { name: nome, value: jarra.valor } : undefined),
    set: (opcoes: { value: string }) => {
      jarra.valor = opcoes.value
    },
    delete: () => {},
  }),
}))

const banco = obterPrisma()
const URL_LOCAL = 'http://localhost:3000/api/sessao/local'
const URL_DA_REDE = 'http://192.168.0.10:3000/api/sessao/local'

function ligarAcessoLocal(ligado: boolean): void {
  process.env['ACESSO_LOCAL_SEM_SENHA'] = ligado ? '1' : '0'
  // O acesso sem senha só existe no servidor de desenvolvimento (achado C-12).
  Object.assign(process.env, { NODE_ENV: 'development' })
  limparCacheDeAmbiente()
}

const NODE_ENV_ORIGINAL = process.env['NODE_ENV']

afterEach(() => {
  Object.assign(process.env, { NODE_ENV: NODE_ENV_ORIGINAL })
  limparCacheDeAmbiente()
})

/** Pedido como a tela do sistema faz: mesma origem, corpo JSON. */
function pedirEntrada(email: string, url = URL_LOCAL, origem?: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
      ...(origem === undefined ? {} : { 'x-forwarded-for': origem }),
    },
    body: JSON.stringify({ email }),
  })
}

async function entradasRegistradas(): Promise<number> {
  return banco.logAuditoria.count({ where: { acao: 'entrada_local_sem_senha' } })
}

beforeEach(async () => {
  process.env['SESSAO_SECRET'] = 'segredo-de-teste-com-tamanho-suficiente'
  ligarAcessoLocal(false)
  jarra.valor = ''
  await limparTudo(banco)
  await banco.colaborador.createMany({
    data: [
      {
        nome: 'Gestora Sintética',
        email: 'gestora@exemplo.test',
        papel: 'gestor',
        senhaHash: 'hash-sintetico',
        senhaDefinidaEm: new Date(),
        // Como no seed: toda conta sintética nasce com senha provisória.
        precisaTrocarSenha: true,
      },
      {
        nome: 'Colaboradora Sintética Desligada',
        email: 'desligada@exemplo.test',
        papel: 'colaborador',
        ativo: false,
      },
      {
        nome: 'Pessoa de Fora do Domínio Sintético',
        email: 'pessoa@associacao.org.br',
        papel: 'gestor',
      },
    ],
  })
})

describe('desligado, a porta não existe', () => {
  it('GET e POST respondem 404, sem cookie e sem registro na trilha', async () => {
    expect((await GET(new Request(URL_LOCAL))).status).toBe(404)
    expect((await POST(pedirEntrada('gestora@exemplo.test'))).status).toBe(404)

    expect(jarra.valor).toBe('')
    expect(await entradasRegistradas()).toBe(0)
  })
})

describe('ligado', () => {
  beforeEach(() => {
    ligarAcessoLocal(true)
  })

  it('pedido de outra máquina recebe 404', async () => {
    expect((await GET(new Request(URL_DA_REDE))).status).toBe(404)
    expect((await POST(pedirEntrada('gestora@exemplo.test', URL_DA_REDE))).status).toBe(404)
    expect((await POST(pedirEntrada('gestora@exemplo.test', URL_LOCAL, '192.168.0.20'))).status).toBe(
      404,
    )
    expect(jarra.valor).toBe('')
  })

  it('lista só as contas sintéticas ativas', async () => {
    const resposta = await GET(new Request(URL_LOCAL))
    const corpo = (await resposta.json()) as { dados: { email: string }[] }

    expect(resposta.status).toBe(200)
    expect(corpo.dados.map((conta) => conta.email)).toEqual(['gestora@exemplo.test'])
  })

  it('entra em conta sintética sem pedir troca de senha, e registra na trilha', async () => {
    const resposta = await POST(pedirEntrada('  Gestora@Exemplo.TEST '))
    expect(resposta.status).toBe(200)
    expect(jarra.valor).not.toBe('')

    const perfil = await perfilAtual()
    expect(perfil).toMatchObject({ papel: 'gestor', acessoLocal: true, precisaTrocarSenha: false })
    await expect(exigirAtor()).resolves.toMatchObject({ papel: 'gestor' })
    expect(await entradasRegistradas()).toBe(1)
  })

  it('formulário de outro site não força a entrada (CSRF)', async () => {
    // O ataque da revisão: `<form enctype="text/plain">` com o corpo montado
    // para virar JSON válido. Chega de loopback de verdade.
    const formularioDeOutroSite = new Request(URL_LOCAL, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'sec-fetch-site': 'cross-site' },
      body: '{"email":"gestora@exemplo.test","x":"=}',
    })
    // O mesmo corpo, mas de ferramenta de linha de comando: sem `Sec-Fetch-Site`.
    const semCabecalhoDeNavegador = new Request(URL_LOCAL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'gestora@exemplo.test' }),
    })
    // Mesma origem, mas corpo que não é JSON declarado.
    const mesmaOrigemComTextoPuro = new Request(URL_LOCAL, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ email: 'gestora@exemplo.test' }),
    })

    expect((await POST(formularioDeOutroSite)).status).toBe(404)
    expect((await POST(semCabecalhoDeNavegador)).status).toBe(404)
    expect((await POST(mesmaOrigemComTextoPuro)).status).toBe(404)
    expect(jarra.valor).toBe('')
    expect(await entradasRegistradas()).toBe(0)
  })

  it('conta fora do domínio sintético recebe 404 e não entra', async () => {
    expect((await POST(pedirEntrada('pessoa@associacao.org.br'))).status).toBe(404)
    expect(jarra.valor).toBe('')
    expect(await entradasRegistradas()).toBe(0)
  })

  it('conta sintética desativada não entra', async () => {
    expect((await POST(pedirEntrada('desligada@exemplo.test'))).status).toBe(404)
    expect(jarra.valor).toBe('')
  })

  it('desligar o acesso local derruba a sessão local na próxima leitura', async () => {
    expect((await POST(pedirEntrada('gestora@exemplo.test'))).status).toBe(200)
    expect(await perfilAtual()).not.toBeNull()

    ligarAcessoLocal(false)

    expect(await perfilAtual()).toBeNull()
  })

  it('sessão local de conta que deixou de ser sintética morre', async () => {
    expect((await POST(pedirEntrada('gestora@exemplo.test'))).status).toBe(200)

    await banco.colaborador.update({
      where: { email: 'gestora@exemplo.test' },
      data: { email: 'gestora@associacao.org.br' },
    })

    expect(await perfilAtual()).toBeNull()
  })
})

describe('sessão aberta com senha não ganha nada com o acesso local ligado', () => {
  it('senha provisória continua exigindo a troca', async () => {
    ligarAcessoLocal(true)
    const gestora = await banco.colaborador.findUniqueOrThrow({
      where: { email: 'gestora@exemplo.test' },
      select: { id: true, senhaDefinidaEm: true },
    })
    jarra.valor = montarCookie(gestora.id, 'gestor', gestora.senhaDefinidaEm)

    expect(await perfilAtual()).toMatchObject({ precisaTrocarSenha: true, acessoLocal: false })
    await expect(exigirAtor()).rejects.toBeInstanceOf(SenhaProvisoriaError)
  })
})
