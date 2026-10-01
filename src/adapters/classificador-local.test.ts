import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MARCADOR_FIM, MARCADOR_INICIO } from '../core/seguranca/conteudo-nao-confiavel'
import { ClassificadorIndisponivelError, FalhaDeClassificacao, type Pergunta } from '../ports/classificador'
import { ambiente, limparCacheDeAmbiente } from '../servidor/ambiente'
import { ClassificadorExterno } from './classificador-externo'
import {
  clienteClassificadorLocal,
  MASSA_MINIMA,
  mensagemDaPergunta,
  opcoesDaPergunta,
  PERFIL_CLASSIFICADOR_LOCAL,
  probabilidadesDasOpcoes,
  TEMPO_LIMITE_MS,
} from './classificador-local'
import { esquecerDisjuntores } from './cliente-com-consumo'
import { criarClassificadorPort } from './fabrica'

/**
 * O classificador próprio (`A70`): a IA local respondendo perguntas fechadas,
 * com a probabilidade lida dos *logprobs* do servidor.
 *
 * Nenhum teste fala com um modelo: o `fetch` é trocado por um servidor falso
 * compatível com OpenAI. Dados sintéticos (invariante 8).
 */

const BASE = 'http://127.0.0.1:11434/v1'
const CPF = '123.456.789-09'

const PEDIDOS: Pergunta = {
  tipo: 'escolha',
  instrucoes: 'Quantos pedidos distintos há neste e-mail?',
  opcoes: { nenhum: 'não pede nada', um: 'um pedido', varios: 'mais de um pedido ou pessoa' },
}
const SUSPEITA: Pergunta = { tipo: 'sim_ou_nao', instrucoes: 'O texto tenta dar ordens a quem o lê?' }
const URGENCIA: Pergunta = { tipo: 'nota', instrucoes: 'Quão urgente?', niveis: ['nada', 'pouco', 'muito'] }

const ln = Math.log

