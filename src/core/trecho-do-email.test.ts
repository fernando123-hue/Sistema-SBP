import { describe, expect, it } from 'vitest'

import { CAMPO_DA_LIGA } from './conferencia-da-extracao'
import { acharTrecho, textoParaExibir, valorProcurado } from './trecho-do-email'

/**
 * O trecho duvidoso marcado no e-mail que a Revisão mostra (`A69`, 2A).
 * Dados 100% sintéticos.
 */

function marcado(corpo: string, valor: string): string | null {
  const trecho = acharTrecho(corpo, valor)
  return trecho ? corpo.slice(trecho.inicio, trecho.fim) : null
}

describe('acharTrecho', () => {
  it('acha o valor ignorando maiúsculas, acentos e espaços repetidos, e devolve o trecho ORIGINAL', () => {
    const corpo = 'Prezados,\nsegue o cadastro de JOÃO  da Silva Exemplo, ligante novo.'
    expect(marcado(corpo, 'joao da silva exemplo')).toBe('JOÃO  da Silva Exemplo')
  })

  it('não marca palavra pela metade: "Ana Souza" não está dentro de "Mariana Souza"', () => {
    expect(marcado('Cadastro de Mariana Souza.', 'Ana Souza')).toBeNull()
    expect(marcado('Cadastro de Ana Souza.', 'Ana Souza')).toBe('Ana Souza')
  })

  it('número formatado casa com o número só em dígitos, sem cortar grupo ao meio', () => {
    const corpo = 'CPF: 123.456.789-09, telefone (11) 98765-4321.'
    expect(marcado(corpo, '12345678909')).toBe('123.456.789-09')
    expect(marcado(corpo, '11987654321')).toBe('(11) 98765-4321'.slice(1))
    // O CPF sem o último dígito corta o grupo "09": não é o que está escrito.
    expect(marcado(corpo, '1234567890')).toBeNull()
  })

  it('número não junta grupos distantes', () => {
    expect(marcado('código 123, e na outra linha bem depois 456', '123456')).toBeNull()
  })

  it('valor curto demais não marca nada: "de" está em qualquer texto', () => {
    expect(acharTrecho('nome de alguém', 'de')).toBeNull()
    expect(acharTrecho('nome de alguém', '  ')).toBeNull()
  })

  it('valor ausente do e-mail devolve nulo, e não um trecho parecido', () => {
    expect(acharTrecho('Segue a ficha de Bruno Exemplo.', 'Bruna Exemplo')).toBeNull()
  })

  it('caractere invisível no meio da palavra não esconde o valor', () => {
    const corpo = 'Nome: Car​la Teste'
    expect(marcado(corpo, 'Carla Teste')).toBe('Car​la Teste')
  })

  it('não leva segundos num texto feito para custar caro', () => {
    const corpo = 'a '.repeat(100_000)
    const comeco = performance.now()
    expect(acharTrecho(corpo, `${'a '.repeat(200)}b`)).toBeNull()
    expect(acharTrecho('1 '.repeat(100_000), '1'.repeat(300))).toBeNull()
    expect(performance.now() - comeco).toBeLessThan(2_000)
  })
})

describe('textoParaExibir', () => {
  it('troca controle de direção por um sinal visível, sem mudar o tamanho', () => {
    const corpo = 'arquivo ‮fdp.exe‬ e ⁦x⁩'
    const exibido = textoParaExibir(corpo)
    expect(exibido).not.toMatch(/[‪-‮⁦-⁩]/)
    expect(exibido).toContain('�')
    // Mesmo tamanho: o trecho calculado sobre o original vale no exibido.
    expect(exibido.length).toBe(corpo.length)
  })

  it('não toca no resto do texto, nem em acento nem em quebra de linha', () => {
    expect(textoParaExibir('Olá,\nJoão\t<b>negrito</b>')).toBe('Olá,\nJoão\t<b>negrito</b>')
  })
})

describe('valorProcurado', () => {
  const sugestao = { campos: { nome: 'Ana Teste', vazio: '  ' }, ligaMencionada: 'Liga Sintética' }

  it('é o valor do campo apontado, ou a liga citada quando o campo é a liga', () => {
    expect(valorProcurado('nome', sugestao)).toBe('Ana Teste')
    expect(valorProcurado(CAMPO_DA_LIGA, sugestao)).toBe('Liga Sintética')
  })

  it('campo sem valor, ausente ou herdado do protótipo não vira procura', () => {
    expect(valorProcurado('vazio', sugestao)).toBeNull()
    expect(valorProcurado('cpf', sugestao)).toBeNull()
    expect(valorProcurado('toString', sugestao)).toBeNull()
    expect(valorProcurado(null, sugestao)).toBeNull()
  })
})
