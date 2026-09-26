import { describe, expect, it } from 'vitest'

import { protegerParaFornecedorExterno } from './protecao-para-fornecedor-externo'

/**
 * A camada de defesa do dado antes de um fornecedor externo (`DECISOES.md § A62`).
 *
 * Todos os dados aqui são inventados (invariante 8): CPF com dígito válido
 * gerado para teste, e-mails em `exemplo.test`.
 */

const proteger = (texto: string) => protegerParaFornecedorExterno(texto).texto

describe('o que sai do texto', () => {
  it('CPF, com e sem pontuação', () => {
    expect(proteger('meu CPF é 123.456.789-09, obrigado')).toBe('meu CPF é [número], obrigado')
    expect(proteger('CPF 12345678909')).toBe('CPF [número]')
    expect(proteger('CPF 123 456 789 09')).toBe('CPF [número]')
  })

  it('CNPJ, telefone e CEP', () => {
    expect(proteger('CNPJ 12.345.678/0001-95')).toBe('CNPJ [número]')
    expect(proteger('ligue (11) 91234-5678')).toBe('ligue [número]')
    expect(proteger('ligue +55 11 91234 5678')).toBe('ligue [número]')
    expect(proteger('CEP 01310-100')).toBe('CEP [número]')
    // Travessão que o Outlook põe no lugar do hífen, e espaço duplo.
    expect(proteger('ligue 91234\u20135678')).toBe('ligue [número]')
    expect(proteger('CPF 123.456.789\u201309')).toBe('CPF [número]')
    expect(proteger('CPF 123  456  789  09')).toBe('CPF [número]')
  })

  it('CRM, mesmo curto', () => {
    expect(proteger('Dra. X, CRM 12345/SP')).toBe('Dra. X, CRM [número]/SP')
    expect(proteger('CRM-SP 1234')).toBe('CRM-SP [número]')
    expect(proteger('crm: 987')).toBe('crm: [número]')
  })

  it('e-mail', () => {
    expect(proteger('escreva para associada.ficticia@exemplo.test hoje')).toBe('escreva para [e-mail] hoje')
    expect(proteger('de associada%40exemplo.test')).toBe('de [e-mail]')
  })

  // Link pode carregar token, e-mail ou número na própria URL.
  it('link inteiro, antes de olhar e-mail e número dentro dele', () => {
    expect(proteger('veja https://exemplo.test/boleto?cpf=12345678909&t=abc')).toBe('veja [link]')
    expect(proteger('www.exemplo.test/x')).toBe('[link]')
  })
})

describe('o que fica — o que o classificador precisa para entender o pedido', () => {
  it('palavras, anos e números pequenos', () => {
    const texto = 'Pedido de anuidade 2026 da liga, 3 documentos anexos, prazo em 10 dias.'
    expect(proteger(texto)).toBe(texto)
  })
})

describe('corte e contagem', () => {
  it('corta no limite e diz que cortou', () => {
    const protegido = protegerParaFornecedorExterno('a'.repeat(50), 20)
    expect(protegido.cortado).toBe(true)
    expect(protegido.texto.startsWith('a'.repeat(20))).toBe(true)
    expect(protegido.texto.length).toBeLessThan(80)
  })

  // O corte é depois da máscara: senão um número partido ao meio no limite
  // escaparia pela metade que ficou.
  it('mascara antes de cortar', () => {
    const protegido = protegerParaFornecedorExterno(`${'a'.repeat(15)} 123.456.789-09`, 20)
    expect(protegido.texto).not.toMatch(/\d{3}/)
  })

  it('conta o que mascarou, sem guardar o que era', () => {
    const protegido = protegerParaFornecedorExterno(
      'CPF 123.456.789-09, e-mail a@exemplo.test, tel (11) 91234-5678, https://exemplo.test/x',
    )
    expect(protegido.mascarados).toEqual({ numero: 2, email: 1, link: 1 })
    expect(JSON.stringify(protegido)).not.toContain('123.456')
  })

  it('não trava com texto hostil longo (tempo linear)', () => {
    const inicio = performance.now()
    protegerParaFornecedorExterno(`${'1-'.repeat(50_000)}x ${'a@'.repeat(50_000)}`, 200_000)
    expect(performance.now() - inicio).toBeLessThan(1_000)
  })
})
