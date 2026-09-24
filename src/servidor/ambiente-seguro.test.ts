import { randomUUID } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ambiente, limparCacheDeAmbiente } from './ambiente'

/**
 * Configurações que o sistema recusa, em vez de subir e degradar calado.
 *
 * N-17 (`docs/auditoria/2026-09-17-achados-da-auditoria-por-agentes.md`): com a
 * caixa real ligada, nada impedia a IA simulada (e-mail real aprovado por regra
 * fixa) nem a chave gratuita do Gemini, que `A50` restringe a e-mail sintético
 * e `A38` exclui de dado real.
 * N-18: em produção, os segredos aceitavam os valores PÚBLICOS do CI e do
 * vitest — escritos no repositório.
 */

const FORTE = 'q8Zr2vN6pW1xT4kL9mB3cF7hJ0sD5gYa'

beforeEach(() => {
  vi.stubEnv('SESSAO_SECRET', FORTE)
  vi.stubEnv('BUSCA_SECRET', `${FORTE}-busca`)
  // Independente do de sessão: `${FORTE}-anexos` seria exatamente a derivação
  // que a trava do C-25 recusa (revisão de segurança do #98). Gerado na hora:
  // um literal com cara de chave é confundido com segredo pelo gitleaks.
  vi.stubEnv('ANEXOS_SECRET', randomUUID())
  vi.stubEnv('INGESTAO_ADAPTER', 'mock')
  vi.stubEnv('IA_ADAPTER', 'mock')
  vi.stubEnv('ACESSO_LOCAL_SEM_SENHA', '')
  limparCacheDeAmbiente()
})

afterEach(() => {
  vi.unstubAllEnvs()
  limparCacheDeAmbiente()
})

describe('caixa real exige IA própria para dado real (N-17)', () => {
  it.each(['mock', 'gemini'])('INGESTAO_ADAPTER=graph com IA_ADAPTER=%s é recusado', (ia) => {
    vi.stubEnv('INGESTAO_ADAPTER', 'graph')
    vi.stubEnv('IA_ADAPTER', ia)
    vi.stubEnv('GOOGLE_AI_KEY', 'chave-sintetica')
    expect(() => ambiente()).toThrow(/IA_ADAPTER/)
  })

  it('INGESTAO_ADAPTER=graph com IA_ADAPTER=anthropic sobe', () => {
    vi.stubEnv('INGESTAO_ADAPTER', 'graph')
    vi.stubEnv('IA_ADAPTER', 'anthropic')
    vi.stubEnv('ANTHROPIC_API_KEY', 'chave-sintetica')
    expect(() => ambiente()).not.toThrow()
  })

  it('a rotina do Gemini com e-mail simulado continua permitida (A50)', () => {
    vi.stubEnv('IA_ADAPTER', 'gemini')
    vi.stubEnv('GOOGLE_AI_KEY', 'chave-sintetica')
    expect(() => ambiente()).not.toThrow()
  })
})

describe('produção recusa segredo público (N-18)', () => {
  it.each([
    ['SESSAO_SECRET', 'ci-nao-e-segredo-so-para-o-banco-efemero'],
    ['BUSCA_SECRET', 'ci-nao-e-segredo-so-para-cpf-sintetico'],
    ['BUSCA_SECRET', 'teste-nao-e-segredo-so-para-cpf-sintetico'],
    ['SESSAO_SECRET', 'segredo-de-teste-com-tamanho-suficiente'],
    ['ANEXOS_SECRET', 'segredo-de-teste-antigo-longo'],
  ])('%s com valor de teste é recusado em produção', (nome, valor) => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv(nome, valor)
    expect(() => ambiente()).toThrow(new RegExp(nome))
  })

  it.each(['aaaaaaaaaaaaaaaa', '1234123412341234'])(
    'segredo previsível (%s) é recusado em produção',
    (valor) => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('SESSAO_SECRET', valor)
      expect(() => ambiente()).toThrow(/SESSAO_SECRET/)
    },
  )

  it('um UUID gerado como o README manda continua aceito', () => {
    vi.stubEnv('NODE_ENV', 'production')
    // Gerado na hora: um UUID escrito no arquivo é confundido com chave pelo gitleaks.
    vi.stubEnv('SESSAO_SECRET', randomUUID())
    expect(() => ambiente()).not.toThrow()
  })

  it('a mensagem não repete o valor recusado', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SESSAO_SECRET', 'ci-nao-e-segredo-so-para-o-banco-efemero')
    expect(() => ambiente()).toThrow(expect.objectContaining({ message: expect.not.stringContaining('banco-efemero') }))
  })

  it('o mesmo valor segue aceito fora de produção (CI e testes dependem dele)', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('SESSAO_SECRET', 'ci-nao-e-segredo-so-para-o-banco-efemero')
    expect(() => ambiente()).not.toThrow()
  })

  it('segredos fortes sobem em produção', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => ambiente()).not.toThrow()
  })
})

