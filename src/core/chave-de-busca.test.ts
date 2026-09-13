import { describe, expect, it } from 'vitest'

import { lerCamposDeBusca, normalizarCpf, normalizarMatricula } from './chave-de-busca'

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

/**
 * Qual matrícula pode virar chave de busca (`A41`, resposta 28).
 *
 * Só números, e o dono não sabe quantos. A matrícula fica sem data de
 * exclusão e SEM proteção, então o que não parece matrícula não entra.
 */
describe('matrícula que pode virar chave de busca', () => {
  it('só dígitos, de 3 a 10, com ou sem separador', () => {
    expect(normalizarMatricula('123')).toBe('123')
    expect(normalizarMatricula('1234567890')).toBe('1234567890')
    expect(normalizarMatricula(' 12.345-6 ')).toBe('123456')
  })

  it('com letra não é matrícula — pode ser um nome', () => {
    expect(normalizarMatricula('A12345')).toBeNull()
    expect(normalizarMatricula('Helena Prado')).toBeNull()
  })

  it('com 11 dígitos ou mais não entra: pode ser um CPF sem proteção', () => {
    expect(normalizarMatricula('11144477735')).toBeNull()
    expect(normalizarMatricula('111.444.777-35')).toBeNull()
    expect(normalizarMatricula('123456789012')).toBeNull()
  })

  it('curta demais ou vazia não entra', () => {
    expect(normalizarMatricula('12')).toBeNull()
    expect(normalizarMatricula('')).toBeNull()
  })
})

describe('CPF e matrícula lidos dos campos extraídos', () => {
  it('acha o campo com o nome escrito de qualquer jeito', () => {
    expect(lerCamposDeBusca({ 'C.P.F.': '111.444.777-35', 'Matrícula': '12.345' })).toEqual({
      cpf: '11144477735',
      matricula: '12345',
    })
  })

  it('o mesmo CPF repetido em dois campos continua valendo', () => {
    expect(lerCamposDeBusca({ cpf: '111.444.777-35', CPF: '11144477735' }).cpf).toBe('11144477735')
  })

  it('dois CPFs válidos diferentes no mesmo item não geram chave', () => {
    // Ambíguo — e pode ser um e-mail tentando pendurar o item no CPF de outra
    // pessoa. Sem chave, o item continua achável pela data de chegada.
    expect(lerCamposDeBusca({ cpf: '111.444.777-35', CPF: '529.982.247-25' }).cpf).toBeNull()
    expect(lerCamposDeBusca({ matricula: '1234', Matricula: '5678' }).matricula).toBeNull()
  })

  it('campo com outro nome não vira chave, mesmo com número de CPF', () => {
    expect(lerCamposDeBusca({ telefone: '111.444.777-35', nome: '12345' })).toEqual({
      cpf: null,
      matricula: null,
    })
  })
})
