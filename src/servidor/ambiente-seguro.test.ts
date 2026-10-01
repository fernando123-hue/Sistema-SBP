import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ambiente, limparCacheDeAmbiente, motivoDeEnderecoLocalInvalido, motivoDeNaoSerDesenvolvimento } from './ambiente'

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
  vi.stubEnv('SESSAO_SECRET_ANTERIOR', '')
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

describe('verificação de TLS desligada só em desenvolvimento (pendência 37)', () => {
  it.each(['production', 'test'])('NODE_TLS_REJECT_UNAUTHORIZED=0 com NODE_ENV=%s é recusado', (nodeEnv) => {
    vi.stubEnv('NODE_ENV', nodeEnv)
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0')
    expect(() => ambiente()).toThrow(/NODE_TLS_REJECT_UNAUTHORIZED/)
  })

  it('a recusa aponta o caminho legítimo para proxy corporativo', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0')
    expect(() => ambiente()).toThrow(/NODE_EXTRA_CA_CERTS/)
  })

  it('sem NODE_ENV, NODE_TLS_REJECT_UNAUTHORIZED=0 é recusado: a ausência não é desenvolvimento (pendência 47)', () => {
    // Script por `tsx` num cron não preenche NODE_ENV, e o schema o completaria
    // com `development`.
    vi.stubEnv('NODE_ENV', undefined)
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0')
    expect(() => ambiente()).toThrow(/NODE_ENV ausente/)
  })

  it('em desenvolvimento, NODE_TLS_REJECT_UNAUTHORIZED=0 continua subindo', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0')
    // Pasta vazia: um `.env` da máquina com `NODE_ENV=development` daria
    // vermelho sem defeito aqui.
    emPasta({}, () => expect(() => ambiente()).not.toThrow())
  })

  it('dev:local atrás de proxy: acesso sem senha e TLS desligado juntos, em desenvolvimento declarado, sobe', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0')
    vi.stubEnv('ACESSO_LOCAL_SEM_SENHA', '1')
    emPasta({}, () => expect(() => ambiente()).not.toThrow())
  })

  it('NODE_ENV=development vindo de um .env não é declarado: recusa (pendência 47, revisão de segurança)', () => {
    // `process.loadEnvFile` preenche o NODE_ENV que falta; um cron sem a
    // variável passaria por causa da linha no arquivo.
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0')
    emPasta({ '.env': 'NODE_ENV=development\n' }, () =>
      expect(() => ambiente()).toThrow(/NODE_ENV=development escrito em \.env/),
    )
  })

  // `'false'` e `'00'` também NÃO desligam a verificação no Node (conferido
  // contra um servidor TLS autoassinado nas revisões do #157): fixá-los aqui
  // impede que alguém alargue a comparação exata achando que fecha uma brecha.
  it.each(['1', '', 'false', '00'])('NODE_TLS_REJECT_UNAUTHORIZED=%j em produção sobe: a verificação está ligada', (valor) => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', valor)
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

describe('chave anterior da sessão, para rotacionar sem derrubar todo mundo (C-25)', () => {
  it('vazia é o mesmo que ausente: sobe, e não há rotação em curso', () => {
    vi.stubEnv('SESSAO_SECRET_ANTERIOR', '')
    expect(ambiente().SESSAO_SECRET_ANTERIOR).toBeUndefined()
  })

  it('curta demais é recusada, como a atual', () => {
    vi.stubEnv('SESSAO_SECRET_ANTERIOR', 'curta')
    expect(() => ambiente()).toThrow(/SESSAO_SECRET_ANTERIOR/)
  })

  it('igual à atual é recusada — a troca não aconteceu, e quem configurou precisa saber', () => {
    vi.stubEnv('SESSAO_SECRET_ANTERIOR', FORTE)
    expect(() => ambiente()).toThrow(/SESSAO_SECRET_ANTERIOR/)
  })

  it('com espaço sobrando, igual à atual continua recusada — a cópia com aspas ou do systemd leva o espaço', () => {
    vi.stubEnv('SESSAO_SECRET_ANTERIOR', `${FORTE} `)
    expect(() => ambiente()).toThrow(/SESSAO_SECRET_ANTERIOR/)
  })

  it('a nova derivada da anterior por concatenação é recusada — quem tem a velha adivinharia a nova', () => {
    vi.stubEnv('SESSAO_SECRET_ANTERIOR', FORTE)
    vi.stubEnv('SESSAO_SECRET', `${FORTE}-v2`)
    expect(() => ambiente()).toThrow(/SESSAO_SECRET_ANTERIOR/)
  })

  it('em produção, igual ou contida na da busca é recusada — a chave que nunca troca abriria sessão', () => {
    // Independente da atual: senão quem recusaria seria a regra da atual.
    const busca = randomUUID()
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BUSCA_SECRET', busca)
    vi.stubEnv('SESSAO_SECRET_ANTERIOR', busca)
    expect(() => ambiente()).toThrow(/SESSAO_SECRET_ANTERIOR.*BUSCA_SECRET/)

    limparCacheDeAmbiente()
    vi.stubEnv('SESSAO_SECRET_ANTERIOR', `${busca}-velha`)
    expect(() => ambiente()).toThrow(/SESSAO_SECRET_ANTERIOR.*BUSCA_SECRET/)
  })

  it('em produção, igual ou contida na dos anexos é recusada — a chave dos anexos abriria sessão', () => {
    const anexos = randomUUID()
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ANEXOS_SECRET', anexos)
    vi.stubEnv('SESSAO_SECRET_ANTERIOR', anexos)
    expect(() => ambiente()).toThrow(/SESSAO_SECRET_ANTERIOR/)

    limparCacheDeAmbiente()
    vi.stubEnv('SESSAO_SECRET_ANTERIOR', `${anexos}-velha`)
    expect(() => ambiente()).toThrow(/SESSAO_SECRET_ANTERIOR/)
  })

  it('em produção, valor de teste público é recusado, como nos outros segredos (N-18)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SESSAO_SECRET_ANTERIOR', 'segredo-de-teste-antigo-da-sessao')
    expect(() => ambiente()).toThrow(/SESSAO_SECRET_ANTERIOR/)
  })

  it('em produção, uma chave anterior própria sobe', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SESSAO_SECRET_ANTERIOR', randomUUID())
    expect(ambiente().SESSAO_SECRET_ANTERIOR).toBeDefined()
  })

  it('fora de produção, igual à dos anexos sobe — é o passo que o .env.example manda dar antes de trocar a sessão', () => {
    // Em desenvolvimento, sem `ANEXOS_SECRET`, a chave dos anexos é a de sessão.
    // Para trocar a de sessão sem perder os anexos, fixa-se `ANEXOS_SECRET` com
    // o valor antigo — que é o mesmo que vai em `SESSAO_SECRET_ANTERIOR`.
    const antiga = randomUUID()
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('ANEXOS_SECRET', antiga)
    vi.stubEnv('SESSAO_SECRET_ANTERIOR', antiga)
    expect(() => ambiente()).not.toThrow()
  })
})

