import { describe, expect, it } from 'vitest'

import { protegerParaFornecedorExterno } from './protecao-para-fornecedor-externo'

/**
 * A camada de defesa do dado antes de um fornecedor externo (`DECISOES.md § A62`).
 *
 * Todos os dados aqui são inventados (invariante 8): CPF com dígito válido
 * gerado para teste, e-mails em `exemplo.test`, domínios `exemplo.*`.
 */

const proteger = (texto: string) => protegerParaFornecedorExterno(texto).texto

/** Nenhuma sequência de `n` dígitos seguidos sobrou. */
const semDigitos = (n: number) => new RegExp(String.raw`\d{${n}}`)

describe('o que sai do texto', () => {
  it('CPF, com e sem pontuação', () => {
    expect(proteger('meu CPF é 123.456.789-09, obrigado')).toBe('meu CPF é [número], obrigado')
    expect(proteger('CPF 12345678909')).toBe('CPF [número]')
    expect(proteger('CPF 123 456 789 09')).toBe('CPF [número]')
    expect(proteger('CPF 123  456  789  09')).toBe('CPF [número]')
  })

  // Achados das revisões do #135: cada um destes saía inteiro ou pela metade.
  it('CPF com separador espaçado, traço tipográfico ou sinal de menos', () => {
    expect(proteger('CPF: 123 - 456 - 789 - 09')).toBe('CPF: [número]')
    expect(proteger('CPF 123 . 456 . 789 - 09')).toBe('CPF [número]')
    expect(proteger('CPF 123.456.789\u201309')).toBe('CPF [número]')
    expect(proteger('CPF 123\u2212456\u2212789\u221209')).toBe('CPF [número]')
    expect(proteger('CPF 123\u00b7456\u00b7789\u00b709')).toBe('CPF [número]')
  })

  it('CPF com caractere invisível ou dígito de largura total', () => {
    expect(proteger('CPF 123\u200b456\u200b789\u200b09')).toBe('CPF [número]')
    expect(proteger('CPF 123\u00ad456\u00ad789\u00ad09')).toBe('CPF [número]')
    expect(proteger('CPF １２３４５６７８９０９')).toBe('CPF [número]')
  })

  it('CNPJ, telefone e CEP', () => {
    expect(proteger('CNPJ 12.345.678/0001-95')).toBe('CNPJ [número]')
    expect(proteger('ligue (11) 91234-5678')).toBe('ligue [número]')
    expect(proteger('ligue (11) 91234 - 5678')).toBe('ligue [número]')
    expect(proteger('ligue 11 - 91234 - 5678')).toBe('ligue [número]')
    expect(proteger('ligue +55 11 91234 5678')).toBe('ligue [número]')
    expect(proteger('ligue 91234\u20135678')).toBe('ligue [número]')
    expect(proteger('CEP 01310-100')).toBe('CEP [número]')
  })

  it('número de conselho, mesmo curto, em qualquer grafia comum', () => {
    expect(proteger('Dra. X, CRM 12345/SP')).toBe('Dra. X, CRM [número]/SP')
    expect(proteger('CRM-SP 1234')).toBe('CRM-SP [número]')
    expect(proteger('crm: 987')).toBe('crm: [número]')
    for (const grafia of [
      'CRM-SP 123.456',
      'CRM 12.345-6',
      'CRM 1.234/SP',
      'CRM 12345678',
      'CRM/SP nº 1234',
      'CRM/SP n. 1234',
      'CRM-SP n.º 1234',
      'CRM - SP 1234',
      'CRM\u2013SP 1234',
      'C.R.M. 1234',
      'RQE 1234',
      'CREMESP 1234',
      'COREN-SP 1234',
      'matrícula 4521',
      'registro 1234-SP',
    ]) {
      expect(proteger(grafia), grafia).not.toMatch(/\d/)
    }
  })

  it('e-mail, inclusive escapado em URL, largura total e colados', () => {
    expect(proteger('escreva para associada.ficticia@exemplo.test hoje')).toBe('escreva para [e-mail] hoje')
    expect(proteger('de associada%40exemplo.test')).toBe('de [e-mail]')
    expect(proteger('de associada＠exemplo.test')).toBe('de [e-mail]')
    expect(proteger('fulana@exemplo.test;beltrano@exemplo.test')).toBe('[e-mail];[e-mail]')
    expect(proteger('fulana@exemplo.test, beltrano@exemplo.test')).toBe('[e-mail], [e-mail]')
  })

  // Link pode carregar token, e-mail ou número na própria URL.
  it('link inteiro, com ou sem esquema', () => {
    expect(proteger('veja https://exemplo.test/boleto?cpf=12345678909&t=abc')).toBe('veja [link]')
    expect(proteger('www.exemplo.test/x')).toBe('[link]')
    expect(proteger('acesse portal.exemplo.org.br/reset/Zx9Qk2LmP')).toBe('acesse [link]')
    expect(proteger('bit.ly/abcDEF')).toBe('[link]')
    expect(proteger('ftp://exemplo.test/arquivo')).toBe('[link]')
    expect(proteger('(https://exemplo.test/x)')).toBe('[link]')
    expect(proteger('http\u200b://exemplo.test/token')).toBe('[link]')
  })

  // `AT-49`: data completa e valor com 5+ dígitos também saem. Data de
  // nascimento é dado pessoal; o classificador não precisa do dia exato.
  it('data completa e valor longo', () => {
    expect(proteger('vencimento 30/09/2026')).toBe('vencimento [número]')
    expect(proteger('nascimento: 12 / 03 / 1985')).toBe('nascimento: [número]')
    expect(proteger('valor R$ 12.500,00')).toBe('valor R$ [número]')
  })
})

