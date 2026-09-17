import { describe, expect, it } from 'vitest'

import { EmailBrutoSchema } from '../core/esquemas'
import { AssistenteIndisponivelError } from '../ports/assistente'
import { LimiteDeConsumoAtingido } from '../ports/consumo'
import { InterpretacaoIndisponivelError } from '../ports/ia'
import { AssistenteComModelo } from './assistente-modelo'
import type { ClienteDeModelo, PerfilDoFornecedor } from './fornecedor'
import { PERFIL_ANTHROPIC } from './ia-anthropic'
import { InterpretadorEstruturado } from './ia-estruturada'
import { PERFIL_GEMINI } from './ia-gemini'

/**
 * Quando a camada de IA está fora — e por que isso PARA o lote (`A54`, C-06).
 *
 * A auditoria de 17/09/2026 mediu o oposto: com o fornecedor caído ou o
 * crédito acabado, o laço de ingestão errava os 200 e-mails da sincronização
 * um a um, cada um com até três requisições e dois minutos de espera. O
 * comentário de `InterpretacaoIndisponivelError` já prometia parar em "conta
 * sem crédito", e nenhum perfil sabia reconhecer isso.
 */

const PERFIL: PerfilDoFornecedor = {
  nome: 'teste',
  versaoPrompt: 'teste-1.0.0',
  modeloPadrao: 'modelo-teste',
  ehCredencialRecusada: () => false,
}

function clienteQueLanca(erro: unknown): ClienteDeModelo {
  return {
    gerar: async () => {
      throw erro
    },
  }
}

const EMAIL = EmailBrutoSchema.parse({
  messageId: 'consumo@exemplo.test',
  remetente: 'alguem@exemplo.test',
  assunto: 'Ficha',
  corpo: 'Segue a ficha. Nome: Fulano Sintético',
  recebidoEm: new Date('2026-09-18T12:00:00.000Z'),
})

const LIMITE = new LimiteDeConsumoAtingido('teto_diario', 'o teto diário de 500 chamadas à IA foi atingido')

describe('limite de consumo é indisponibilidade da camada, não falha do e-mail', () => {
  it('a interpretação para o lote', async () => {
    const interpretador = new InterpretadorEstruturado(PERFIL, clienteQueLanca(LIMITE))
    await expect(interpretador.interpretar(EMAIL)).rejects.toBeInstanceOf(InterpretacaoIndisponivelError)
  })

  it('a mensagem chega inteira a quem está na tela', async () => {
    const interpretador = new InterpretadorEstruturado(PERFIL, clienteQueLanca(LIMITE))
    await expect(interpretador.interpretar(EMAIL)).rejects.toThrow(/teto diário de 500/)
  })

  it('o assistente responde que está indisponível, sem gastar a segunda tentativa', async () => {
    let chamadas = 0
    const cliente: ClienteDeModelo = {
      gerar: async () => {
        chamadas += 1
        throw LIMITE
      },
    }
    const assistente = new AssistenteComModelo(PERFIL, cliente)
    await expect(
      assistente.responder({ papel: 'operador', nome: 'Alguém', itensNaFila: 0 }, 'como distribuo?'),
    ).rejects.toBeInstanceOf(AssistenteIndisponivelError)
    expect(chamadas).toBe(1)
  })
})

describe('saldo esgotado e cota são indisponibilidade, não falha de transporte deste e-mail', () => {
  it('Anthropic: 400 com "credit balance is too low"', () => {
    const erro = Object.assign(new Error('Your credit balance is too low to access the Anthropic API'), {
      status: 400,
    })
    expect(PERFIL_ANTHROPIC.ehSemCredito?.(erro)).toBe(true)
  })

  it('Anthropic: 400 comum continua sendo falha deste e-mail', () => {
    expect(PERFIL_ANTHROPIC.ehSemCredito?.(Object.assign(new Error('bad request'), { status: 400 }))).toBe(false)
  })

  it('Anthropic: erro NOSSO com o mesmo texto não para a operação', () => {
    // Casar só pelo texto, em qualquer `Error`, deixava um erro interno que
    // mencionasse saldo — uma mensagem de log, um teste, uma validação nossa —
    // parar o lote inteiro pelo motivo errado. Saldo esgotado vem do
    // fornecedor, e vir do fornecedor significa ter status HTTP.
    expect(PERFIL_ANTHROPIC.ehSemCredito?.(new Error('credit balance is too low'))).toBe(false)
  })

  it('Gemini: 429 de cota esgotada', () => {
    const erro = Object.assign(new Error('Quota exceeded: RESOURCE_EXHAUSTED'), { status: 429 })
    expect(PERFIL_GEMINI.ehSemCredito?.(erro)).toBe(true)
  })

  it('Gemini: 503 de sobrecarga NÃO é cota — ele volta sozinho em minutos', () => {
    // Medido em 16/09/2026: 7 de 8 chamadas voltaram 503 e o serviço se
    // recuperou. Tratar isso como "acabou o crédito" pararia a operação por
    // um soluço; o disjuntor é quem cuida desse caso.
    expect(PERFIL_GEMINI.ehSemCredito?.(Object.assign(new Error('overloaded'), { status: 503 }))).toBe(false)
  })

  it('o interpretador para o lote quando o perfil reconhece saldo esgotado', async () => {
    const perfilComSaldo: PerfilDoFornecedor = {
      ...PERFIL,
      ehSemCredito: () => true,
    }
    const interpretador = new InterpretadorEstruturado(perfilComSaldo, clienteQueLanca(new Error('sem saldo')))
    await expect(interpretador.interpretar(EMAIL)).rejects.toBeInstanceOf(InterpretacaoIndisponivelError)
  })
})
