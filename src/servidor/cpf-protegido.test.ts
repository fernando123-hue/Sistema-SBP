import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { protegerCpf } from './cpf-protegido'

/**
 * O CPF protegido (`A23(b)`): o que fica guardado para achar o item depois que
 * o texto do e-mail saiu — sem que o CPF em si fique guardado.
 *
 * O segredo vem de `BUSCA_SECRET`; nos testes, do `vitest.config.ts`.
 */

describe('CPF protegido', () => {
  it('o mesmo CPF, escrito de jeitos diferentes, dá o mesmo código', () => {
    const comPontos = protegerCpf('111.444.777-35')
    expect(comPontos).not.toBeNull()
    expect(protegerCpf('11144477735')).toBe(comPontos)
    expect(protegerCpf(' 111 444 777 35 ')).toBe(comPontos)
  })

  it('é o código do CPF com o segredo do servidor, com a versão na frente', () => {
    // A versão deixa uma troca futura de segredo conviver com os códigos
    // antigos, em vez de quebrar a busca de uma vez.
    const esperado = createHmac('sha256', process.env['BUSCA_SECRET']!)
      .update('11144477735')
      .digest('hex')
    expect(protegerCpf('111.444.777-35')).toBe(`v1:${esperado}`)
  })

  it('não guarda o CPF: nem o número inteiro nem o começo dele aparecem', () => {
    const codigo = protegerCpf('111.444.777-35')!
    expect(codigo).not.toContain('11144477735')
    expect(codigo).not.toContain('111.444')
  })

  it('CPFs diferentes dão códigos diferentes', () => {
    // 529.982.247-25: outro CPF sintético válido, só para comparar.
    expect(protegerCpf('529.982.247-25')).not.toBe(protegerCpf('111.444.777-35'))
  })

  it('CPF com erro não gera código (resposta 26 do dono)', () => {
    expect(protegerCpf('111.444.777-36')).toBeNull()
    expect(protegerCpf('')).toBeNull()
  })
})
