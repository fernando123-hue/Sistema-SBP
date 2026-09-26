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
 * `"<status> <JSON do erro>"`, o Gemini `"got status: … <JSON do erro>"` — o
 * texto é o corpo de erro que a própria API devolveu. O risco que sobra é a
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
    // mascarada: é ela que a trilha grava.
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
    expect(log.linhas()).not.toContain(EMAIL_DO_ASSOCIADO)
    expect(log.linhas()).not.toContain(CPF_DO_ASSOCIADO)
  })
})
