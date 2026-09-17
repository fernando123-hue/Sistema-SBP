import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { LIMITES_PADRAO, type LimitesDeConsumo } from '../core/ia/consumo'
import { LimiteDeConsumoAtingido, type RegistroDeConsumo } from '../ports/consumo'
import type { ClienteDeModelo } from './fornecedor'
import { comControleDeConsumo, esquecerDisjuntores } from './cliente-com-consumo'

/**
 * O controle de consumo em volta de QUALQUER cliente de modelo (`A54`, C-06).
 *
 * Fica fora dos adapters de fornecedor de propósito: teto e disjuntor são
 * política deste sistema, igual para Anthropic, Gemini e servidor local — a
 * mesma razão que mantém as três camadas contra injeção em `ia-estruturada.ts`.
 */

const ESQUEMA = z.object({ ok: z.boolean() })
const PEDIDO = { instrucoes: 'x', conteudo: 'y', modelo: 'modelo-teste', esquema: ESQUEMA }

const LIMITES: LimitesDeConsumo = { tetoDiarioDeChamadas: 3, falhasParaAbrir: 2, minutosAberto: 10 }

let registradas: { fornecedor: string; modelo: string; tarefa: string; resultado: string; duracaoMs: number }[]
let chamadasHoje: number

const registro: RegistroDeConsumo = {
  async chamadasDoDia() {
    return chamadasHoje
  },
  async registrar(chamada) {
    registradas.push(chamada)
  },
}

function clienteQue(resposta: () => Promise<{ objeto: unknown; modeloUsado: string }>): ClienteDeModelo {
  return { gerar: resposta }
}

const OK = clienteQue(async () => ({ objeto: { ok: true }, modeloUsado: 'modelo-datado' }))

function envolver(cliente: ClienteDeModelo, limites: LimitesDeConsumo = LIMITES): ClienteDeModelo {
  return comControleDeConsumo(cliente, { fornecedor: 'fornecedor-teste', tarefa: 'interpretacao', registro, limites })
}

beforeEach(() => {
  registradas = []
  chamadasHoje = 0
  esquecerDisjuntores()
})

describe('registro de uso', () => {
  it('chamada que deu certo é registrada com o modelo que o fornecedor usou', async () => {
    await envolver(OK).gerar(PEDIDO)
    expect(registradas).toEqual([
      expect.objectContaining({
        fornecedor: 'fornecedor-teste',
        modelo: 'modelo-datado',
        tarefa: 'interpretacao',
        resultado: 'ok',
      }),
    ])
  })

  it('chamada que falhou também é registrada — ela foi paga', async () => {
    const quebrado = clienteQue(async () => {
      throw new Error('503 fora do ar')
    })
    await expect(envolver(quebrado).gerar(PEDIDO)).rejects.toThrow('503 fora do ar')
    expect(registradas[0]).toMatchObject({ resultado: 'falha', modelo: 'modelo-teste' })
  })

  it('o erro do fornecedor sobe como veio — o invólucro não engole nem traduz', async () => {
    const erro = new Error('qualquer coisa')
    await expect(
      envolver(
        clienteQue(async () => {
          throw erro
        }),
      ).gerar(PEDIDO),
    ).rejects.toBe(erro)
  })

  it('falha ao registrar não derruba a chamada que deu certo', async () => {
    // O contrário seria perder trabalho já feito por causa da contabilidade.
    const registroQuebrado: RegistroDeConsumo = {
      chamadasDoDia: async () => 0,
      registrar: async () => {
        throw new Error('banco fora')
      },
    }
    const cliente = comControleDeConsumo(OK, {
      fornecedor: 'f',
      tarefa: 'interpretacao',
      registro: registroQuebrado,
      limites: LIMITES,
    })
    await expect(cliente.gerar(PEDIDO)).resolves.toMatchObject({ objeto: { ok: true } })
  })
})

describe('teto diário', () => {
  it('no teto, nem chega a chamar o fornecedor', async () => {
    chamadasHoje = 3
    let chamou = false
    const cliente = envolver(
      clienteQue(async () => {
        chamou = true
        return { objeto: {}, modeloUsado: 'm' }
      }),
    )

    await expect(cliente.gerar(PEDIDO)).rejects.toBeInstanceOf(LimiteDeConsumoAtingido)
    expect(chamou).toBe(false)
    expect(registradas).toEqual([])
  })

  it('a mensagem diz o teto e como mudá-lo', async () => {
    chamadasHoje = 3
    await expect(envolver(OK).gerar(PEDIDO)).rejects.toThrow(/IA_TETO_DIARIO/)
  })
})

