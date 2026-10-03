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

  it('texto como string confere que a mensagem o CONTÉM; sem mensagem, só a classe', async () => {
    await recusada(Promise.reject(new ErroDeNegocio('E-mail ou senha incorretos.')), ErroDeNegocio, 'senha incorretos')
    await recusada(Promise.reject(new ErroDeNegocio('qualquer coisa')), ErroDeNegocio)
    await expect(
      recusada(Promise.reject(new ErroDeNegocio('A conta está inativa.')), ErroDeNegocio, 'E-mail ou senha incorretos.'),
    ).rejects.toThrow(/to contain/)
  })

  it('recusa operação que foi aceita', async () => {
    await expect(recusada(Promise.resolve('ok'), ErroDeNegocio, /Liga/)).rejects.toThrow(/foi aceita/)
  })
})

/**
 * O padrão antigo não volta: nos testes de serviço, recusa passa por
 * `recusada` (ou confere a classe com `toBeInstanceOf`, ou o código do Prisma
 * com `toMatchObject`, quando a recusa É do banco de propósito).
 *
 * `rejects.toThrow(…)` — com regex, texto, constante ou vazio, numa linha ou
 * quebrado pelo formatador — só nos dois arquivos cuja recusa é do banco e é
 * conferida pela frase EXATA dele: o `SIGNAL` do trigger da trilha e o erro
 * 1364 da coluna sem padrão.
 */
const RECUSA_DO_BANCO_PELA_FRASE = new Set(['trilha-append-only.test.ts', 'dominio-obrigatorio.test.ts'])

describe('testes de serviço conferem recusa pela classe', () => {
  it('nenhum usa `rejects.toThrow(…)`, em nenhuma formatação', () => {
    const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'servicos')
    const comTextoSo = readdirSync(pasta)
      .filter((nome) => nome.endsWith('.test.ts') && !RECUSA_DO_BANCO_PELA_FRASE.has(nome))
      .filter((nome) => /\.rejects\s*\.toThrow\s*\(/.test(readFileSync(join(pasta, nome), 'utf8')))
    expect(comTextoSo).toEqual([])
  })
})
