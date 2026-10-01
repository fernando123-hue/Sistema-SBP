import { describe, expect, it } from 'vitest'

import { CAMPO_DA_LIGA } from '../../core/conferencia-da-extracao'
import {
  blocosDaRevisao,
  depoisDeResolver,
  depoisDeResolverVarias,
  estadoDaFila,
  filaDaResposta,
  ligaQueFicouDeFora,
  lerSugestao,
  mostraConfianca,
  partesDoCorpo,
  rotuloDoCampo,
  seloDoCampo,
} from './fila-na-tela'

/**
 * A fila de revisão na tela, depois de cada decisão (achado N-30).
 *
 * A rota devolve até 200 revisões e o total real. A tela tirava da lista a
 * que foi resolvida e nunca mexia no total: o cabeçalho seguia com o número
 * antigo e, quando as 200 acabavam, "Nada aguardando decisão humana" aparecia
 * com revisões ainda pendentes além do corte.
 */

const item = (revisaoId: string) => ({ revisaoId })

describe('depoisDeResolver', () => {
  it('tira a revisão da lista e desconta do total', () => {
    const depois = depoisDeResolver([item('a'), item('b')], 5, 'a')
    expect(depois.itens).toEqual([item('b')])
    expect(depois.total).toBe(4)
    expect(depois.recarregar).toBe(false)
  })

  it('lista local zerada com pendentes além do corte pede a próxima leva', () => {
    const depois = depoisDeResolver([item('a')], 201, 'a')
    expect(depois.itens).toEqual([])
    expect(depois.total).toBe(200)
    expect(depois.recarregar).toBe(true)
  })

  it('última revisão de verdade: não recarrega', () => {
    const depois = depoisDeResolver([item('a')], 1, 'a')
    expect(depois).toEqual({ itens: [], total: 0, recarregar: false })
  })

  it('revisão que não está na lista não mexe em nada', () => {
    const depois = depoisDeResolver([item('a')], 3, 'x')
    expect(depois).toEqual({ itens: [item('a')], total: 3, recarregar: false })
  })
})

describe('filaDaResposta', () => {
  it('lista vazia com total maior que zero vira total zero — nunca "Carregando…" preso', () => {
    // O total e a lista saem de duas consultas: quem resolve a última revisão
    // entre as duas deixa `total: 1` com `itens: []` (revisão do PR #107).
    const fila = filaDaResposta({ itens: [], total: 1 })
    expect(fila).toEqual({ itens: [], total: 0 })
    expect(estadoDaFila(fila.itens, fila.total)).toBe('vazia')
  })

  it('total nunca menor que a lista', () => {
    expect(filaDaResposta({ itens: [item('a'), item('b')], total: 1 }).total).toBe(2)
  })

  it('resposta coerente passa como veio', () => {
    expect(filaDaResposta({ itens: [item('a')], total: 300 })).toEqual({ itens: [item('a')], total: 300 })
  })
})

describe('estadoDaFila', () => {
  it('sem resposta ainda: carregando', () => {
    expect(estadoDaFila(null, 0)).toBe('carregando')
  })

  it('lista vazia com total maior que zero NÃO é fila vazia', () => {
    expect(estadoDaFila([], 200)).toBe('carregando')
  })

  it('lista vazia e total zero: vazia', () => {
    expect(estadoDaFila([], 0)).toBe('vazia')
  })

  it('com itens: lista', () => {
    expect(estadoDaFila([item('a')], 1)).toBe('lista')
  })
})

