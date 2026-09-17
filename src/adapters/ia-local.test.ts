import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { MARCADOR_FIM, MARCADOR_INICIO } from '../core/seguranca/conteudo-nao-confiavel'
import { EmailBrutoSchema, type EmailBruto } from '../core/esquemas'
import { InterpretacaoIndisponivelError } from '../ports/ia'
import { limparCacheDeAmbiente } from '../servidor/ambiente'
import { clienteLocal, IaLocal, PERFIL_LOCAL } from './ia-local'

/**
 * Testes do adapter local — contra um SERVIDOR DE VERDADE, falso.
 *
 * Aqui não cabe duble de `fetch`: o que este adapter tem de provar é que ele
 * fala o protocolo que Ollama, llama.cpp, vLLM e LM Studio falam (`A56 (b)`).
 * Um duble provaria que o adapter chama a função que o teste escreveu. Então
 * sobe um `node:http` em `127.0.0.1`, porta efêmera, que responde como um
 * servidor compatível com OpenAI — e que também sabe responder errado.
 *
 * Nenhum modelo roda aqui: a máquina da IA local ainda nem chegou (`A56 (d)`).
 * O que está sendo testado é o cano, não o que passa dentro dele.
 */

type Resposta = { status: number; corpo: unknown }

let servidor: Server
let endereco: string
let pedidos: { caminho: string; cabecalhos: NodeJS.Dict<string | string[]>; corpo: any }[] = []
let proximaResposta: Resposta

const RESPOSTA_VALIDA = {
  itens: [
    {
      categoriaCodigo: 'FICHA_CADASTRO',
      titulo: 'Envio de ficha',
      confianca: 0.9,
      campos: [{ chave: 'nome', valor: 'Fulano Sintético' }],
      camposAusentes: ['cpf'],
      ligaMencionada: null,
      observacao: null,
    },
  ],
  pareceInstrucao: false,
}

/** Esquema simples só para ver a forma viajar; o de verdade é o do núcleo. */
const ESQUEMA_DE_TESTE = z.object({ itens: z.array(z.string()), pareceInstrucao: z.boolean() })

function respostaDoServidor(conteudo: string, fim = 'stop', modelo = 'qwen-teste-datado'): Resposta {
  return {
    status: 200,
    corpo: { model: modelo, choices: [{ finish_reason: fim, message: { role: 'assistant', content: conteudo } }] },
  }
}

function email(parcial: Partial<EmailBruto> = {}): EmailBruto {
  return EmailBrutoSchema.parse({
    messageId: 'teste-local@exemplo.test',
    remetente: 'alguem@exemplo.test',
    assunto: 'Envio de ficha',
    corpo: 'Segue a ficha de cadastro. Nome: Fulano Sintético',
    recebidoEm: new Date('2026-09-17T12:00:00.000Z'),
    ...parcial,
  })
}

