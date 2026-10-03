import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ErroDeNegocio } from '../core/erros'
import { recusada } from './recusa'

/** Um erro com o nome de classe que o Prisma usa — sem precisar de banco. */
class PrismaClientKnownRequestError extends Error {}

describe('recusada', () => {
  it('aceita a classe e o texto certos, e devolve o erro', async () => {
    const erro = await recusada(Promise.reject(new ErroDeNegocio('Liga não encontrada.')), ErroDeNegocio, /Liga/)
    expect(erro.message).toBe('Liga não encontrada.')
  })

  it('recusa erro do banco mesmo quando o texto bate — o defeito do #176', async () => {
    const doBanco = new PrismaClientKnownRequestError('Invalid `tx.nota.create()`… Liga não encontrada…')
    await expect(recusada(Promise.reject(doBanco), Error, /Liga não encontrada/)).rejects.toThrow(/PrismaClient/)
  })

  it('recusa a classe errada', async () => {
    await expect(recusada(Promise.reject(new Error('Liga não encontrada.')), ErroDeNegocio, /Liga/)).rejects.toThrow(
      /ErroDeNegocio/,
    )
  })

  it('recusa operação que foi aceita', async () => {
    await expect(recusada(Promise.resolve('ok'), ErroDeNegocio, /Liga/)).rejects.toThrow(/foi aceita/)
  })
})

/**
 * O padrão antigo não volta: nos testes de serviço, toda recusa passa por
 * `recusada`. A exceção é a trilha append-only, cuja recusa É do banco (o
 * trigger) e é conferida pela frase exata do `SIGNAL`.
 */
describe('testes de serviço conferem recusa pela classe', () => {
  it('nenhum usa `rejects.toThrow(/texto/)`', () => {
    const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'servicos')
    const comTextoSo = readdirSync(pasta)
      .filter((nome) => nome.endsWith('.test.ts') && nome !== 'trilha-append-only.test.ts')
      .filter((nome) => /\.rejects\.toThrow\(\//.test(readFileSync(join(pasta, nome), 'utf8')))
    expect(comTextoSo).toEqual([])
  })
})