describe('disjuntor', () => {
  const quebrado = clienteQue(async () => {
    throw new Error('503 fora do ar')
  })

  it('depois de N falhas seguidas, para de chamar o fornecedor', async () => {
    const cliente = envolver(quebrado)
    await expect(cliente.gerar(PEDIDO)).rejects.toThrow('503')
    await expect(cliente.gerar(PEDIDO)).rejects.toThrow('503')

    await expect(cliente.gerar(PEDIDO)).rejects.toBeInstanceOf(LimiteDeConsumoAtingido)
    expect(registradas).toHaveLength(2)
  })

  it('falhas ao mesmo tempo não se perdem: o disjuntor abre na conta certa', async () => {
    // O estado do disjuntor era lido ANTES do `await` da chamada e gravado
    // depois dela. Duas chamadas simultâneas liam "0 falhas", as duas falhavam
    // e as duas gravavam "1" — uma falha real sumia, e o disjuntor abria uma
    // rodada depois do que `falhasParaAbrir` promete. O assistente é chamado
    // por requisições concorrentes de pessoas diferentes: é cenário de todo
    // dia, não hipótese.
    const cliente = envolver(quebrado)
    const duas = await Promise.allSettled([cliente.gerar(PEDIDO), cliente.gerar(PEDIDO)])
    expect(duas.map((r) => r.status)).toEqual(['rejected', 'rejected'])

    await expect(cliente.gerar(PEDIDO)).rejects.toBeInstanceOf(LimiteDeConsumoAtingido)
  })

  it('o disjuntor é do FORNECEDOR, não da tarefa: a ingestão que o abre também poupa o assistente', async () => {
    // O que está fora do ar é o fornecedor. Um disjuntor por tarefa deixaria a
    // segunda tarefa redescobrir a queda, pagando de novo.
    const daIngestao = envolver(quebrado)
    await expect(daIngestao.gerar(PEDIDO)).rejects.toThrow('503')
    await expect(daIngestao.gerar(PEDIDO)).rejects.toThrow('503')

    const doAssistente = comControleDeConsumo(OK, {
      fornecedor: 'fornecedor-teste',
      tarefa: 'assistente',
      registro,
      limites: LIMITES,
    })
    await expect(doAssistente.gerar(PEDIDO)).rejects.toBeInstanceOf(LimiteDeConsumoAtingido)
  })

  it('fornecedores diferentes têm disjuntores diferentes', async () => {
    const um = envolver(quebrado)
    await expect(um.gerar(PEDIDO)).rejects.toThrow('503')
    await expect(um.gerar(PEDIDO)).rejects.toThrow('503')

    const outro = comControleDeConsumo(OK, {
      fornecedor: 'outro-fornecedor',
      tarefa: 'interpretacao',
      registro,
      limites: LIMITES,
    })
    await expect(outro.gerar(PEDIDO)).resolves.toMatchObject({ objeto: { ok: true } })
  })

  it('falha de FORMA não abre o disjuntor — o fornecedor respondeu', async () => {
    // Resposta fora do esquema é problema do e-mail ou do prompt, não do
    // fornecedor. Abrir o disjuntor aqui suspenderia a IA inteira por causa de
    // dois e-mails difíceis seguidos.
    const forma = clienteQue(async () => {
      throw new z.ZodError([{ code: 'custom', path: [], message: 'forma errada' }])
    })
    const cliente = envolver(forma)
    await expect(cliente.gerar(PEDIDO)).rejects.toThrow(/forma errada/)
    await expect(cliente.gerar(PEDIDO)).rejects.toThrow(/forma errada/)
    await expect(cliente.gerar(PEDIDO)).rejects.toThrow(/forma errada/)

    expect(registradas).toHaveLength(3)
    expect(registradas.every((chamada) => chamada.resultado === 'falha')).toBe(true)
  })

  it('sucesso no meio zera a contagem', async () => {
    let falhar = true
    const cliente = envolver(
      clienteQue(async () => {
        if (falhar) throw new Error('503')
        return { objeto: {}, modeloUsado: 'm' }
      }),
    )
    await expect(cliente.gerar(PEDIDO)).rejects.toThrow('503')
    falhar = false
    await cliente.gerar(PEDIDO)
    falhar = true
    await expect(cliente.gerar(PEDIDO)).rejects.toThrow('503')

    // Se a contagem não tivesse zerado, esta seria a terceira falha e o
    // disjuntor já estaria aberto.
    await expect(cliente.gerar(PEDIDO)).rejects.toThrow('503')
  })
})

describe('LIMITES_PADRAO como padrão do invólucro', () => {
  it('sem limites explícitos, valem os do núcleo', async () => {
    chamadasHoje = LIMITES_PADRAO.tetoDiarioDeChamadas
    const cliente = comControleDeConsumo(OK, { fornecedor: 'f', tarefa: 'interpretacao', registro })
    await expect(cliente.gerar(PEDIDO)).rejects.toBeInstanceOf(LimiteDeConsumoAtingido)
  })
})
