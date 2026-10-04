import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SUFIXO_TEMPORARIO, encontrarSobras, limparSobras, recifrarUm } from './recifrar-um'

/**
 * A recifragem de um anexo não pode deixar cópia do documento para trás: um
 * `<chave>.recifrando` sobrando é o documento inteiro fora de qualquer prazo
 * (invariante 11), e a varredura do `A78` não o lista. Revisão técnica do
 * #211, N7. Contra o disco de verdade, numa pasta temporária.
 */

const ORIGINAL = Buffer.from('%PDF-1.4 texto puro sintetico')
const CIFRADO = Buffer.from('SBP_ENC_v1!!cifrado-sintetico')
const NOME = `ab${'c'.repeat(30)}.pdf`
const CHAVE = `ab/${NOME}`

let raiz: string

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), 'sbp-recifrar-'))
  await mkdir(join(raiz, 'ab'))
  await writeFile(join(raiz, 'ab', NOME), ORIGINAL)
})

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true })
})

const cifrar = () => CIFRADO

describe('recifrar um anexo', () => {
  it('caminho feliz: o original vira o cifrado, e nada sobra ao lado', async () => {
    await recifrarUm(raiz, CHAVE, { cifrar, lerDeVolta: async () => ORIGINAL })

    expect(await readFile(join(raiz, 'ab', NOME))).toEqual(CIFRADO)
    expect(await readdir(join(raiz, 'ab'))).toEqual([NOME])
  })

  it('a releitura lança: o temporário sai, o original fica intacto, e o erro sobe', async () => {
    const lerDeVolta = async () => Promise.reject(new Error('não decifra (simulado)'))

    await expect(recifrarUm(raiz, CHAVE, { cifrar, lerDeVolta })).rejects.toThrow('não decifra')

    expect(await readFile(join(raiz, 'ab', NOME))).toEqual(ORIGINAL)
    expect(await readdir(join(raiz, 'ab'))).toEqual([NOME])
  })

  it('a releitura devolve outros bytes: recusa, e nada sobra', async () => {
    const lerDeVolta = async () => Buffer.from('outra coisa')

    await expect(recifrarUm(raiz, CHAVE, { cifrar, lerDeVolta })).rejects.toThrow(/releitura/)

    expect(await readdir(join(raiz, 'ab'))).toEqual([NOME])
  })

  it('disco cheio no meio da gravação: o pedaço parcial sai na hora (revisões do #215, rodada 2, N1)', async () => {
    const gravarAteEncher = async (caminho: string, dados: Buffer) => {
      await writeFile(caminho, dados.subarray(0, 4), { flag: 'wx' })
      throw Object.assign(new Error('ENOSPC: no space left on device (simulado)'), { code: 'ENOSPC' })
    }

    await expect(
      recifrarUm(raiz, CHAVE, { cifrar, lerDeVolta: async () => ORIGINAL, gravar: gravarAteEncher }),
    ).rejects.toThrow('ENOSPC')

    expect(await readdir(join(raiz, 'ab'))).toEqual([NOME])
    expect(await readFile(join(raiz, 'ab', NOME))).toEqual(ORIGINAL)
  })

  it('cifrar que lança não apaga o temporário de outra execução (revisão técnica do #215, rodada 3, B9)', async () => {
    await writeFile(join(raiz, 'ab', `${NOME}${SUFIXO_TEMPORARIO}`), 'de outra execução')
    const cifrarQueLanca = () => {
      throw new Error('cifra falhou (simulado)')
    }

    await expect(recifrarUm(raiz, CHAVE, { cifrar: cifrarQueLanca, lerDeVolta: async () => ORIGINAL })).rejects.toThrow(
      'cifra falhou',
    )

    expect(await readFile(join(raiz, 'ab', `${NOME}${SUFIXO_TEMPORARIO}`), 'utf8')).toBe('de outra execução')
  })

  it('temporário já existente não é sobrescrito: recusa, e o que estava lá fica (revisão de segurança do #215, S2)', async () => {
    await writeFile(join(raiz, 'ab', `${NOME}${SUFIXO_TEMPORARIO}`), 'de outra execução')

    await expect(recifrarUm(raiz, CHAVE, { cifrar, lerDeVolta: async () => ORIGINAL })).rejects.toThrow(/EEXIST/)

    expect(await readFile(join(raiz, 'ab', `${NOME}${SUFIXO_TEMPORARIO}`), 'utf8')).toBe('de outra execução')
    expect(await readFile(join(raiz, 'ab', NOME))).toEqual(ORIGINAL)
  })
})

describe('sobras de uma execução interrompida', () => {
  it('com o original ao lado, saem; o original fica', async () => {
    await writeFile(join(raiz, 'ab', `${NOME}${SUFIXO_TEMPORARIO}`), CIFRADO)

    expect(await limparSobras(raiz)).toEqual({ apagadas: [`${CHAVE}${SUFIXO_TEMPORARIO}`], mantidas: [] })

    expect(await readdir(join(raiz, 'ab'))).toEqual([NOME])
  })

  it('SEM o original ao lado, fica: pode ser a única cópia (revisões do #215, M2 e S1)', async () => {
    const orfa = `ab${'d'.repeat(30)}.pdf${SUFIXO_TEMPORARIO}`
    await writeFile(join(raiz, 'ab', orfa), CIFRADO)

    expect(await limparSobras(raiz)).toEqual({ apagadas: [], mantidas: [`ab/${orfa}`] })

    expect((await readdir(join(raiz, 'ab'))).sort()).toEqual([NOME, orfa].sort())
  })

  it('nome fora do formato de chave, ou fora de subpasta de anexo, não é sobra e não é tocado', async () => {
    await writeFile(join(raiz, 'ab', `qualquer.pdf${SUFIXO_TEMPORARIO}`), 'x')
    await mkdir(join(raiz, 'backup'))
    await writeFile(join(raiz, 'backup', `${NOME}${SUFIXO_TEMPORARIO}`), 'x')
    await mkdir(join(raiz, 'ab', `${'e'.repeat(32)}${SUFIXO_TEMPORARIO}`))

    expect(await limparSobras(raiz)).toEqual({ apagadas: [], mantidas: [] })

    expect(await readdir(join(raiz, 'backup'))).toHaveLength(1)
    expect(await readdir(join(raiz, 'ab'))).toHaveLength(3)
  })

  it('encontrar só conta, sem apagar — é o que o --conferir mostra', async () => {
    await writeFile(join(raiz, 'ab', `${NOME}${SUFIXO_TEMPORARIO}`), CIFRADO)

    expect(await encontrarSobras(raiz)).toEqual({ comOriginal: [`${CHAVE}${SUFIXO_TEMPORARIO}`], semOriginal: [] })
    expect(await readdir(join(raiz, 'ab'))).toHaveLength(2)
  })

  it('pasta que ainda não existe: nenhuma sobra, sem falha', async () => {
    expect(await limparSobras(join(raiz, 'nunca-criada'))).toEqual({ apagadas: [], mantidas: [] })
  })
})
