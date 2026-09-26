import { afterEach, describe, expect, it, vi } from 'vitest'

import type { QuemPergunta } from '../core/assistente/prompt'
import { EmailBrutoSchema } from '../core/esquemas'
import { resumoDeTransporte } from '../core/seguranca/resumo-de-transporte'
import { AssistenteComModelo } from './assistente-modelo'
import type { ClienteDeModelo, PerfilDoFornecedor } from './fornecedor'
import { InterpretadorEstruturado } from './ia-estruturada'

/**
 * A mensagem de uma falha de TRANSPORTE vai ao log — e o log não tem política
 * de retenção (invariante 11). Pendência 10 (revisão de segurança do #90).
 *
 * Conferido nos SDKs instalados: nenhum deles ecoa o PEDIDO. A Anthropic monta
 * `"<status> <JSON do erro>"`, o Gemini (fora do streaming) só o JSON do corpo
 * de erro — o texto é o que a própria API devolveu, e vai cru e sem limite
 * quando não é JSON (página de proxy). O risco que sobra é a
 * API citar um trecho do conteúdo nesse corpo (erro de sintaxe "perto de …").
 * Por isso a mensagem vai ao log curta e com e-mail e número de documento
 * mascarados, mantendo o que a operação precisa ler: status e código.
 */

// Dados sintéticos (invariante 8).
const EMAIL_DO_ASSOCIADO = 'associada.ficticia@exemplo.test'
const CPF_DO_ASSOCIADO = '123.456.789-09'
const ERRO_DO_FORNECEDOR =
  `400 {"type":"error","error":{"type":"invalid_request_error","message":"texto inválido perto de ` +
  `\\"${EMAIL_DO_ASSOCIADO}, CPF ${CPF_DO_ASSOCIADO}\\""},"request_id":"req_teste"}`

describe('resumoDeTransporte', () => {
  it('mantém status e código do fornecedor', () => {
    expect(resumoDeTransporte('503 {"error":{"type":"overloaded_error"}}')).toContain('503')
    expect(resumoDeTransporte('503 {"error":{"type":"overloaded_error"}}')).toContain('overloaded_error')
    expect(resumoDeTransporte('got status: RESOURCE_EXHAUSTED. {...}')).toContain('RESOURCE_EXHAUSTED')
  })

  it('mascara e-mail e número de documento', () => {
    const resumo = resumoDeTransporte(ERRO_DO_FORNECEDOR)

    expect(resumo).not.toContain(EMAIL_DO_ASSOCIADO)
    expect(resumo).not.toContain(CPF_DO_ASSOCIADO)
    expect(resumo).not.toContain('12345678909')
    expect(resumoDeTransporte('cpf 12345678909')).not.toContain('12345678909')
    expect(resumo).toContain('400')
  })

  it('corta mensagem longa', () => {
    expect(resumoDeTransporte('x'.repeat(5000)).length).toBeLessThan(400)
  })

  // O que as revisões do #132 mediram passando inteiro.
  it('pega travessão, espaço duplo, CRM curto e e-mail escapado em URL', () => {
    expect(resumoDeTransporte('tel 91234\u20135678')).not.toMatch(/\d{4}/)
    expect(resumoDeTransporte('cpf 123  456  789  09')).not.toMatch(/\d{3}/)
    expect(resumoDeTransporte('CRM-SP 123456 e RQE 4321')).toBe('CRM-SP [número] e RQE [número]')
    expect(resumoDeTransporte('de associada%40exemplo.test')).toBe('de [e-mail]')
  })

  it('quebra de linha separa o status do número seguinte', () => {
    expect(resumoDeTransporte('503\n12345678')).toBe('503\n[número]')
  })

  // Página de erro de proxy com base64 ou JS minificado: 100 mil caracteres
  // sem espaço paravam o servidor por quase 6 s (revisões do #132).
  it('não trava com mensagem enorme sem espaço', () => {
    const inicio = performance.now()
    resumoDeTransporte('a'.repeat(200_000))
    resumoDeTransporte(`${'1-'.repeat(100_000)}`)
    expect(performance.now() - inicio).toBeLessThan(200)
  })
})

const PERFIL: PerfilDoFornecedor = {
  nome: 'teste',
  versaoPrompt: 'teste-1.0.0',
  modeloPadrao: 'modelo-de-teste',
  ehCredencialRecusada: () => false,
}

function clienteQueFalha(): ClienteDeModelo {
  return {
    async gerar() {
      throw new Error(ERRO_DO_FORNECEDOR)
    },
  }
}

