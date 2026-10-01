import { describe, expect, it } from 'vitest'

import { CAMPO_DA_LIGA } from './conferencia-da-extracao'
import { acharTrecho, misturaAlfabetos, textoParaExibir, valorProcurado, VEZES_CONTADAS } from './trecho-do-email'

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
    // Nem um pedaço do meio, separado por ponto (revisão técnica do #163).
    expect(marcado(corpo, '456789')).toBeNull()
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
    const corpo = 'Nome: Car\u200Bla Teste'
    expect(marcado(corpo, 'Carla Teste')).toBe('Car\u200Bla Teste')
  })

  it('a marca é a primeira vez, e o trecho diz quantas vezes o valor aparece', () => {
    const corpo = '> Ana Teste escreveu:\n> ...\nAtenciosamente, Ana Teste'
    const trecho = acharTrecho(corpo, 'ana teste')
    expect(trecho?.inicio).toBe(2)
    expect(trecho?.vezes).toBe(2)
    expect(acharTrecho('Ana Teste '.repeat(50), 'Ana Teste')?.vezes).toBe(VEZES_CONTADAS)
  })

  it('o mapa até o original vale com letra fora do plano básico e com ligadura', () => {
    const astral = 'Oi \u{1D400}! Nome: Ana Teste \u{1F600} ok'
    expect(marcado(astral, 'Ana Teste')).toBe('Ana Teste')
    // "ﬁ" é UM caractere que vira dois: a marca cobre o caractere inteiro.
    expect(marcado('Nome: Ruﬁno Exemplo.', 'Rufino Exemplo')).toBe('Ruﬁno Exemplo')
  })

  it('não leva segundos num texto feito para custar caro', () => {
    const corpo = 'a '.repeat(100_000)
    const comeco = performance.now()
    expect(acharTrecho(corpo, `${'a '.repeat(200)}b`)).toBeNull()
    expect(acharTrecho('1 '.repeat(100_000), '1'.repeat(300))).toBeNull()
    // A forma de compatibilidade multiplica: "ﷺ" vira 18 unidades (revisão técnica do #163).
    expect(acharTrecho('\uFDFA'.repeat(200_000), 'Ana Teste')).toBeNull()
    expect(performance.now() - comeco).toBeLessThan(2_000)
  })
})

describe('textoParaExibir', () => {
  it('põe à vista a formatação invisível que a IA recebe: largura zero, hífen suave, BOM e tag', () => {
    const corpo = 'Ig\u200Bnore\u00AD \uFEFFisto\u{E0041}\u{E0042}'
    const exibido = textoParaExibir(corpo)
    expect(exibido).not.toMatch(/\p{Cf}/u)
    expect(exibido.length).toBe(corpo.length)
    expect(exibido).toBe('Ig\uFFFDnore\uFFFD \uFFFDisto\uFFFD\uFFFD\uFFFD\uFFFD')
  })

  it('troca controle de direção por um sinal visível, sem mudar o tamanho', () => {
    const corpo = 'arquivo \u202Efdp.exe\u202C e \u2066x\u2069'
    const exibido = textoParaExibir(corpo)
    expect(exibido).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/)
    expect(exibido).toContain('\uFFFD')
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

  it('número gravado pela IA vira texto, e não "não consegui apontar"', () => {
    expect(valorProcurado('cpf', { campos: { cpf: 12345678909 }, ligaMencionada: null })).toBe('12345678909')
    expect(valorProcurado('cpf', { campos: { cpf: Number.NaN }, ligaMencionada: null })).toBeNull()
  })

  it('campo sem valor, ausente ou herdado do protótipo não vira procura', () => {
    expect(valorProcurado('vazio', sugestao)).toBeNull()
    expect(valorProcurado('cpf', sugestao)).toBeNull()
    expect(valorProcurado('toString', sugestao)).toBeNull()
    expect(valorProcurado(null, sugestao)).toBeNull()
  })
})

describe('misturaAlfabetos', () => {
  it('acusa o "о" cirílico no meio de um endereço latino', () => {
    expect(misturaAlfabetos('ass\u043Eciado@exemplo.test')).toBe(true)
    expect(misturaAlfabetos('\u03B1lfa@exemplo.test')).toBe(true)
  })

  it('não acusa endereço comum, com ou sem acento', () => {
    expect(misturaAlfabetos('joão.silva@exemplo.test')).toBe(false)
    expect(misturaAlfabetos('associado@exemplo.test')).toBe(false)
  })
})
