import { describe, expect, it } from 'vitest'

import { CAMPO_DA_LIGA } from './conferencia-da-extracao'
import { decidivelNoCartao } from './revisao-por-email'

/** Dados 100% sintéticos (invariante 8). */
const sugestao = (campos: Record<string, unknown>, ligaMencionada: string | null = null) =>
  JSON.stringify({ campos, camposAusentes: [], ligaMencionada, observacao: null })

const base = {
  motivo: 'desdobramento',
  campoIncerto: null as string | null,
  sugestaoIa: sugestao({ nome: 'Fulana Sintética' }),
  semLiga: false,
  emailSuspeito: false,
}

describe('decidivelNoCartao (`A69`, 1A; segurança do #167)', () => {
  it('lista limpa cabe no cartão', () => {
    expect(decidivelNoCartao(base)).toBe(true)
  })

  // O caso do achado: o motivo é desdobramento, mas o CPF não fechou.
  it('campo apontado com valor fica de fora, mesmo com motivo desdobramento', () => {
    expect(decidivelNoCartao({ ...base, campoIncerto: 'cpf', sugestaoIa: sugestao({ cpf: '111.111.111-11' }) })).toBe(false)
  })

  it('campo apontado que faltou cabe', () => {
    expect(decidivelNoCartao({ ...base, campoIncerto: 'crm' })).toBe(true)
    expect(decidivelNoCartao({ ...base, campoIncerto: 'crm', sugestaoIa: sugestao({ crm: '  ' }) })).toBe(true)
  })

  it('liga apontada, ou citada e deixada de fora, fica de fora', () => {
    expect(decidivelNoCartao({ ...base, campoIncerto: CAMPO_DA_LIGA })).toBe(false)
    expect(decidivelNoCartao({ ...base, semLiga: true, sugestaoIa: sugestao({}, 'Liga Sintética de Cardiologia') })).toBe(false)
    expect(decidivelNoCartao({ ...base, semLiga: true, sugestaoIa: sugestao({}, null) })).toBe(true)
  })

  it('motivo de alerta, e-mail suspeito e sugestão ilegível ficam de fora', () => {
    expect(decidivelNoCartao({ ...base, motivo: 'cpf_invalido' })).toBe(false)
    expect(decidivelNoCartao({ ...base, emailSuspeito: true })).toBe(false)
    expect(decidivelNoCartao({ ...base, sugestaoIa: '{' })).toBe(false)
  })

  // `campoIncerto` vem da IA: um nome herdado não pode achar a função do protótipo.
  it('campo com nome de propriedade herdada não engana', () => {
    expect(decidivelNoCartao({ ...base, campoIncerto: 'toString' })).toBe(true)
  })
})