describe('o que fica — o que o classificador precisa para entender o pedido', () => {
  it('palavras, anos e números pequenos', () => {
    const texto = 'Pedido de anuidade 2026 da liga, 3 documentos anexos, prazo em 10 dias.'
    expect(proteger(texto)).toBe(texto)
  })

  it('acento, pontuação comum e palavras com barra', () => {
    const texto = 'Solicitação de isenção e/ou desconto, Sr./Sra. associada — ver item 2.'
    expect(proteger(texto)).toBe(texto)
  })

  // Centavo conta como dígito: `R$ 350,00` já tem cinco e sai (`AT-49`).
  it('valor curto e ano sozinho', () => {
    expect(proteger('valor R$ 35,00 de 2025')).toBe('valor R$ 35,00 de 2025')
    expect(proteger('valor R$ 350,00')).toBe('valor R$ [número]')
  })

  it('"CRM" como palavra, sem número', () => {
    expect(proteger('o CRM do associado está anexo')).toBe('o CRM do associado está anexo')
  })
})

describe('corte e contagem', () => {
  it('corta no limite e diz que cortou', () => {
    const protegido = protegerParaFornecedorExterno('a'.repeat(50), 20)
    expect(protegido.cortado).toBe(true)
    expect(protegido.texto.startsWith('a'.repeat(20))).toBe(true)
    expect(protegido.texto.length).toBeLessThan(80)
  })

  it('não diz que cortou quando cabe', () => {
    const protegido = protegerParaFornecedorExterno('cabe inteiro', 20)
    expect(protegido.cortado).toBe(false)
    expect(protegido.texto).toBe('cabe inteiro')
  })

  // O corte é depois da máscara: senão um número partido ao meio no limite
  // escaparia pela metade que ficou.
  it('mascara antes de cortar', () => {
    const protegido = protegerParaFornecedorExterno(`${'a'.repeat(15)} 123.456.789-09`, 20)
    expect(protegido.texto).not.toMatch(semDigitos(3))
  })

  it('conta o que mascarou, sem guardar o que era', () => {
    const protegido = protegerParaFornecedorExterno(
      'CPF 123.456.789-09, e-mail a@exemplo.test, tel (11) 91234-5678, https://exemplo.test/x',
    )
    expect(protegido.mascarados).toEqual({ numero: 2, email: 1, link: 1 })
    expect(JSON.stringify(protegido)).not.toContain('123.456')
  })
})

// Um corpo aceito tem até 200 mil caracteres, e a máscara roda sobre ele
// inteiro antes do corte. Um caso por expressão, com a entrada que a faria
// recuar se o quantificador não tivesse teto (revisões do #135: `CRM` + 200
// mil espaços levava 16 s; `a%40` repetido, 1,7 s).
describe('texto hostil longo não trava o servidor', () => {
  const N = 200_000
  const hostis: Record<string, string> = {
    'dígito e traço': '1-'.repeat(N / 2),
    'arroba repetida': 'a@'.repeat(N / 2),
    'CRM seguido de espaços': `CRM${' '.repeat(N)}x`,
    'CRM seguido de separadores': `CRM${' -'.repeat(N / 2)}x`,
    '%40 repetido': 'a%40'.repeat(N / 4),
    'palavra enorme sem espaço': 'a'.repeat(N),
    'rótulos de domínio sem caminho': 'abc.'.repeat(N / 4),
    'dígitos com quatro separadores': '1 - - '.repeat(N / 6),
    'matrícula repetida': 'matrícula '.repeat(N / 10),
  }

  for (const [nome, texto] of Object.entries(hostis)) {
    it(nome, () => {
      const inicio = performance.now()
      protegerParaFornecedorExterno(texto, N)
      expect(performance.now() - inicio).toBeLessThan(1_000)
    })
  }
})
