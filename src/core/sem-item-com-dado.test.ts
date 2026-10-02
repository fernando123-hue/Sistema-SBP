import { describe, expect, it } from 'vitest'

import { dadoDeTrabalhoSemItem } from './sem-item-com-dado'

/**
 * Revisão de segurança do #190 (`AT-72`, `AT-73`): um e-mail que a IA leu como
 * "nenhum pedido" mas que traz CPF, CRM ou um documento anexado não pode sumir
 * sem ninguém olhar. Nomes e números sintéticos.
 */

const texto = (corpo: string, assunto = 'Resposta automática') => ({ assunto, corpo })

describe('dado de trabalho num e-mail sem item', () => {
  it('resposta automática sem dado nenhum: nada a guardar', () => {
    expect(dadoDeTrabalhoSemItem(texto('Estou fora do escritório até 20/01.'), 0)).toBeNull()
  })

  it('CPF no corpo, com ou sem pontuação, mesmo com dígito errado', () => {
    expect(dadoDeTrabalhoSemItem(texto('PS: meu CPF é 111.444.777-35'), 0)).toBe('cpf')
    expect(dadoDeTrabalhoSemItem(texto('cpf 11144477736 para corrigir'), 0)).toBe('cpf')
    expect(dadoDeTrabalhoSemItem(texto('Ausente', 'CPF 111 444 777 35'), 0)).toBe('cpf')
  })

  it('CRM com número', () => {
    expect(dadoDeTrabalhoSemItem(texto('Atualizem meu CRM SP-123456, por favor.'), 0)).toBe('crm')
    expect(dadoDeTrabalhoSemItem(texto('crm: 98765'), 0)).toBe('crm')
  })

  // Revisões do #191: formas comuns no Brasil que escapavam. A regra existe
  // para quando o modelo falha, então erra para o lado largo.
  it('CPF escrito de outros jeitos também conta', () => {
    for (const forma of [
      '111-444-777-35',
      '111/444/777-35',
      '111.444.777 - 35',
      '111.444.777–35',
      '111  444  777  35',
      '111.444.777\n-35',
      '111_444_777_35',
      '111​.444.777-35',
      '１１１.４４４.７７７-３５',
    ]) {
      expect(dadoDeTrabalhoSemItem(texto(`meu CPF: ${forma}`), 0), forma).toBe('cpf')
    }
  })

  it('CRM escrito de outros jeitos também conta', () => {
    for (const forma of ['CRM nº 12345', 'CRM n.º 12345', 'CRM/SP nº 123456', 'CRM-SP: 12345', 'CRM-SP 12.345', 'CRM 123.456', 'CRMSP 123456']) {
      expect(dadoDeTrabalhoSemItem(texto(`Atualizem meu ${forma}.`), 0), forma).toBe('crm')
    }
  })

  it('CEP, valor em reais, CNPJ e protocolo de 12 dígitos não contam como CPF', () => {
    for (const texto_ of ['CEP 01310-100', 'R$ 1.234.567,89', 'CNPJ 12.345.678/0001-90', 'protocolo 123456789012']) {
      expect(dadoDeTrabalhoSemItem(texto(texto_), 0), texto_).toBeNull()
    }
  })

  it('"CRM de 2024" não conta: UF é maiúscula', () => {
    expect(dadoDeTrabalhoSemItem(texto('O relatório do CRM de 2024 chegou.'), 0)).toBeNull()
  })

  it('a palavra CRM sozinha, data ou telefone não contam', () => {
    expect(dadoDeTrabalhoSemItem(texto('Falei com o setor de CRM ontem.'), 0)).toBeNull()
    expect(dadoDeTrabalhoSemItem(texto('Retorno em 20/01/2026, ramal 4321.'), 0)).toBeNull()
    expect(dadoDeTrabalhoSemItem(texto('Telefone (11) 91234-5678.'), 0)).toBeNull()
  })

  // Qualquer anexo, de qualquer tipo: o tipo declarado é do remetente e nunca
  // decide nada (`AnexoSchema`) — um PDF declarado "image/png" escaparia.
  it('qualquer anexo conta, de qualquer tipo declarado', () => {
    expect(dadoDeTrabalhoSemItem(texto('Fora do escritório.'), 1)).toBe('anexo')
    expect(dadoDeTrabalhoSemItem(texto('Fora do escritório.'), 0)).toBeNull()
  })
})
