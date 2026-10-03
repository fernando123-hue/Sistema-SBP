import { randomBytes, randomUUID } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { limparCacheDeAmbiente } from './servidor/ambiente'
import { conferirAmbienteNaSubida, conferirModoSqlNaSubida } from './instrumentation-node'

/**
 * Pendência 49: com a configuração errada, o servidor de produção seguia de pé
 * respondendo 500, e o supervisor (systemd) não acusava nada.
 */

afterEach(() => {
  vi.unstubAllEnvs()
  limparCacheDeAmbiente()
})

/** Uma configuração de produção válida, com segredos gerados na hora (gitleaks, #175). */
function producaoValida(): void {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('SESSAO_SECRET', randomBytes(24).toString('base64url'))
  vi.stubEnv('BUSCA_SECRET', randomBytes(24).toString('base64url'))
  vi.stubEnv('ANEXOS_SECRET', randomUUID())
  vi.stubEnv('SESSAO_SECRET_ANTERIOR', '')
  vi.stubEnv('INGESTAO_ADAPTER', 'mock')
  vi.stubEnv('IA_ADAPTER', 'mock')
  vi.stubEnv('ACESSO_LOCAL_SEM_SENHA', '')
  limparCacheDeAmbiente()
}

const SEGREDO_CURTO = 'curtinho'

function configuracaoErrada(): void {
  // SESSAO_SECRET curto demais: `ambiente()` recusa com mensagem própria.
  vi.stubEnv('SESSAO_SECRET', SEGREDO_CURTO)
  limparCacheDeAmbiente()
}

describe('a subida confere o ambiente', () => {
  it('em produção, configuração errada encerra com código 1 e diz o motivo, sem valor de segredo', async () => {
    producaoValida()
    configuracaoErrada()
    const sair = vi.fn()
    const escrito: string[] = []

    await conferirAmbienteNaSubida(sair, (texto) => escrito.push(texto))

    expect(sair).toHaveBeenCalledWith(1)
    expect(escrito.join('')).toMatch(/^O servidor NÃO subiu: a configuração está errada\. [\s\S]*SESSAO_SECRET precisa de no mínimo 16 caracteres/)
    expect(escrito.join('')).not.toContain(SEGREDO_CURTO)
  })

  it('fora de produção, só avisa: o next dev não cai a cada .env meio escrito', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    configuracaoErrada()
    const sair = vi.fn()
    const escrito: string[] = []

    await conferirAmbienteNaSubida(sair, (texto) => escrito.push(texto))

    expect(sair).not.toHaveBeenCalled()
    expect(escrito.join('')).toMatch(/em produção, isto encerraria o servidor/)
  })

  it('configuração certa não escreve nem encerra', async () => {
    producaoValida()
    const sair = vi.fn()
    const escrever = vi.fn()

    await conferirAmbienteNaSubida(sair, escrever)

    expect(escrever).not.toHaveBeenCalled()
    expect(sair).not.toHaveBeenCalled()
  })
})

describe('código que não carrega não manda conferir o .env (revisão técnica do #183)', () => {
  it('em produção, falha ao carregar o módulo encerra com mensagem própria', async () => {
    vi.resetModules()
    vi.doMock('./servidor/ambiente', () => {
      throw new Error('módulo quebrado')
    })
    vi.stubEnv('NODE_ENV', 'production')
    const { conferirAmbienteNaSubida: conferir } = await import('./instrumentation-node')
    const sair = vi.fn()
    const escrito: string[] = []

    await conferir(sair, (texto) => escrito.push(texto))

    expect(sair).toHaveBeenCalledWith(1)
    expect(escrito.join('')).toMatch(/o código não carregou \(confira o build e as dependências, não o \.env\)/)
    vi.doUnmock('./servidor/ambiente')
    vi.resetModules()
  })
})

/**
 * O modo estrito do MySQL conferido na SUBIDA (revisão de segurança do #204):
 * `db:privilegios` só confere quando o TI roda o comando, e um `SET GLOBAL` ou
 * um `my.cnf` mexido depois passaria. Sem modo estrito, linha sem domínio é
 * gravada com aviso em vez de recusada (#199).
 */
describe('a subida confere o modo SQL da sessão', () => {
  const NAO_ESTRITO = 'ONLY_FULL_GROUP_BY,NO_ENGINE_SUBSTITUTION'

  it('em produção, modo não estrito encerra com código 1 e diz o modo', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const sair = vi.fn()
    const escrito: string[] = []

    await conferirModoSqlNaSubida(async () => NAO_ESTRITO, sair, (texto) => escrito.push(texto))

    expect(sair).toHaveBeenCalledWith(1)
    expect(escrito.join('')).toMatch(/^O servidor NÃO subiu: a sessão do MySQL não está em modo estrito/)
    expect(escrito.join('')).toContain(NAO_ESTRITO)
  })

  it('fora de produção, só avisa', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const sair = vi.fn()
    const escrito: string[] = []

    await conferirModoSqlNaSubida(async () => NAO_ESTRITO, sair, (texto) => escrito.push(texto))

    expect(sair).not.toHaveBeenCalled()
    expect(escrito.join('')).toMatch(/em produção, isto encerraria o servidor/)
  })

  it('modo estrito: segue calado', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const sair = vi.fn()
    const escrito: string[] = []

    await conferirModoSqlNaSubida(async () => 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION', sair, (texto) =>
      escrito.push(texto),
    )

    expect(sair).not.toHaveBeenCalled()
    expect(escrito).toEqual([])
  })

  // O MySQL pode subir DEPOIS do SBP (ordem do systemd). Derrubar aqui viraria
  // um laço de reinício por um problema que não é do modo; o que não deu para
  // ler vai ao log, e a primeira requisição já falha alto pelo banco.
  it('banco que não respondeu na subida: registra e segue', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const sair = vi.fn()
    const escrito: string[] = []

    await conferirModoSqlNaSubida(
      async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:3306')
      },
      sair,
      (texto) => escrito.push(texto),
    )

    expect(sair).not.toHaveBeenCalled()
    expect(escrito.join('')).toMatch(/não deu para conferir o modo SQL na subida[\s\S]*ECONNREFUSED/)
  })

  it('a leitura padrão é a da sessão da aplicação, e o MySQL da suíte é estrito', async () => {
    const sair = vi.fn()
    const escrito: string[] = []

    await conferirModoSqlNaSubida(undefined, sair, (texto) => escrito.push(texto))

    expect(sair).not.toHaveBeenCalled()
    expect(escrito).toEqual([])
  })
})
