import { describe, expect, it } from 'vitest'

import {
  reduzirPayloadDoItem,
  reduzirSugestaoIa,
  reduzirValorFinal,
  tituloNeutro,
} from './expurgo-do-item'

/**
 * O que sobra de um item depois do prazo (`A23(a)`) — a parte pura.
 *
 * Título e valores podem ter nome e CPF de associado, e saem pelo mesmo relógio
 * do texto do e-mail. O que fica não pode carregar dado pessoal nenhum. Nomes e
 * números abaixo são sintéticos.
 */

describe('título neutro (A41, resposta 22)', () => {
  it('e-mail com vários itens: categoria · liga · posição', () => {
    expect(
      tituloNeutro({ categoriaRotulo: 'Ligante', ligaNome: 'Liga de Neonatologia', sequencia: 2, itensNoEmail: 3 }),
    ).toBe('Ligante · Liga de Neonatologia · 2')
  })

  it('e-mail com um item só: sem posição', () => {
    expect(
      tituloNeutro({ categoriaRotulo: 'E-mail Cadastro', ligaNome: null, sequencia: 1, itensNoEmail: 1 }),
    ).toBe('E-mail Cadastro')
    expect(
      tituloNeutro({ categoriaRotulo: 'Ligante', ligaNome: 'Liga de Neonatologia', sequencia: 1, itensNoEmail: 1 }),
    ).toBe('Ligante · Liga de Neonatologia')
  })

  it('sem liga e com vários itens: categoria · posição', () => {
    expect(
      tituloNeutro({ categoriaRotulo: 'Doc. Cadastro', ligaNome: null, sequencia: 3, itensNoEmail: 3 }),
    ).toBe('Doc. Cadastro · 3')
  })

  it('item registrado à mão não veio de e-mail: só a categoria', () => {
    expect(
      tituloNeutro({ categoriaRotulo: 'Inadimplente', ligaNome: null, sequencia: 4, itensNoEmail: null }),
    ).toBe('Inadimplente')
  })
})

describe('o que sobra do que a IA extraiu', () => {
  it('campos, liga mencionada e observação saem; os nomes de campo ausentes passam pela lista fechada', () => {
    const reduzido = reduzirPayloadDoItem({
      campos: { nome: 'Helena Prado Sintética', cpf: '111.444.777-35' },
      camposAusentes: ['crm', '111.444.777-35', 'CRM'],
      ligaMencionada: 'Liga de Neonatologia da Helena',
      observacao: 'Dra. Helena pediu retorno',
      revisadoPorHumano: true,
    })

    expect(reduzido).toEqual({
      campos: {},
      camposAusentes: ['crm', 'outro'],
      ligaMencionada: null,
      observacao: null,
      revisadoPorHumano: true,
    })
    const texto = JSON.stringify(reduzido)
    expect(texto).not.toContain('Helena')
    expect(texto).not.toContain('111.444')
  })
})

describe('o que sobra da revisão', () => {
  it('da sugestão da IA ficam só categoria e confiança — o que a medida de acerto usa', () => {
    const sugestao = JSON.stringify({
      categoriaCodigo: 'DOC_CADASTRO',
      titulo: 'Inscrição de Helena Prado Sintética',
      confianca: 0.4,
      campos: { cpf: '111.444.777-35' },
      observacao: 'texto sintético',
    })

    expect(JSON.parse(reduzirSugestaoIa(sugestao))).toEqual({ categoriaCodigo: 'DOC_CADASTRO', confianca: 0.4 })
  })

  it('sugestão ilegível sai inteira: não dá para saber o que ela guardava', () => {
    expect(reduzirSugestaoIa('isto não é json, Helena Prado 111.444.777-35')).toBe('{}')
  })

  it('da decisão ficam categoria, aprovado, itens extras e origem', () => {
    const final = JSON.stringify({
      categoriaCodigo: 'LIGANTE',
      titulo: 'Inscrição de Helena Prado Sintética',
      campos: { cpf: '111.444.777-35' },
      aprovado: true,
      itensExtras: 1,
    })

    expect(JSON.parse(reduzirValorFinal(final)!)).toEqual({
      categoriaCodigo: 'LIGANTE',
      aprovado: true,
      itensExtras: 1,
    })
    expect(
      JSON.parse(reduzirValorFinal(JSON.stringify({ aprovado: true, origem: 'aprovacao_em_massa' }))!),
    ).toEqual({ aprovado: true, itensExtras: 0, origem: 'aprovacao_em_massa' })
  })

  it('revisão sem decisão continua sem decisão; decisão ilegível sai inteira', () => {
    expect(reduzirValorFinal(null)).toBeNull()
    expect(reduzirValorFinal('{"titulo":"Helena Prado"')).toBe('{}')
  })
})
