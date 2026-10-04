import { describe, expect, it } from 'vitest'

import { lerOpcoesDeOrfaos } from './opcoes-de-orfaos'

/**
 * A porta manual da limpeza de anexo sem registro (`AT-74`). Ela passa por
 * cima das travas contra banco errado, então a entrada é conferida aqui, antes
 * de qualquer banco: número inteiro positivo, e um nome de quem autoriza.
 */
describe('opções de órfãos da linha de comando', () => {
  it('sem opção, é a rotina do dia', () => {
    expect(lerOpcoesDeOrfaos([])).toEqual({ modo: 'rotina' })
  })

  it('--listar-orfaos só lista', () => {
    expect(lerOpcoesDeOrfaos(['--listar-orfaos'])).toEqual({ modo: 'listar' })
  })

  it('--aceitar-orfaos com número e nome', () => {
    expect(lerOpcoesDeOrfaos(['--aceitar-orfaos=3', '--por=Gestora Sintética'])).toEqual({
      modo: 'aceitar',
      quantidade: 3,
      por: 'Gestora Sintética',
    })
  })

  it.each(['0', '-1', '1.5', 'abc', '', '03'])('recusa número "%s"', (valor) => {
    expect(() => lerOpcoesDeOrfaos([`--aceitar-orfaos=${valor}`, '--por=Gestora'])).toThrow(/inteiro positivo/)
  })

  it('aceitar sem --por é recusado: a trilha precisa dizer quem autorizou (S2)', () => {
    expect(() => lerOpcoesDeOrfaos(['--aceitar-orfaos=3'])).toThrow(/--por/)
  })

  it.each(['', 'a', 'x'.repeat(61), 'Nome\nInjetado', 'Nome; rm'])('recusa nome "%s"', (nome) => {
    expect(() => lerOpcoesDeOrfaos(['--aceitar-orfaos=3', `--por=${nome}`])).toThrow(/--por/)
  })

  it('listar e aceitar juntos é ambíguo, e é recusado', () => {
    expect(() => lerOpcoesDeOrfaos(['--listar-orfaos', '--aceitar-orfaos=3', '--por=Gestora'])).toThrow(/juntos/)
  })
})