describe('desenvolvimento declarado (pendência 47)', () => {
  it.each([
    ['NODE_ENV=development', '.env'],
    ['export NODE_ENV="development"', '.env.local'],
    ["  NODE_ENV = 'development'\r", '.env.development'],
    // O `process.loadEnvFile` aceita comentário no fim da linha (segunda
    // revisão técnica): a trava precisa ver o mesmo que o carregador.
    ['NODE_ENV=development # só para testar', '.env'],
    ['NODE_ENV="development" # x', '.env'],
    ['NODE_ENV=`development`', '.env.local'],
  ])('%j em %s não conta como declarado', (linha, arquivo) => {
    vi.stubEnv('NODE_ENV', 'development')
    const pasta = mkdtempSync(join(tmpdir(), 'sbp-nodeenv-'))
    try {
      writeFileSync(join(pasta, arquivo), `DATABASE_URL="x"\n${linha}\n`)
      expect(motivoDeNaoSerDesenvolvimento(pasta)).toContain(arquivo)
    } finally {
      rmSync(pasta, { recursive: true, force: true })
    }
  })

  it('linha comentada, outro valor ou só no .env.example não contam', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const pasta = mkdtempSync(join(tmpdir(), 'sbp-nodeenv-'))
    try {
      writeFileSync(join(pasta, '.env'), '# NODE_ENV=development\nNODE_ENV=production\n')
      writeFileSync(join(pasta, '.env.example'), 'NODE_ENV=development\n')
      expect(motivoDeNaoSerDesenvolvimento(pasta)).toBeNull()
    } finally {
      rmSync(pasta, { recursive: true, force: true })
    }
  })

  it.each([
    [undefined, 'NODE_ENV ausente'],
    ['test', 'NODE_ENV=test'],
    ['production', 'NODE_ENV=production'],
  ])('NODE_ENV=%j não é desenvolvimento', (valor, motivo) => {
    vi.stubEnv('NODE_ENV', valor)
    emPasta({}, () => expect(motivoDeNaoSerDesenvolvimento()).toBe(motivo))
  })
})

