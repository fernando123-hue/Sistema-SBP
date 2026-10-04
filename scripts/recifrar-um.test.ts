import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SUFIXO_TEMPORARIO, limparSobras, recifrarUm } from './recifrar-um'

/**
 * A recifragem de um anexo não pode deixar cópia do documento para trás: um
 * `<chave>.recifrando` sobrando é o documento inteiro fora de qualquer prazo
 * (invariante 11), e a varredura do `A78` não o lista. Revisão técnica do
 * #211, N7. Contra o disco de verdade, numa pasta temporária.
 */

const ORIGINAL = Buffer.from('%PDF-1.4 texto puro sintetico')
const CIFRADO = Buffer.from('SBP_ENC_v1!!cifrado-sintetico')

let raiz: string

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), 'sbp-recifrar-'))
  await mkdir(join(raiz, 'ab'))
  await writeFile(join(raiz, 'ab', 'abc.pdf'), ORIGINAL)
})

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true })
})

const cifrar = () => CIFRADO

describe('recifrar um anexo', () => {
  it('caminho feliz: o original vira o cifrado, e nada sobra ao lado', async () => {
    await recifrarUm(raiz, 'ab/abc.pdf', { cifrar, lerDeVolta: async () => ORIGINAL })

    expect(await readFile(join(raiz, 'ab', 'abc.pdf'))).toEqual(CIFRADO)
    expect(await readdir(join(raiz, 'ab'))).toEqual(['abc.pdf'])
  })

  it('a releitura lança: o temporário sai, o original fica intacto, e o erro sobe', async () => {
    const lerDeVolta = async () => Promise.reject(new Error('não decifra (simulado)'))

    await expect(recifrarUm(raiz, 'ab/abc.pdf', { cifrar, lerDeVolta })).rejects.toThrow('não decifra')

    expect(await readFile(join(raiz, 'ab', 'abc.pdf'))).toEqual(ORIGINAL)
    expect(await readdir(join(raiz, 'ab'))).toEqual(['abc.pdf'])
  })

  it('a releitura devolve outros bytes: recusa, e nada sobra', async () => {
    const lerDeVolta = async () => Buffer.from('outra coisa')

    await expect(recifrarUm(raiz, 'ab/abc.pdf', { cifrar, lerDeVolta })).rejects.toThrow(/releitura/)

    expect(await readdir(join(raiz, 'ab'))).toEqual(['abc.pdf'])
  })
})

describe('sobras de uma execução interrompida', () => {
  it('saem, e o original ao lado fica', async () => {
    await writeFile(join(raiz, 'ab', `abc.pdf${SUFIXO_TEMPORARIO}`), CIFRADO)

    expect(await limparSobras(raiz)).toEqual([`ab/abc.pdf${SUFIXO_TEMPORARIO}`])

    expect(await readdir(join(raiz, 'ab'))).toEqual(['abc.pdf'])
  })

  it('pasta que ainda não existe: nenhuma sobra, sem falha', async () => {
    expect(await limparSobras(join(raiz, 'nunca-criada'))).toEqual([])
  })

  it('sem sobra, nada muda', async () => {
    expect(await limparSobras(raiz)).toEqual([])
    expect(await readdir(join(raiz, 'ab'))).toEqual(['abc.pdf'])
  })
})
