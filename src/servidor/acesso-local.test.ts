import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  acessoLocalEmArquivoEnv,
  acessoLocalHabilitado,
  ehContaSintetica,
  ehPedidoDaPropriaTela,
  ehRequisicaoLocal,
} from './acesso-local'
import { ambiente, limparCacheDeAmbiente } from './ambiente'
import { lerCookie, montarCookie, OPCOES_DO_COOKIE } from './sessao'

/**
 * As travas do acesso local sem senha que não precisam de banco.
 *
 * Cada `it` aqui guarda uma trava de `acesso-local.ts`. Se alguém afrouxar uma
 * delas — aceitar produção, aceitar outro domínio, aceitar pedido de outra
 * máquina —, o vermelho aparece aqui, e não no dia em que a porta estiver aberta
 * num servidor publicado.
 */

const ORIGINAL = {
  acesso: process.env['ACESSO_LOCAL_SEM_SENHA'],
  nodeEnv: process.env['NODE_ENV'],
  busca: process.env['BUSCA_SECRET'],
  anexos: process.env['ANEXOS_SECRET'],
}

function configurar(acesso: string | undefined, nodeEnv: 'development' | 'test' | 'production'): void {
  if (acesso === undefined) delete process.env['ACESSO_LOCAL_SEM_SENHA']
  else process.env['ACESSO_LOCAL_SEM_SENHA'] = acesso
  // `Object.assign` porque os tipos do Next declaram `NODE_ENV` somente leitura.
  Object.assign(process.env, { NODE_ENV: nodeEnv })
  limparCacheDeAmbiente()
}

beforeEach(() => {
  process.env['SESSAO_SECRET'] = 'segredo-de-teste-com-tamanho-suficiente'
})

afterEach(() => {
  if (ORIGINAL.acesso === undefined) delete process.env['ACESSO_LOCAL_SEM_SENHA']
  else process.env['ACESSO_LOCAL_SEM_SENHA'] = ORIGINAL.acesso
  Object.assign(process.env, { NODE_ENV: ORIGINAL.nodeEnv })
  if (ORIGINAL.busca === undefined) delete process.env['BUSCA_SECRET']
  else process.env['BUSCA_SECRET'] = ORIGINAL.busca
  if (ORIGINAL.anexos === undefined) delete process.env['ANEXOS_SECRET']
  else process.env['ANEXOS_SECRET'] = ORIGINAL.anexos
  limparCacheDeAmbiente()
})

describe('ligar e desligar', () => {
  it('nasce desligado', () => {
    configurar(undefined, 'development')
    expect(acessoLocalHabilitado()).toBe(false)
  })

  it('liga só com "1"', () => {
    configurar('1', 'development')
    expect(acessoLocalHabilitado()).toBe(true)

    configurar('0', 'development')
    expect(acessoLocalHabilitado()).toBe(false)
  })

  it('ligado em produção, o sistema recusa subir', () => {
    configurar('1', 'production')
    expect(() => ambiente()).toThrow(/ACESSO_LOCAL_SEM_SENHA/)
  })

  it('desligado em produção, sobe normalmente e continua desligado', () => {
    // Produção recusa os segredos públicos da suíte (N-18).
    process.env['SESSAO_SECRET'] = 'q8Zr2vN6pW1xT4kL9mB3cF7hJ0sD5gYa'
    process.env['BUSCA_SECRET'] = 'k3Lm9Pq2Rs7Tv1Wx5Yz8Ab4Cd6Ef0Gh'
    // E exige o segredo próprio dos anexos (C-25).
    process.env['ANEXOS_SECRET'] = 'w4Xy7Zb1Nc5Vd9Fg2Hj6Kl0Mn3Pq8Rt'
    configurar('0', 'production')
    expect(() => ambiente()).not.toThrow()
    expect(acessoLocalHabilitado()).toBe(false)
  })

  it('valor torto falha alto em vez de ser lido como desligado', () => {
    configurar('true', 'development')
    expect(() => ambiente()).toThrow(/aceita só/)
  })
})

