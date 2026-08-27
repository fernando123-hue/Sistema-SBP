import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { limparCacheDeAmbiente } from './ambiente'
import { origemDaRequisicao } from './http'

/**
 * Identificação da origem da requisição.
 *
 * O limite de taxa por origem só vale alguma coisa se a origem não puder ser
 * escolhida por quem chama. Medido no servidor de desenvolvimento: quando o
 * cliente NÃO manda `x-forwarded-for`, o Next preenche com o endereço real do
 * socket; quando manda, o Next **repassa o valor do cliente inteiro**, sem
 * acrescentar nada. Ou seja: sem um proxy confiável na frente, o cabeçalho é
 * texto livre escrito pelo atacante, e ler a primeira entrada dele é ler o que
 * ele quis escrever.
 */

const VARIAVEL = 'PROXIES_CONFIAVEIS'
const original = process.env[VARIAVEL]

function pedido(cabecalhos: Record<string, string>): Request {
  return new Request('http://localhost/api/sessao', { headers: cabecalhos })
}

function comProxies(quantidade: number): void {
  process.env[VARIAVEL] = String(quantidade)
  limparCacheDeAmbiente()
}

beforeEach(() => limparCacheDeAmbiente())

afterEach(() => {
  if (original === undefined) delete process.env[VARIAVEL]
  else process.env[VARIAVEL] = original
  limparCacheDeAmbiente()
})

describe('sem proxy confiável declarado', () => {
  beforeEach(() => comProxies(0))

  it('cabeçalho forjado não escolhe o balde', () => {
    const um = origemDaRequisicao(pedido({ 'x-forwarded-for': '1.2.3.4' }))
    const outro = origemDaRequisicao(pedido({ 'x-forwarded-for': '9.9.9.9' }))

    // Este é o defeito inteiro: com chaves diferentes, o atacante ganha um
    // balde novo por requisição e o limite de taxa deixa de existir. Bastava
    // variar um cabeçalho.
    expect(um.chave).toBe(outro.chave)
    expect(um.confiavel).toBe(false)
  })

  it('x-real-ip também não escolhe o balde', () => {
    const um = origemDaRequisicao(pedido({ 'x-real-ip': '1.2.3.4' }))
    const outro = origemDaRequisicao(pedido({ 'x-real-ip': '9.9.9.9' }))

    expect(um.chave).toBe(outro.chave)
    expect(um.confiavel).toBe(false)
  })
})

describe('com proxy confiável declarado', () => {
  it('com um proxy, vale a ÚLTIMA entrada — a que o proxy acrescentou', () => {
    comProxies(1)

    // O cliente mandou "1.2.3.4"; o proxy confiável acrescentou o endereço
    // real dele no fim. Ler a primeira entrada — o que o código fazia — é ler
    // exatamente o valor que o atacante escolheu.
    const origem = origemDaRequisicao(pedido({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }))

    expect(origem.chave).toContain('203.0.113.9')
    expect(origem.chave).not.toContain('1.2.3.4')
    expect(origem.confiavel).toBe(true)
  })

  it('com dois proxies, pula os dois últimos', () => {
    comProxies(2)

    const origem = origemDaRequisicao(
      pedido({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9, 10.0.0.1' }),
    )

    expect(origem.chave).toContain('203.0.113.9')
    expect(origem.confiavel).toBe(true)
  })

  it('cliente que não forja nada continua identificado', () => {
    comProxies(1)

    const origem = origemDaRequisicao(pedido({ 'x-forwarded-for': '203.0.113.9' }))

    expect(origem.chave).toContain('203.0.113.9')
    expect(origem.confiavel).toBe(true)
  })

  it('cadeia curta demais para a configuração não é confiável', () => {
    comProxies(2)

    // Declarados dois saltos, chegou um só: ou a configuração está errada, ou
    // alguém alcançou o servidor por fora do proxy. Nos dois casos o valor não
    // prova nada, e supor que prova é pior do que admitir que não sabe.
    const origem = origemDaRequisicao(pedido({ 'x-forwarded-for': '203.0.113.9' }))

    expect(origem.confiavel).toBe(false)
  })

  it('sem cabeçalho nenhum não é confiável', () => {
    comProxies(1)

    const origem = origemDaRequisicao(pedido({}))
    expect(origem.confiavel).toBe(false)
  })
})

describe('proxy que manda só x-real-ip', () => {
  beforeEach(() => comProxies(1))

  it('cada cliente ganha seu balde, em vez de todos caírem no do proxy', () => {
    // Medido contra nginx-como-o-Next-vê: quando o proxy NÃO reescreve
    // `x-forwarded-for`, o Next preenche o cabeçalho com o endereço do socket
    // — que é o do PRÓPRIO PROXY. A cadeia fica com um elemento só, a leitura
    // por posição devolve o IP do proxy, e 25 clientes distintos viram um
    // balde só. Com o limite apertado ligado, isso trancou a equipe inteira no
    // 21º pedido: o "DoS de graça" chegando por uma configuração que o
    // operador tem toda razão de achar correta.
    const um = origemDaRequisicao(
      pedido({ 'x-forwarded-for': '10.0.0.1', 'x-real-ip': '198.51.100.7' }),
    )
    const outro = origemDaRequisicao(
      pedido({ 'x-forwarded-for': '10.0.0.1', 'x-real-ip': '198.51.100.8' }),
    )

    expect(um.chave).not.toBe(outro.chave)
    expect(um.chave).toContain('198.51.100.7')
    expect(um.confiavel).toBe(true)
  })

  it('cadeia mais longa que o salto confiável ainda manda', () => {
    // Aqui o proxy DE FATO acrescentou: o cliente mandou "1.2.3.4" e a cadeia
    // veio com dois elementos. A cadeia é a fonte mais forte e vence.
    const origem = origemDaRequisicao(
      pedido({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9', 'x-real-ip': '203.0.113.9' }),
    )

    expect(origem.chave).toContain('203.0.113.9')
    expect(origem.confiavel).toBe(true)
  })

  it('com dois saltos, x-real-ip não vale — ele aponta o proxy de dentro', () => {
    comProxies(2)

    // Com mais de um salto, o `x-real-ip` que o proxy interno escreve é o
    // endereço do proxy EXTERNO, não o do cliente. Só a cadeia sabe a ordem.
    const origem = origemDaRequisicao(
      pedido({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9, 10.0.0.1', 'x-real-ip': '10.0.0.1' }),
    )

    expect(origem.chave).toContain('203.0.113.9')
  })

  it('sem proxy confiável, x-real-ip continua sem valer nada', () => {
    comProxies(0)

    const um = origemDaRequisicao(pedido({ 'x-real-ip': '1.2.3.4' }))
    const outro = origemDaRequisicao(pedido({ 'x-real-ip': '9.9.9.9' }))

    expect(um.chave).toBe(outro.chave)
    expect(um.confiavel).toBe(false)
  })
})
