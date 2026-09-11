import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RespostaDoModeloAssistente } from '../core/assistente/esquemas'
import type { AssistentePort } from '../ports/assistente'
import { atorDaSessao } from '../servidor/ator'
import { obterPrisma, type Banco } from '../servidor/prisma'
import { limparTudo } from '../testes/apoio'
import { perguntarAoAssistente } from './assistente'

/**
 * `perguntarAoAssistente` — as duas garantias que o serviço declara em prosa.
 *
 * Achado 9 da auditoria de 08/09/2026: o serviço não tinha arquivo de teste. Os
 * adapters são testados (`adapters/assistente.test.ts`), mas as promessas deste
 * arquivo são dele: a SEGUNDA conferência de papel sobre a saída do modelo, e
 * "o texto da pergunta não é persistido, nem na trilha, nem no evento, nem no
 * log". A pergunta mais provável da operação vem com um e-mail colado junto.
 */

const banco = obterPrisma()

const colaborador = atorDaSessao({ colaboradorId: 'colaborador-sintetico', papel: 'colaborador' })
const gestor = atorDaSessao({ colaboradorId: 'gestor-sintetico', papel: 'gestor' })

function assistenteQueResponde(resposta: RespostaDoModeloAssistente): AssistentePort {
  return { nome: 'duble', responder: async () => resposta }
}

const SUGERE_ACESSO: RespostaDoModeloAssistente = {
  resposta: 'Vá em Acesso e destrave a conta.',
  respondida: true,
  verbetesUsados: ['destravar-conta'],
  telaSugerida: '/acesso',
}

beforeEach(async () => {
  await limparTudo(banco)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('perguntarAoAssistente', () => {
  it('tela sugerida fora do papel de quem perguntou chega à tela como nula', async () => {
    const deps = { banco, assistente: assistenteQueResponde(SUGERE_ACESSO) }

    const paraColaborador = await perguntarAoAssistente(deps, 'como destravo?', colaborador)
    const paraGestor = await perguntarAoAssistente(deps, 'como destravo?', gestor)

    expect(paraColaborador.telaSugerida).toBeNull()
    // O par de controle: sem ele, um serviço que apagasse TODA sugestão passaria.
    expect(paraGestor.telaSugerida).toBe('/acesso')
    // A resposta em si continua chegando — só o link é retirado.
    expect(paraColaborador.resposta).toBe(SUGERE_ACESSO.resposta)
  })

  it('o texto da pergunta não sai do processo: nem evento, nem trilha, nem log', async () => {
    const sentinela = 'SENTINELA-8c1f'
    const pergunta = `${sentinela}: o que quer dizer o e-mail de pessoa.sintetica@teste.local?`
    const saida: string[] = []
    const capturar = (pedaco: unknown) => {
      saida.push(String(pedaco))
      return true
    }
    vi.spyOn(process.stdout, 'write').mockImplementation(capturar)
    vi.spyOn(process.stderr, 'write').mockImplementation(capturar)

    // Sugere tela fora do papel de propósito: força o ramo que ESCREVE log.
    await perguntarAoAssistente(
      { banco, assistente: assistenteQueResponde(SUGERE_ACESSO) },
      pergunta,
      colaborador,
    )

    const eventos = await banco.eventoProcessamento.findMany()
    const trilha = await banco.logAuditoria.findMany()

    // Sem estas duas, o teste passaria com um serviço que não registra nada.
    expect(eventos.filter((evento) => evento.etapa === 'assistente')).toHaveLength(1)
    expect(saida.join('')).toContain('assistente sugeriu tela fora do papel')

    expect(JSON.stringify(eventos)).not.toContain(sentinela)
    expect(JSON.stringify(trilha)).not.toContain(sentinela)
    expect(saida.join('')).not.toContain(sentinela)
  })

  it('falha ao registrar o uso não derruba a resposta que já existe', async () => {
    const bancoSemRegistro = new Proxy(banco, {
      get(alvo, chave) {
        if (chave !== 'eventoProcessamento') return Reflect.get(alvo, chave)
        return new Proxy({}, { get: () => () => Promise.reject(new Error('disco cheio')) })
      },
    }) as Banco
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const resposta = await perguntarAoAssistente(
      { banco: bancoSemRegistro, assistente: assistenteQueResponde(SUGERE_ACESSO) },
      'como destravo?',
      gestor,
    )

    expect(resposta).toEqual({
      resposta: SUGERE_ACESSO.resposta,
      respondida: true,
      telaSugerida: '/acesso',
      origem: 'duble',
    })
  })
})
