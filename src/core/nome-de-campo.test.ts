import { describe, expect, it } from 'vitest'

import { CAMPO_FORA_DA_LISTA, nomeDeCampoGravavel } from './nome-de-campo'

describe('nome de campo que pode ser guardado sem prazo', () => {
  it('reconhece o mesmo campo escrito de jeitos diferentes', () => {
    expect(nomeDeCampoGravavel('cpf')).toBe('cpf')
    expect(nomeDeCampoGravavel('CPF')).toBe('cpf')
    expect(nomeDeCampoGravavel('E-mail')).toBe('email')
    expect(nomeDeCampoGravavel('Instituição')).toBe('instituicao')
  })

  it('dado pessoal no lugar do nome do campo nunca passa', () => {
    // O ataque: o e-mail convence o modelo a usar o próprio dado como chave.
    expect(nomeDeCampoGravavel('111.444.777-35')).toBe(CAMPO_FORA_DA_LISTA)
    expect(nomeDeCampoGravavel('Helena Prado')).toBe(CAMPO_FORA_DA_LISTA)
    expect(nomeDeCampoGravavel('helena.prado@exemplo.test')).toBe(CAMPO_FORA_DA_LISTA)
  })

  it('campo desconhecido vira "outro", não some', () => {
    expect(nomeDeCampoGravavel('data_de_nascimento')).toBe(CAMPO_FORA_DA_LISTA)
    expect(nomeDeCampoGravavel('')).toBe(CAMPO_FORA_DA_LISTA)
  })
})
