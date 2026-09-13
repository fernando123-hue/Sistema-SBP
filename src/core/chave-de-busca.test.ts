import { describe, expect, it } from 'vitest'

import { normalizarCpf } from './chave-de-busca'

/**
 * Qual CPF pode virar chave de busca (`A23(b)`, `A40` resposta 26).
 *
 * A chave não tem data de exclusão. Só entra CPF que confere: número com erro
 * não gera chave, e o item se acha pela data de chegada. Os números abaixo são
 * sintéticos — `111.444.777-35` é um exemplo clássico de CPF válido de teste.
 */

describe('CPF que pode virar chave de busca', () => {
  it('é o mesmo CPF com ou sem pontuação', () => {
    expect(normalizarCpf('111.444.777-35')).toBe('11144477735')
    expect(normalizarCpf('11144477735')).toBe('11144477735')
    expect(normalizarCpf(' 111 444 777 35 ')).toBe('11144477735')
  })

  it('dígito verificador errado não gera chave', () => {
    expect(normalizarCpf('111.444.777-36')).toBeNull()
    expect(normalizarCpf('111.444.777-45')).toBeNull()
    // Só o PRIMEIRO verificador errado, com o segundo calculado em cima dele.
    // Sem este caso, tirar a conferência do primeiro passava despercebido: nos
    // dois de cima, a segunda conferência recusa o número sozinha.
    expect(normalizarCpf('111.444.777-43')).toBeNull()
  })

  it('número incompleto ou comprido demais não gera chave', () => {
    expect(normalizarCpf('111.444.777-3')).toBeNull()
    expect(normalizarCpf('111.444.777-355')).toBeNull()
    expect(normalizarCpf('')).toBeNull()
  })

  it('todos os dígitos iguais não é CPF, mesmo passando na conta', () => {
    // 111.111.111-11 e 000.000.000-00 fecham os dois dígitos verificadores.
    expect(normalizarCpf('111.111.111-11')).toBeNull()
    expect(normalizarCpf('000.000.000-00')).toBeNull()
  })

  it('texto que não é só o número não vira chave', () => {
    // O campo vem do modelo, que lê conteúdo hostil: "CPF 111..." ou dois
    // números juntos não podem virar uma chave "limpa" por extração de dígitos.
    expect(normalizarCpf('CPF 111.444.777-35')).toBeNull()
    expect(normalizarCpf('111.444.777-35 e 111.444.777-35')).toBeNull()
  })
})