function linhasDoLog(): { linhas: () => string } {
  const escritas: string[] = []
  const guardar = (pedaco: unknown) => {
    escritas.push(String(pedaco))
    return true
  }
  vi.spyOn(process.stdout, 'write').mockImplementation(guardar as never)
  vi.spyOn(process.stderr, 'write').mockImplementation(guardar as never)
  return { linhas: () => escritas.join('') }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('falha de transporte no log', () => {
  it('interpretação: o log diz o status, e não o e-mail nem o CPF citados pelo fornecedor', async () => {
    const log = linhasDoLog()
    const email = EmailBrutoSchema.parse({
      messageId: 'transporte@teste.local',
      remetente: 'alguem@exemplo.test',
      assunto: 'Assunto qualquer',
      corpo: 'Corpo qualquer',
      recebidoEm: new Date('2026-09-26T12:00:00.000Z'),
    })

    // A falha sobe (o e-mail vai para revisão) — e a mensagem dela também é a
    // mascarada: é ela que vai ao log da ingestão e ao motivo da avaliação.
    // (A trilha grava só o nome da classe: `mensagemPersistivel`.)
    const falha = await new InterpretadorEstruturado(PERFIL, clienteQueFalha()).interpretar(email).then(
      () => null,
      (erro: unknown) => (erro instanceof Error ? erro.message : String(erro)),
    )
    expect(falha).toContain('400')
    expect(falha).not.toContain(EMAIL_DO_ASSOCIADO)
    expect(falha).not.toContain(CPF_DO_ASSOCIADO)

    expect(log.linhas()).toContain('chamada ao modelo falhou')
    expect(log.linhas()).toContain('400')
    expect(log.linhas()).not.toContain(EMAIL_DO_ASSOCIADO)
    expect(log.linhas()).not.toContain(CPF_DO_ASSOCIADO)
  })

  it('assistente: o mesmo', async () => {
    const log = linhasDoLog()
    const quem: QuemPergunta = { nome: '', papel: 'operador', itensNaFila: 0 }

    await new AssistenteComModelo(PERFIL, clienteQueFalha())
      .responder(quem, 'como distribuo o dia?')
      .catch(() => null)

    expect(log.linhas()).toContain('chamada do assistente ao modelo falhou')
    expect(log.linhas()).toContain('400')
    expect(log.linhas()).not.toContain(EMAIL_DO_ASSOCIADO)
    expect(log.linhas()).not.toContain(CPF_DO_ASSOCIADO)
  })
})

// O ramo "indisponível" é escolhido POR TEXTO (o Gemini casa
// "API key not valid" em qualquer mensagem, sem olhar o status). Um remetente
// que escrevesse essa frase levaria a citação para cá — e daqui a mensagem vai
// ao log e, na interpretação, à tela. Mascarado também (revisões do #132).
describe('falha que para o lote', () => {
  const PERFIL_QUE_RECUSA: PerfilDoFornecedor = { ...PERFIL, ehCredencialRecusada: () => true }
  const mensagemDe = (erro: unknown) => (erro instanceof Error ? erro.message : String(erro))

  it('interpretação indisponível: mantém o status, mascara o que foi citado', async () => {
    const email = EmailBrutoSchema.parse({
      messageId: 'indisponivel@teste.local',
      remetente: 'alguem@exemplo.test',
      assunto: 'Assunto qualquer',
      corpo: 'Corpo qualquer',
      recebidoEm: new Date('2026-09-26T12:00:00.000Z'),
    })
    const falha = await new InterpretadorEstruturado(PERFIL_QUE_RECUSA, clienteQueFalha())
      .interpretar(email)
      .then(() => null, mensagemDe)

    expect(falha).toContain('400')
    expect(falha).not.toContain(EMAIL_DO_ASSOCIADO)
    expect(falha).not.toContain(CPF_DO_ASSOCIADO)
  })

  it('assistente indisponível: o mesmo', async () => {
    const quem: QuemPergunta = { nome: '', papel: 'operador', itensNaFila: 0 }
    const falha = await new AssistenteComModelo(PERFIL_QUE_RECUSA, clienteQueFalha())
      .responder(quem, 'como distribuo o dia?')
      .then(() => null, mensagemDe)

    expect(falha).toContain('400')
    expect(falha).not.toContain(EMAIL_DO_ASSOCIADO)
    expect(falha).not.toContain(CPF_DO_ASSOCIADO)
  })
})
