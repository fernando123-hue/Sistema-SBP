import { randomBytes, randomUUID } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { limparCacheDeAmbiente } from './servidor/ambiente'
import { conferirAmbienteNaSubida } from './instrumentation-node'

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