describe('só conta sintética', () => {
  it('aceita o domínio reservado, sem depender de maiúscula ou espaço', () => {
    expect(ehContaSintetica('bianca@exemplo.test')).toBe(true)
    expect(ehContaSintetica('  Fabiana.Gestora@EXEMPLO.TEST ')).toBe(true)
  })

  it('recusa qualquer outro domínio, inclusive os que imitam o reservado', () => {
    expect(ehContaSintetica('pessoa@associacao.org.br')).toBe(false)
    expect(ehContaSintetica('exemplo.test@gmail.com')).toBe(false)
    expect(ehContaSintetica('alguem@exemplo.test.golpe.com')).toBe(false)
    expect(ehContaSintetica('alguem@naoexemplo.test')).toBe(false)
  })
})

describe('só pedido desta máquina', () => {
  const pedido = (url: string, origem?: string): Request =>
    new Request(url, origem === undefined ? undefined : { headers: { 'x-forwarded-for': origem } })

  it('aceita loopback pelo nome e pelos endereços', () => {
    expect(ehRequisicaoLocal(pedido('http://localhost:3000/api/sessao/local'))).toBe(true)
    expect(ehRequisicaoLocal(pedido('http://127.0.0.1:3000/api/sessao/local'))).toBe(true)
    expect(ehRequisicaoLocal(pedido('http://[::1]:3000/api/sessao/local'))).toBe(true)
    expect(ehRequisicaoLocal(pedido('http://localhost:3000/', '::1'))).toBe(true)
    expect(ehRequisicaoLocal(pedido('http://localhost:3000/', '::ffff:127.0.0.1'))).toBe(true)
    expect(ehRequisicaoLocal(pedido('http://localhost:3000/', '127.0.0.1, ::1'))).toBe(true)
  })

  it('recusa endereço de rede e origem de outra máquina', () => {
    expect(ehRequisicaoLocal(pedido('http://192.168.0.10:3000/api/sessao/local'))).toBe(false)
    expect(ehRequisicaoLocal(pedido('https://sbp.associacao.org.br/api/sessao/local'))).toBe(false)
    expect(ehRequisicaoLocal(pedido('http://localhost:3000/', '192.168.0.20'))).toBe(false)
    // Uma entrada de fora no meio da cadeia basta para recusar.
    expect(ehRequisicaoLocal(pedido('http://localhost:3000/', '127.0.0.1, 10.0.0.5'))).toBe(false)
    expect(ehRequisicaoLocal(pedido('http://localhost:3000/', ''))).toBe(false)
  })
})