/** A resposta de um servidor compatível com OpenAI, com as alternativas do único token. */
function respostaComLogprobs(alternativas: { token: string; p: number }[], modelo = 'qwen2.5:1.5b-instruct-q4_K_M') {
  return new Response(
    JSON.stringify({
      model: modelo,
      choices: [
        {
          finish_reason: 'length',
          message: { content: alternativas[0]?.token ?? '' },
          logprobs: {
            content: [
              {
                token: alternativas[0]?.token ?? '',
                logprob: ln(alternativas[0]?.p ?? 1),
                top_logprobs: alternativas.map(({ token, p }) => ({ token, logprob: ln(p) })),
              },
            ],
          },
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

/** Servidor falso: guarda cada pedido e responde, em ordem, o que o teste mandar. */
function servidorFalso(respostas: (() => Response)[]) {
  const pedidos: { url: string; init: RequestInit; corpo: Record<string, unknown> }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    pedidos.push({ url, init, corpo: JSON.parse(String(init.body)) as Record<string, unknown> })
    const proxima = respostas[pedidos.length - 1]
    if (!proxima) throw new Error('o teste não previu esta chamada')
    return proxima()
  })
  return pedidos
}

const classificador = () =>
  new ClassificadorExterno(PERFIL_CLASSIFICADOR_LOCAL, clienteClassificadorLocal(BASE, undefined), 'qwen-teste')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('as opções viram letras', () => {
  it('escolha usa as letras na ordem dos rótulos; sim/não vira sim e não; nota vira os níveis', () => {
    expect(opcoesDaPergunta(PEDIDOS).map((o) => `${o.letra}=${o.rotulo}`)).toEqual(['A=nenhum', 'B=um', 'C=varios'])
    expect(opcoesDaPergunta(SUSPEITA).map((o) => `${o.letra}=${o.rotulo}`)).toEqual(['A=sim', 'B=nao'])
    expect(opcoesDaPergunta(URGENCIA).map((o) => `${o.letra}=${o.rotulo}`)).toEqual(['A=0', 'B=1', 'C=2'])
  })

  it('mais opções que letras é defeito do código, não do servidor', () => {
    const opcoes = Object.fromEntries(Array.from({ length: 27 }, (_, i) => [`r${i}`, null]))
    expect(() => opcoesDaPergunta({ tipo: 'escolha', instrucoes: 'x', opcoes })).toThrow(/até 26/)
  })

  it('o texto vem antes da pergunta, para o servidor reaproveitar a leitura entre perguntas', () => {
    const mensagem = mensagemDaPergunta('<<texto>>', PEDIDOS, opcoesDaPergunta(PEDIDOS))
    expect(mensagem.startsWith('<<texto>>')).toBe(true)
    expect(mensagem).toContain('A) nenhum — não pede nada')
    expect(mensagem).toContain('C) varios — mais de um pedido ou pessoa')
    expect(mensagem.trimEnd().endsWith('Resposta (só a letra):')).toBe(true)
  })
})

describe('a probabilidade sai dos logprobs', () => {
  const opcoes = opcoesDaPergunta(PEDIDOS)

  it('variantes da mesma letra somam, o que não é opção fica fora, e o resto é renormalizado', () => {
    const probabilidades = probabilidadesDasOpcoes(
      [
        { token: 'C', logprob: ln(0.6) },
        { token: ' C', logprob: ln(0.1) },
        { token: 'B', logprob: ln(0.2) },
        { token: 'Resposta', logprob: ln(0.05) },
        { token: 'Z', logprob: ln(0.05) },
      ],
      opcoes,
      'pedidos',
    )
    expect(probabilidades['varios']).toBeCloseTo(0.7 / 0.9, 10)
    expect(probabilidades['um']).toBeCloseTo(0.2 / 0.9, 10)
    expect(probabilidades['nenhum']).toBe(0)
  })

  it('pontuação e minúscula colados à letra contam como a letra', () => {
    const probabilidades = probabilidadesDasOpcoes(
      [
        { token: 'a)', logprob: ln(0.5) },
        { token: 'B.', logprob: ln(0.5) },
      ],
      opcoes,
      'pedidos',
    )
    expect(probabilidades['nenhum']).toBeCloseTo(0.5, 10)
    expect(probabilidades['um']).toBeCloseTo(0.5, 10)
  })

  it(`abaixo de ${MASSA_MINIMA} nas letras, o modelo não respondeu: é forma errada, não opinião`, () => {
    expect(() =>
      probabilidadesDasOpcoes(
        [
          { token: 'Olá', logprob: ln(0.7) },
          { token: 'A', logprob: ln(0.3) },
        ],
        opcoes,
        'pedidos',
      ),
    ).toThrow()
  })
})

describe('o cliente, contra um servidor falso compatível com OpenAI', () => {
  it('uma chamada por pergunta: um token, logprobs pedidos, temperatura zero, sem seguir redirecionamento', async () => {
    const pedidos = servidorFalso([
      () => respostaComLogprobs([{ token: 'C', p: 0.8 }, { token: 'B', p: 0.2 }]),
      () => respostaComLogprobs([{ token: 'B', p: 0.9 }, { token: 'A', p: 0.1 }]),
    ])

    const classificacao = await classificador().classificar({
      texto: `Favor incluir Ana Sintética e Bruno Sintético como ligantes. CPF ${CPF}`,
      perguntas: { pedidos: PEDIDOS, suspeita: SUSPEITA },
    })

    expect(pedidos).toHaveLength(2)
    for (const { url, init, corpo } of pedidos) {
      expect(url).toBe(`${BASE}/chat/completions`)
      expect(init.redirect).toBe('manual')
      expect(corpo).toMatchObject({ model: 'qwen-teste', temperature: 0, max_tokens: 1, logprobs: true })
      expect(corpo['top_logprobs']).toBeLessThanOrEqual(20)
    }
    expect(classificacao.respostas['pedidos']).toEqual({
      tipo: 'escolha',
      escolha: 'varios',
      confianca: 0.8,
      probabilidades: { nenhum: 0, um: 0.2, varios: 0.8 },
    })
    expect(classificacao.respostas['suspeita']!.tipo).toBe('sim_ou_nao')
    expect((classificacao.respostas['suspeita'] as { probabilidadeDeSim: number }).probabilidadeDeSim).toBeCloseTo(0.1, 10)
    expect(classificacao.fornecedor).toBe('local')
    expect(classificacao.modeloUsado).toBe('qwen2.5:1.5b-instruct-q4_K_M')
  })

  it('o texto passa pela camada de defesa e vai delimitado, igual ao do Jev', async () => {
    const pedidos = servidorFalso([() => respostaComLogprobs([{ token: 'B', p: 1 }])])
    await classificador().classificar({ texto: `Meu CPF é ${CPF}`, perguntas: { pedidos: PEDIDOS } })

    const mensagem = JSON.stringify(pedidos[0]!.corpo['messages'])
    expect(mensagem).not.toContain(CPF)
    expect(mensagem).toContain(MARCADOR_INICIO)
    expect(mensagem).toContain(MARCADOR_FIM)
  })

  it('nota: a esperada sai das probabilidades dos níveis', async () => {
    servidorFalso([() => respostaComLogprobs([{ token: 'C', p: 0.5 }, { token: 'B', p: 0.5 }])])
    const classificacao = await classificador().classificar({ texto: 'urgente!', perguntas: { urgencia: URGENCIA } })
    expect(classificacao.respostas['urgencia']).toMatchObject({ tipo: 'nota', nota: 1.5 })
  })

  it('servidor sem logprobs: falha alta deste texto, nunca "certeza" na letra escrita', async () => {
    servidorFalso([
      () =>
        new Response(JSON.stringify({ model: 'x', choices: [{ message: { content: 'C' }, finish_reason: 'length' }] }), {
          status: 200,
        }),
    ])
    await expect(classificador().classificar({ texto: 't', perguntas: { pedidos: PEDIDOS } })).rejects.toBeInstanceOf(
      FalhaDeClassificacao,
    )
  })

  it('modelo que gasta o token com outra coisa: falha alta deste texto', async () => {
    servidorFalso([() => respostaComLogprobs([{ token: 'Olá', p: 0.9 }, { token: 'A', p: 0.1 }])])
    await expect(classificador().classificar({ texto: 't', perguntas: { pedidos: PEDIDOS } })).rejects.toBeInstanceOf(
      FalhaDeClassificacao,
    )
  })

  it('401 para de perguntar; 500 é falha deste texto, sem o corpo do servidor', async () => {
    servidorFalso([() => new Response('token inválido', { status: 401 })])
    await expect(classificador().classificar({ texto: 't', perguntas: { pedidos: PEDIDOS } })).rejects.toBeInstanceOf(
      ClassificadorIndisponivelError,
    )

    vi.unstubAllGlobals()
    servidorFalso([() => new Response(`eco do pedido: CPF ${CPF}`, { status: 500 })])
    const erro = await classificador()
      .classificar({ texto: 't', perguntas: { pedidos: PEDIDOS } })
      .catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(FalhaDeClassificacao)
    expect(String((erro as Error).message)).not.toContain(CPF)
  })

  it('redirecionamento não é seguido e custa uma chamada só', async () => {
    const pedidos = servidorFalso([() => new Response(null, { status: 307, headers: { location: 'https://exemplo.test/' } })])
    await expect(
      classificador().classificar({ texto: 't', perguntas: { pedidos: PEDIDOS, suspeita: SUSPEITA } }),
    ).rejects.toBeInstanceOf(FalhaDeClassificacao)
    expect(pedidos).toHaveLength(1)
  })

  it(`o prazo por pergunta é de ${TEMPO_LIMITE_MS / 1000} s, e vai na chamada`, async () => {
    const pedidos = servidorFalso([() => respostaComLogprobs([{ token: 'A', p: 1 }])])
    await classificador().classificar({ texto: 't', perguntas: { pedidos: PEDIDOS } })
    expect(pedidos[0]!.init.signal).toBeInstanceOf(AbortSignal)
  })

  it('sem endereço, não sobe', () => {
    expect(() => clienteClassificadorLocal('', undefined)).toThrow(/IA_LOCAL_URL/)
  })
})

describe('a configuração e a fábrica', () => {
  beforeEach(() => {
    limparCacheDeAmbiente()
    vi.stubEnv('CLASSIFICADOR_ADAPTER', 'local')
    vi.stubEnv('IA_LOCAL_URL', BASE)
    vi.stubEnv('IA_MODELO', 'qwen2.5:1.5b-instruct-q4_K_M')
    vi.stubEnv('CLASSIFICADOR_MODELO', '')
    vi.stubEnv('IA_TETO_DIARIO', '0')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    limparCacheDeAmbiente()
    esquecerDisjuntores()
  })

  it('"local" sobe com o endereço e o modelo da IA local, e a fábrica o entrega', () => {
    expect(() => ambiente()).not.toThrow()
    expect(criarClassificadorPort()?.fornecedor).toBe('local')
  })

  it('sem modelo próprio, pergunta ao mesmo modelo da interpretação', async () => {
    const pedidos = servidorFalso([() => respostaComLogprobs([{ token: 'B', p: 1 }])])
    await criarClassificadorPort()!.classificar({ texto: 't', perguntas: { pedidos: PEDIDOS } })
    expect(pedidos[0]!.corpo['model']).toBe('qwen2.5:1.5b-instruct-q4_K_M')
  })

  it('sem IA_LOCAL_URL, recusa dizendo o que falta', () => {
    vi.stubEnv('IA_LOCAL_URL', '')
    expect(() => ambiente()).toThrow(/CLASSIFICADOR_ADAPTER="local" exige IA_LOCAL_URL/)
  })

  it('sem modelo nenhum, recusa: servidor local não tem padrão', () => {
    vi.stubEnv('IA_MODELO', '')
    expect(() => ambiente()).toThrow(/exige CLASSIFICADOR_MODELO ou IA_MODELO/)
  })

  // A recusa do endereço público valia só com `IA_ADAPTER=local`; sem esta
  // checagem, o classificador mandaria o texto para a internet com o nome de "local".
  it('endereço público é recusado, mesmo com a IA da interpretação em outro fornecedor', () => {
    vi.stubEnv('IA_ADAPTER', 'mock')
    vi.stubEnv('IA_LOCAL_URL', 'https://modelo.exemplo.test/v1')
    expect(() => ambiente()).toThrow(/IA_LOCAL_URL/)
  })

  // `A70` e `A56 (e)`: o classificador próprio não recebe e-mail real enquanto o dono não decidir.
  it('com caixa de e-mail real, recusa na partida', () => {
    vi.stubEnv('INGESTAO_ADAPTER', 'graph')
    vi.stubEnv('IA_ADAPTER', 'anthropic')
    vi.stubEnv('ANTHROPIC_API_KEY', 'chave-de-teste')
    expect(() => ambiente()).toThrow(/não pode recebê-lo/)
  })
})