/**
 * Roda `corpo` com o processo numa pasta temporária contendo só `arquivos`.
 * `process.chdir` exige o pool `forks` do vitest (o padrão); em `threads`, lança.
 */
function emPasta(arquivos: Record<string, string>, corpo: () => void): void {
  const pasta = mkdtempSync(join(tmpdir(), 'sbp-amb-'))
  const original = process.cwd()
  try {
    for (const [nome, conteudo] of Object.entries(arquivos)) writeFileSync(join(pasta, nome), conteudo)
    process.chdir(pasta)
    limparCacheDeAmbiente()
    corpo()
  } finally {
    process.chdir(original)
    rmSync(pasta, { recursive: true, force: true })
  }
}

describe('em produção, o assistente não manda o que a equipe digita a fornecedor sem autorização (AT-63)', () => {
  it('IA_ADAPTER=gemini com a caixa SIMULADA é recusado: a pergunta pode trazer e-mail de associado colado', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('IA_ADAPTER', 'gemini')
    vi.stubEnv('GOOGLE_AI_KEY', 'chave-sintetica')
    expect(() => ambiente()).toThrow(/IA_ADAPTER="gemini" com NODE_ENV=production/)
  })

  it('fora de produção, o Gemini segue: é a rotina do A50, por script, sem NODE_ENV de produção', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('IA_ADAPTER', 'gemini')
    vi.stubEnv('GOOGLE_AI_KEY', 'chave-sintetica')
    expect(() => ambiente()).not.toThrow()
  })

  it.each([
    ['mock', {}],
    ['local', { IA_LOCAL_URL: 'http://127.0.0.1:11434/v1', IA_MODELO: 'qwen2.5:1.5b-instruct-q4_K_M' }],
    ['anthropic', { ANTHROPIC_API_KEY: 'chave-sintetica' }],
  ] as const)('IA_ADAPTER=%s em produção sobe: o texto não sai da casa, ou o fornecedor é o autorizado', (ia, extras) => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('IA_ADAPTER', ia)
    for (const [nome, valor] of Object.entries(extras)) vi.stubEnv(nome, valor)
    expect(() => ambiente()).not.toThrow()
  })
})

describe('o endereço da IA local inválido não ecoa o valor (revisão de segurança do #183)', () => {
  it('sem o http://, o "protocolo" lido é o usuário; a mensagem não o repete', () => {
    const motivo = motivoDeEnderecoLocalInvalido('usuario:segredo@10.0.0.5:11434/v1')
    expect(motivo).toBe('precisa ser http ou https.')
  })
})