describe('só entrada pedida pela própria tela', () => {
  const pedido = (cabecalhos: Record<string, string>): Request =>
    new Request('http://localhost:3000/api/sessao/local', { method: 'POST', headers: cabecalhos })

  it('aceita mesma origem com corpo JSON, inclusive com charset', () => {
    expect(
      ehPedidoDaPropriaTela(pedido({ 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' })),
    ).toBe(true)
    expect(
      ehPedidoDaPropriaTela(
        pedido({ 'sec-fetch-site': 'same-origin', 'content-type': 'Application/JSON; charset=utf-8' }),
      ),
    ).toBe(true)
  })

  it('recusa outro site, ausência do cabeçalho do navegador e corpo que não é JSON', () => {
    expect(
      ehPedidoDaPropriaTela(pedido({ 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' })),
    ).toBe(false)
    expect(
      ehPedidoDaPropriaTela(pedido({ 'sec-fetch-site': 'same-site', 'content-type': 'application/json' })),
    ).toBe(false)
    expect(ehPedidoDaPropriaTela(pedido({ 'content-type': 'application/json' }))).toBe(false)
    expect(
      ehPedidoDaPropriaTela(pedido({ 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' })),
    ).toBe(false)
    expect(ehPedidoDaPropriaTela(pedido({ 'sec-fetch-site': 'same-origin' }))).toBe(false)
  })
})

describe('marca local no cookie', () => {
  it('ida e volta preserva a marca, e cookie comum não a ganha', () => {
    expect(lerCookie(montarCookie('ckabc123', 'gestor', null, { local: true }))?.local).toBe(true)
    expect(lerCookie(montarCookie('ckabc123', 'gestor', null))).not.toHaveProperty('local')
  })

  it('acrescentar a marca à mão invalida a assinatura', () => {
    const original = montarCookie('ckabc123', 'gestor', null)
    const separador = original.lastIndexOf('.')
    const carga = JSON.parse(
      Buffer.from(original.slice(0, separador), 'base64url').toString(),
    ) as Record<string, unknown>
    carga['local'] = true
    const forjada = Buffer.from(JSON.stringify(carga)).toString('base64url')

    expect(lerCookie(`${forjada}.${original.slice(separador + 1)}`)).toBeNull()
  })
})

/**
 * Achado C-12 (`docs/auditoria/2026-09-17-achados-da-auditoria-por-agentes.md`):
 * "produção" era detectada só por `NODE_ENV === 'production'`. O `next start`
 * só preenche `NODE_ENV` quando ele falta — herdado como `test` ou qualquer
 * outro valor, um servidor publicado subia com o acesso sem senha aceito
 * (inclusive vindo do `.env`) e com o cookie sem `Secure`. Agora o que libera é
 * o sinal POSITIVO de desenvolvimento.
 */
describe('C-12: desenvolvimento é sinal positivo, não ausência de produção', () => {
  it.each(['test'] as const)('ligado com NODE_ENV=%s, o sistema recusa subir e o acesso fica desligado', (nodeEnv) => {
    configurar('1', nodeEnv)
    expect(() => ambiente()).toThrow(/ACESSO_LOCAL_SEM_SENHA/)
    // Falha alta: a rota responde erro em vez de abrir a porta.
    expect(() => acessoLocalHabilitado()).toThrow(/ACESSO_LOCAL_SEM_SENHA/)
  })

  it('o cookie sai com Secure fora de desenvolvimento', () => {
    configurar(undefined, 'test')
    expect(OPCOES_DO_COOKIE.secure).toBe(true)
    configurar(undefined, 'development')
    expect(OPCOES_DO_COOKIE.secure).toBe(false)
  })
})

describe('C-12: o acesso sem senha não pode morar num arquivo .env', () => {
  let pasta: string

  beforeEach(() => {
    pasta = mkdtempSync(join(tmpdir(), 'sbp-env-'))
  })

  afterEach(() => {
    rmSync(pasta, { recursive: true, force: true })
  })

  it.each(['.env', '.env.local', '.env.development', '.env.production'])('ligado em %s é encontrado', (arquivo) => {
    writeFileSync(join(pasta, arquivo), 'DATABASE_URL="x"\nACESSO_LOCAL_SEM_SENHA="1"\n')
    expect(acessoLocalEmArquivoEnv(pasta)).toBe(arquivo)
  })

  it.each(['export ACESSO_LOCAL_SEM_SENHA=1', "  export\tACESSO_LOCAL_SEM_SENHA = '1'", 'ACESSO_LOCAL_SEM_SENHA=1\r'])(
    'forma aceita pelo carregador de .env também é encontrada: %j',
    (linha) => {
      // `process.loadEnvFile` aceita `export`; a trava precisa ver o mesmo que ele.
      writeFileSync(join(pasta, '.env'), `DATABASE_URL="x"\n${linha}\n`)
      expect(acessoLocalEmArquivoEnv(pasta)).toBe('.env')
    },
  )

  it('linha comentada, desligada ou só no .env.example não conta', () => {
    writeFileSync(join(pasta, '.env'), '# ACESSO_LOCAL_SEM_SENHA="1"\nACESSO_LOCAL_SEM_SENHA="0"\n')
    writeFileSync(join(pasta, '.env.example'), 'ACESSO_LOCAL_SEM_SENHA="1"\n')
    expect(acessoLocalEmArquivoEnv(pasta)).toBeNull()
  })

  it('ligado no .env da pasta do processo, o sistema recusa subir mesmo em desenvolvimento', () => {
    writeFileSync(join(pasta, '.env'), "ACESSO_LOCAL_SEM_SENHA=1\n")
    const original = process.cwd()
    process.chdir(pasta)
    try {
      configurar('1', 'development')
      expect(() => ambiente()).toThrow(/dev:local/)
    } finally {
      process.chdir(original)
    }
  })
})