describe('selo do campo apontado', () => {
  const sugestao = lerSugestao(JSON.stringify({ campos: { nome: 'Fulana Sintética', cpf: '  ' }, ligaMencionada: 'Liga Sintética' }))

  it('campo com valor pede conferência; campo vazio ou ausente, falta', () => {
    expect(seloDoCampo('nome', sugestao)).toBe('confira: nome')
    expect(seloDoCampo('cpf', sugestao)).toBe('falta: cpf')
    expect(seloDoCampo('crm', sugestao)).toBe('falta: crm')
    expect(seloDoCampo(CAMPO_DA_LIGA, sugestao)).toBe('confira: liga citada')
    expect(seloDoCampo(CAMPO_DA_LIGA, lerSugestao('{}'))).toBe('falta: liga citada')
  })

  it('um campo da IA chamado "liga citada" é só um campo', () => {
    const comCampo = lerSugestao(JSON.stringify({ campos: { 'liga citada': 'Nome Inventado' }, ligaMencionada: null }))
    expect(seloDoCampo('liga citada', comCampo)).toBe('confira: liga citada')
    expect(seloDoCampo(CAMPO_DA_LIGA, comCampo)).toBe('falta: liga citada')
  })

  /**
   * Com o CPF apontado e a liga fora do e-mail, o item fica sem liga; quem
   * aprova precisa ver isso, qualquer que seja o campo do selo (3ª rodada).
   */
  it('a liga citada que não virou a liga do item aparece, qualquer que seja o campo apontado', () => {
    expect(ligaQueFicouDeFora(sugestao, true)).toBe('Liga Sintética')
    expect(ligaQueFicouDeFora(sugestao, false)).toBeNull()
    expect(ligaQueFicouDeFora(lerSugestao(JSON.stringify({ ligaMencionada: '  ' })), true)).toBeNull()
    expect(ligaQueFicouDeFora(lerSugestao('{}'), true)).toBeNull()
    // Sem letra nem dígito é o modelo dizendo "nenhuma" (4ª rodada do #150).
    for (const marcador of ['-', '—', '?', '""']) {
      expect(ligaQueFicouDeFora(lerSugestao(JSON.stringify({ ligaMencionada: marcador })), true)).toBeNull()
    }
  })

  /**
   * O nome do campo vem da IA. Com `campos?.[campo]?.trim()`, "toString"
   * achava a função herdada e a tela da Revisão caía inteira (2ª rodada do #150).
   */
  it.each(['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf'])('campo chamado "%s" não derruba a tela', (campo) => {
    expect(seloDoCampo(campo, sugestao)).toBe(`falta: ${campo}`)
    expect(seloDoCampo(campo, lerSugestao('{}'))).toBe(`falta: ${campo}`)
  })

  it('sugestão ilegível ou com tipos errados vira vazia', () => {
    expect(lerSugestao('não é json')).toEqual({ campos: {}, ligaMencionada: null })
    expect(lerSugestao('null')).toEqual({ campos: {}, ligaMencionada: null })
    const torta = lerSugestao(JSON.stringify({ campos: { nome: 7, cpf: ['x'], crm: 'SP 1' }, ligaMencionada: 3 }))
    expect({ ...torta.campos }).toEqual({ crm: 'SP 1' })
    expect(torta.ligaMencionada).toBeNull()
    expect(seloDoCampo('nome', torta)).toBe('falta: nome')
  })

  it('"__proto__" gravado pela IA fica como chave comum, sem mexer no protótipo', () => {
    const lida = lerSugestao('{"campos":{"__proto__":"Fulana Sintética"}}')
    expect(seloDoCampo('__proto__', lida)).toBe('confira: __proto__')
    expect(Object.getPrototypeOf(lida.campos)).toBeNull()
  })
})

describe('selo de confiança (`A69`, 2B)', () => {
  it('aparece só quando a confiança é o motivo da revisão', () => {
    expect(mostraConfianca('baixa_confianca')).toBe(true)
  })

  it('some quando o motivo é outro: ali ele dizia "confiável" ao lado de um dado a conferir', () => {
    for (const motivo of [
      'campo_ausente',
      'valor_fora_do_texto',
      'cpf_invalido',
      'conteudo_suspeito',
      'desdobramento',
      'conferencia_incompleta',
    ]) {
      expect(mostraConfianca(motivo)).toBe(false)
    }
  })
})