beforeEach(async () => {
  pedidos = []
  proximaResposta = respostaDoServidor(JSON.stringify(RESPOSTA_VALIDA))

  servidor = createServer((requisicao: IncomingMessage, resposta: ServerResponse) => {
    const pedacos: Buffer[] = []
    requisicao.on('data', (pedaco: Buffer) => pedacos.push(pedaco))
    requisicao.on('end', () => {
      const texto = Buffer.concat(pedacos).toString('utf8')
      pedidos.push({
        caminho: requisicao.url ?? '',
        cabecalhos: requisicao.headers,
        corpo: texto ? JSON.parse(texto) : null,
      })
      resposta.writeHead(proximaResposta.status, { 'content-type': 'application/json' })
      resposta.end(JSON.stringify(proximaResposta.corpo))
    })
  })

  await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto))
  endereco = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/v1`

  vi.stubEnv('IA_ADAPTER', 'local')
  vi.stubEnv('IA_LOCAL_URL', endereco)
  vi.stubEnv('IA_MODELO', 'qwen-de-teste')
  vi.stubEnv('IA_LOCAL_CHAVE', '')
  limparCacheDeAmbiente()
})

afterEach(async () => {
  vi.unstubAllEnvs()
  limparCacheDeAmbiente()
  await new Promise<void>((pronto) => servidor.close(() => pronto()))
})

describe('clienteLocal — o protocolo compatível com OpenAI', () => {
  it('fala com /chat/completions do endereço configurado', async () => {
    await clienteLocal().gerar({
      instrucoes: 'INSTRUÇÕES',
      conteudo: 'conteúdo',
      modelo: 'qwen-de-teste',
      esquema: ESQUEMA_DE_TESTE,
    })

    expect(pedidos).toHaveLength(1)
    expect(pedidos[0]?.caminho).toBe('/v1/chat/completions')
    expect(pedidos[0]?.corpo.model).toBe('qwen-de-teste')
    expect(pedidos[0]?.corpo.temperature).toBe(0)
    expect(pedidos[0]?.corpo.messages).toHaveLength(2)
    expect(pedidos[0]?.corpo.messages[0]).toMatchObject({ role: 'system' })
    expect(pedidos[0]?.corpo.messages[1]).toMatchObject({ role: 'user', content: 'conteúdo' })
  })

  it('a forma esperada viaja junto das instruções, derivada do mesmo Zod', async () => {
    await clienteLocal().gerar({
      instrucoes: 'INSTRUÇÕES',
      conteudo: 'conteúdo',
      modelo: 'qwen-de-teste',
      esquema: ESQUEMA_DE_TESTE,
    })

    const sistema: string = pedidos[0]?.corpo.messages[0].content
    expect(sistema.startsWith('INSTRUÇÕES')).toBe(true)
    expect(sistema).toContain('JSON Schema')
    expect(sistema).toContain('pareceInstrucao')
  })

  it('devolve o modelo que o SERVIDOR diz ter usado, não o apelido pedido', async () => {
    const { modeloUsado, objeto } = await clienteLocal().gerar({
      instrucoes: 'x',
      conteudo: 'y',
      modelo: 'qwen-de-teste',
      esquema: ESQUEMA_DE_TESTE,
    })
    expect(modeloUsado).toBe('qwen-teste-datado')
    expect(objeto).toEqual(RESPOSTA_VALIDA)
  })

  it('sem IA_LOCAL_CHAVE não manda Authorization; com ela, manda', async () => {
    await clienteLocal().gerar({ instrucoes: 'x', conteudo: 'y', modelo: 'm', esquema: ESQUEMA_DE_TESTE })
    expect(pedidos[0]?.cabecalhos.authorization).toBeUndefined()

    vi.stubEnv('IA_LOCAL_CHAVE', 'token-de-teste')
    limparCacheDeAmbiente()
    await clienteLocal().gerar({ instrucoes: 'x', conteudo: 'y', modelo: 'm', esquema: ESQUEMA_DE_TESTE })
    expect(pedidos[1]?.cabecalhos.authorization).toBe('Bearer token-de-teste')
  })

  it('resposta embrulhada em cerca de código ainda é lida — modelo pequeno faz isso', async () => {
    proximaResposta = respostaDoServidor('```json\n{"itens":[]}\n```')
    const { objeto } = await clienteLocal().gerar({
      instrucoes: 'x',
      conteudo: 'y',
      modelo: 'm',
      esquema: ESQUEMA_DE_TESTE,
    })
    expect(objeto).toEqual({ itens: [] })
  })

  it('geração cortada por limite de tokens é falha, nunca meia resposta', async () => {
    proximaResposta = respostaDoServidor('{"itens":[', 'length')
    await expect(
      clienteLocal().gerar({ instrucoes: 'x', conteudo: 'y', modelo: 'm', esquema: ESQUEMA_DE_TESTE }),
    ).rejects.toThrow(/truncada/i)
  })

  it('resposta sem conteúdo é falha explícita, não e-mail sem item', async () => {
    proximaResposta = respostaDoServidor('')
    await expect(
      clienteLocal().gerar({ instrucoes: 'x', conteudo: 'y', modelo: 'm', esquema: ESQUEMA_DE_TESTE }),
    ).rejects.toThrow(/vazia/i)
  })

  it('erro do servidor não devolve o corpo da resposta — ele pode repetir o e-mail', async () => {
    // O servidor local costuma ecoar o pedido na mensagem de erro, e o pedido
    // tem o corpo do e-mail. Copiá-lo para o erro o levaria ao log, que não tem
    // retenção (invariante 11).
    proximaResposta = { status: 500, corpo: { error: { message: 'falhou ao processar: Nome: Fulano Sintético' } } }
    await expect(
      clienteLocal().gerar({ instrucoes: 'x', conteudo: 'y', modelo: 'm', esquema: ESQUEMA_DE_TESTE }),
    ).rejects.toThrow(expect.objectContaining({ message: expect.not.stringContaining('Fulano') }))
    await expect(
      clienteLocal().gerar({ instrucoes: 'x', conteudo: 'y', modelo: 'm', esquema: ESQUEMA_DE_TESTE }),
    ).rejects.toThrow(/500/)
  })

  it('corpo 200 que não é JSON vira falha, não resposta vazia', async () => {
    // Servidor que devolve HTML de erro com status 200 existe: sem isto, o
    // `resposta.json()` estouraria com a mensagem do runtime.
    servidor.close()
    servidor = createServer((_requisicao, resposta) => {
      resposta.writeHead(200, { 'content-type': 'application/json' })
      resposta.end('<html>erro do proxy</html>')
    })
    await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto))
    vi.stubEnv('IA_LOCAL_URL', `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/v1`)
    limparCacheDeAmbiente()

    await expect(
      clienteLocal().gerar({ instrucoes: 'x', conteudo: 'y', modelo: 'm', esquema: ESQUEMA_DE_TESTE }),
    ).rejects.toThrow(/resposta do servidor não é JSON/i)
  })

  it('endereço não configurado é recusado na construção do cliente', () => {
    vi.stubEnv('IA_ADAPTER', 'mock')
    vi.stubEnv('IA_LOCAL_URL', '')
    limparCacheDeAmbiente()
    expect(() => clienteLocal()).toThrow(/IA_LOCAL_URL/)
  })
})

describe('PERFIL_LOCAL', () => {
  it('chama-se "local" e não tem modelo padrão — quem escolhe é IA_MODELO', () => {
    expect(PERFIL_LOCAL.nome).toBe('local')
    expect(PERFIL_LOCAL.modeloPadrao).toBe('')
    expect(PERFIL_LOCAL.versaoPrompt.startsWith('local-')).toBe(true)
  })

  it('401 e 403 são credencial recusada; 500 e 503 não', () => {
    expect(PERFIL_LOCAL.ehCredencialRecusada(Object.assign(new Error('x'), { status: 401 }))).toBe(true)
    expect(PERFIL_LOCAL.ehCredencialRecusada(Object.assign(new Error('x'), { status: 403 }))).toBe(true)
    expect(PERFIL_LOCAL.ehCredencialRecusada(Object.assign(new Error('x'), { status: 500 }))).toBe(false)
    expect(PERFIL_LOCAL.ehCredencialRecusada(new Error('qualquer'))).toBe(false)
  })
})

describe('IaLocal — a política do sistema, igual à dos outros fornecedores', () => {
  it('interpreta e marca o fornecedor e a versão do prompt', async () => {
    const interpretacao = await new IaLocal().interpretar(email())
    expect(interpretacao.modelo).toBe('qwen-teste-datado')
    expect(interpretacao.versaoPrompt).toBe(PERFIL_LOCAL.versaoPrompt)
    expect(interpretacao.itens[0]?.categoriaCodigo).toBe('FICHA_CADASTRO')
  })

  it('o conteúdo do e-mail vai delimitado como não confiável', async () => {
    await new IaLocal().interpretar(email())
    const conteudo: string = pedidos[0]?.corpo.messages[1].content
    expect(conteudo).toContain(MARCADOR_INICIO)
    expect(conteudo).toContain(MARCADOR_FIM)
    expect(conteudo.indexOf(MARCADOR_INICIO)).toBeLessThan(conteudo.indexOf('Fulano Sintético'))
  })

  it('servidor que recusa a credencial derruba o lote, não o e-mail', async () => {
    proximaResposta = { status: 401, corpo: { error: { message: 'unauthorized' } } }
    await expect(new IaLocal().interpretar(email())).rejects.toBeInstanceOf(InterpretacaoIndisponivelError)
  })

  it('servidor fora do ar vira falha deste e-mail, que vai para revisão humana', async () => {
    await new Promise<void>((pronto) => servidor.close(() => pronto()))
    await expect(new IaLocal().interpretar(email())).rejects.toThrow(/interpretar/i)
    // Reabre para o `afterEach` não falhar ao fechar duas vezes.
    servidor = createServer()
    await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto))
  })
})
