import { describe, expect, it } from 'vitest'

import {
  MENSAGEM_BUSCA_NAO_RECONHECIDA,
  MENSAGEM_CPF_NAO_CONFERE,
  interpretarBusca,
} from './busca-por-chave'

/**
 * O que a pessoa digitou no campo "Buscar por CPF ou matrícula" (`A40`,
 * resposta 24).
 *
 * A resposta vira uma de três coisas: um CPF para proteger e procurar, uma
 * matrícula para procurar, ou uma frase clara dizendo o que corrigir.
 */

describe('o que a pessoa digitou na busca', () => {
  it('CPF válido, com ou sem pontos', () => {
    expect(interpretarBusca('111.444.777-35')).toEqual({ tipo: 'cpf', cpf: '11144477735' })
    expect(interpretarBusca('11144477735')).toEqual({ tipo: 'cpf', cpf: '11144477735' })
  })

  it('matrícula só com números', () => {
    expect(interpretarBusca('12345')).toEqual({ tipo: 'matricula', matricula: '12345' })
    expect(interpretarBusca(' 12.345 ')).toEqual({ tipo: 'matricula', matricula: '12345' })
  })

  it('11 números que não conferem é CPF errado, não matrícula', () => {
    // Quem digita 11 números quer achar um CPF. Procurar como matrícula daria
    // "nada encontrado", e a pessoa concluiria que o item não existe.
    expect(interpretarBusca('111.444.777-36')).toEqual({ tipo: 'cpf_nao_confere' })
  })

  it('com letra, curto demais ou vazio não é busca que o sistema entenda', () => {
    expect(interpretarBusca('Helena Prado')).toEqual({ tipo: 'nao_reconhecido' })
    expect(interpretarBusca('12')).toEqual({ tipo: 'nao_reconhecido' })
    expect(interpretarBusca('')).toEqual({ tipo: 'nao_reconhecido' })
  })

  it('as frases para quem digitou são simples e não repetem número nenhum', () => {
    // A frase vai para a tela e pode ir para o registro de erro do servidor:
    // nunca carrega o que foi digitado.
    for (const frase of [MENSAGEM_CPF_NAO_CONFERE, MENSAGEM_BUSCA_NAO_RECONHECIDA]) {
      expect(frase).not.toMatch(/\d{3,}/)
      expect(frase).not.toMatch(/hash|chave|protegid|normaliz/i)
    }
  })
})