describe('o e-mail ao lado (`A69`, 2A)', () => {
  it('parte o corpo em antes, marcado e depois', () => {
    expect(partesDoCorpo('ficha de Ana Teste, ok', { inicio: 9, fim: 18 })).toEqual({
      antes: 'ficha de ',
      marcado: 'Ana Teste',
      depois: ', ok',
    })
  })

  it('sem trecho, ou com trecho fora do texto, nada é marcado', () => {
    expect(partesDoCorpo('texto', null)).toEqual({ antes: 'texto', marcado: null, depois: '' })
    expect(partesDoCorpo('texto', { inicio: 3, fim: 50 })).toEqual({ antes: 'texto', marcado: null, depois: '' })
    expect(partesDoCorpo('texto', { inicio: 3, fim: 3 })).toEqual({ antes: 'texto', marcado: null, depois: '' })
    expect(partesDoCorpo('texto', { inicio: -1, fim: 2 })).toEqual({ antes: 'texto', marcado: null, depois: '' })
  })

  it('a liga aparece com o rótulo curto, e o resto com o nome do campo', () => {
    expect(rotuloDoCampo(CAMPO_DA_LIGA)).toBe('liga citada')
    expect(rotuloDoCampo('nome')).toBe('nome')
  })
})

describe('blocosDaRevisao (`A69`, 1A)', () => {
  const linha = (revisaoId: string, emailId: string | null, extra: Partial<{ pendentesNoEmail: number; motivo: string; emailSuspeito: boolean }> = {}) => ({
    revisaoId,
    emailId,
    pendentesNoEmail: extra.pendentesNoEmail ?? 2,
    motivo: extra.motivo ?? 'desdobramento',
    emailSuspeito: extra.emailSuspeito ?? false,
  })
  const tipos = (blocos: ReturnType<typeof blocosDaRevisao<ReturnType<typeof linha>>>) =>
    blocos.map((bloco) => (bloco.tipo === 'email' ? `email:${bloco.itens.map((i) => i.revisaoId).join('+')}` : bloco.item.revisaoId))

  it('junta as revisões do mesmo e-mail onde a primeira aparece', () => {
    const blocos = blocosDaRevisao([linha('a', 'e1'), linha('x', null, { pendentesNoEmail: 1 }), linha('b', 'e1')], new Set())
    expect(tipos(blocos)).toEqual(['email:a+b', 'x'])
  })

  it('não junta quando a lista não tem todas as pendentes do e-mail', () => {
    const blocos = blocosDaRevisao([linha('a', 'e1', { pendentesNoEmail: 3 }), linha('b', 'e1', { pendentesNoEmail: 3 })], new Set())
    expect(tipos(blocos)).toEqual(['a', 'b'])
  })

  it('não junta e-mail de uma revisão só', () => {
    expect(tipos(blocosDaRevisao([linha('a', 'e1', { pendentesNoEmail: 1 })], new Set()))).toEqual(['a'])
  })

  it('e-mail suspeito ou motivo de alerta fica item a item', () => {
    expect(tipos(blocosDaRevisao([linha('a', 'e1'), linha('b', 'e1', { emailSuspeito: true })], new Set()))).toEqual(['a', 'b'])
    expect(tipos(blocosDaRevisao([linha('a', 'e1'), linha('b', 'e1', { motivo: 'cpf_invalido' })], new Set()))).toEqual(['a', 'b'])
    expect(tipos(blocosDaRevisao([linha('a', 'e1'), linha('b', 'e1', { motivo: 'conteudo_suspeito' })], new Set()))).toEqual(['a', 'b'])
  })

  it('"Ver um por um" separa o e-mail', () => {
    expect(tipos(blocosDaRevisao([linha('a', 'e1'), linha('b', 'e1')], new Set(['e1'])))).toEqual(['a', 'b'])
  })
})

describe('depoisDeResolverVarias', () => {
  it('tira todas e desconta do total, pedindo a próxima leva se a lista acabou', () => {
    expect(depoisDeResolverVarias([item('a'), item('b'), item('c')], 9, ['a', 'c'])).toEqual({ itens: [item('b')], total: 7, recarregar: false })
    expect(depoisDeResolverVarias([item('a'), item('b')], 5, ['a', 'b'])).toEqual({ itens: [], total: 3, recarregar: true })
  })

  it('não desconta o que já não estava na lista', () => {
    expect(depoisDeResolverVarias([item('a')], 1, ['a', 'z'])).toEqual({ itens: [], total: 0, recarregar: false })
  })
})