describe('produção exige segredo próprio para os anexos (C-25)', () => {
  /**
   * Sem `ANEXOS_SECRET`, a chave dos anexos era derivada de `SESSAO_SECRET`:
   * um vazamento entregava de uma vez a sessão de gestor e os documentos, e a
   * resposta normal ao vazamento — trocar o segredo de sessão — tornava todo
   * anexo ilegível. Antes de existir dado real, produção passa a exigir os dois
   * separados. Fora de produção nada muda: a instalação de desenvolvimento e a
   * suíte seguem com o recurso de cair na sessão.
   */
  it('produção sem ANEXOS_SECRET recusa subir, dizendo o que falta', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ANEXOS_SECRET', '')
    expect(() => ambiente()).toThrow(/ANEXOS_SECRET/)
  })

  it('produção com ANEXOS_SECRET igual ao de sessão recusa — separado só no nome não é separado', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ANEXOS_SECRET', FORTE)
    expect(() => ambiente()).toThrow(/ANEXOS_SECRET/)
  })

  it('produção com ANEXOS_SECRET que contém o de sessão recusa — concatenar não é gerar (revisão do #98)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ANEXOS_SECRET', `${FORTE}-anexos`)
    expect(() => ambiente()).toThrow(/ANEXOS_SECRET/)
  })

  it('fora de produção, sem ANEXOS_SECRET, continua subindo', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('ANEXOS_SECRET', '')
    expect(() => ambiente()).not.toThrow()
  })
})

describe('servidor de modelo local (A56)', () => {
  beforeEach(() => {
    vi.stubEnv('IA_ADAPTER', 'local')
    vi.stubEnv('IA_LOCAL_URL', 'http://127.0.0.1:11434/v1')
    vi.stubEnv('IA_MODELO', 'qwen3-1.7b-instruct')
    limparCacheDeAmbiente()
  })

  it('sobe com endereço de loopback e modelo escolhido', () => {
    expect(() => ambiente()).not.toThrow()
  })

  it('sem IA_LOCAL_URL, recusa dizendo o que falta', () => {
    vi.stubEnv('IA_LOCAL_URL', '')
    expect(() => ambiente()).toThrow(/IA_LOCAL_URL/)
  })

  it('sem IA_MODELO, recusa: servidor local não tem modelo padrão', () => {
    // Cada servidor serve o modelo que baixaram nele. Um padrão inventado aqui
    // daria 404 do servidor, e a pessoa procuraria o defeito no endereço.
    vi.stubEnv('IA_MODELO', '')
    expect(() => ambiente()).toThrow(/IA_MODELO/)
  })

  it.each([
    'http://ia.exemplo.test/v1',
    'http://203.0.113.10:8000/v1',
    'https://api.exemplo.test/v1',
  ])('endereço público é recusado: %s', (url) => {
    // `A56 (f)`: a porta do modelo nunca é pública. "local" apontando para fora
    // mandaria e-mail de associado para um servidor de terceiro com o nome de
    // servidor de dentro de casa.
    vi.stubEnv('IA_LOCAL_URL', url)
    expect(() => ambiente()).toThrow(/IA_LOCAL_URL/)
  })

  it.each([
    'http://localhost:11434/v1',
    'http://192.168.0.30:8080/v1',
    'http://10.1.2.3:8000/v1',
    'http://[::1]:11434/v1',
  ])('endereço da própria máquina ou da rede interna sobe: %s', (url) => {
    vi.stubEnv('IA_LOCAL_URL', url)
    expect(() => ambiente()).not.toThrow()
  })

  it('endereço com usuário e senha embutidos é recusado — a credencial viajaria em todo pedido', () => {
    // Ela apareceria no log de acesso do servidor e de qualquer proxy no meio.
    vi.stubEnv('IA_LOCAL_URL', 'http://admin:segredo@127.0.0.1:11434/v1')
    expect(() => ambiente()).toThrow(/IA_LOCAL_CHAVE/)
  })

  it('a recusa não repete a senha', () => {
    vi.stubEnv('IA_LOCAL_URL', 'http://admin:segredo@127.0.0.1:11434/v1')
    expect(() => ambiente()).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('segredo') }),
    )
  })

  it('IPv6 que só PARECE interno é recusado: fd1:2:3::4 é 0x0fd1, fora de fc00::/7', () => {
    // A faixa vai de fc00:: a fdff::, e todo endereço dela tem quatro dígitos
    // no primeiro hexteto. Três dígitos não é zero esquecido: é outro endereço.
    vi.stubEnv('IA_LOCAL_URL', 'http://[fd1:2:3::4]:8080/v1')
    expect(() => ambiente()).toThrow(/IA_LOCAL_URL/)
  })

  it('IPv6 interno de verdade sobe', () => {
    vi.stubEnv('IA_LOCAL_URL', 'http://[fd00:1:2::4]:8080/v1')
    expect(() => ambiente()).not.toThrow()
  })

  it('endereço que não é http nem https é recusado', () => {
    vi.stubEnv('IA_LOCAL_URL', 'file:///c:/modelo')
    expect(() => ambiente()).toThrow(/IA_LOCAL_URL/)
  })

  it('caixa real com IA local é recusada enquanto o gabarito não decidir (A56 (e))', () => {
    vi.stubEnv('INGESTAO_ADAPTER', 'graph')
    expect(() => ambiente()).toThrow(/IA_ADAPTER/)
  })
})
