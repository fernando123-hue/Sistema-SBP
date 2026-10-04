import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SUFIXO_TEMPORARIO, chavesDeAnexo, encontrarSobras, limparSobras, recifrarUm } from './recifrar-um'

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

  it('o original some no meio (a limpeza diária expurgou): o rename não o ressuscita (revisão de segurança do #215, S4)', async () => {
    // A releitura é o passo entre a leitura e a troca: é ali que a expurgação cai.
    const lerDeVoltaEnquantoExpurga = async () => {
      await rm(join(raiz, 'ab', NOME))
      return ORIGINAL
    }

    await expect(recifrarUm(raiz, CHAVE, { cifrar, lerDeVolta: lerDeVoltaEnquantoExpurga })).rejects.toThrow(/sumiu/)

    expect(await readdir(join(raiz, 'ab'))).toEqual([])
  })

  it('o original já não existe na chamada: diz que sumiu, não que é link (revisões do #219, técnica 1 e segurança S2)', async () => {
    await rm(join(raiz, 'ab', NOME))

    await expect(recifrarUm(raiz, CHAVE, { cifrar, lerDeVolta: async () => ORIGINAL })).rejects.toThrow(/sumiu/)

    expect(await readdir(join(raiz, 'ab'))).toEqual([])
  })

  it('link simbólico não é trocado por cópia cifrada do alvo (revisão de segurança do #215, S3)', async (contexto) => {
    const fora = await mkdtemp(join(tmpdir(), 'sbp-recifrar-fora-'))
    try {
      const alvo = join(fora, 'qualquer.txt')
      await writeFile(alvo, ORIGINAL)
      const link = `ab${'f'.repeat(30)}.pdf`
      if (!(await criarLink(alvo, join(raiz, 'ab', link)))) contexto.skip()

      await expect(recifrarUm(raiz, `ab/${link}`, { cifrar, lerDeVolta: async () => ORIGINAL })).rejects.toThrow(
        /arquivo comum/,
      )

      expect((await lstat(join(raiz, 'ab', link))).isSymbolicLink()).toBe(true)
      expect(await readFile(alvo)).toEqual(ORIGINAL)
      expect((await readdir(join(raiz, 'ab'))).sort()).toEqual([NOME, link].sort())
    } finally {
      await rm(fora, { recursive: true, force: true })
    }
  })
})

describe('chaves de anexo a recifrar', () => {
  it('só o anexo que guardar cria vira chave; sobra é pulada; o resto é dito, não recifrado (revisão de segurança do #219, S1)', async () => {
    await writeFile(join(raiz, 'ab', `${NOME}${SUFIXO_TEMPORARIO}`), CIFRADO)
    await mkdir(join(raiz, 'ab', `ab${'9'.repeat(30)}`))
    await writeFile(join(raiz, 'ab', 'leiame.txt'), 'x')
    await writeFile(join(raiz, 'ab', `qualquer.pdf${SUFIXO_TEMPORARIO}`), 'x')
    await writeFile(join(raiz, 'ab', `cd${'0'.repeat(30)}.pdf`), 'x')
    await mkdir(join(raiz, 'backup'))
    await writeFile(join(raiz, 'backup', 'planilha.xlsx'), 'x')
    await writeFile(join(raiz, '.sentinela-da-chave'), 'x')
    await writeFile(join(raiz, 'cd'), 'tem nome de subpasta e não é pasta')

    expect(await chavesDeAnexo(raiz)).toEqual({
      chaves: [CHAVE],
      ignoradas: [
        'ab/leiame.txt',
        `ab/qualquer.pdf${SUFIXO_TEMPORARIO}`,
        `ab/ab${'9'.repeat(30)}`,
        `ab/cd${'0'.repeat(30)}.pdf`,
        'cd',
      ].sort(),
    })
  })

  it('a sobra de anexo SEM extensão não vira chave, embora `recifrando` caiba na forma de extensão (revisões do #219, rodada 2, N1)', async () => {
    const semExtensao = `ab${'1'.repeat(30)}`
    await writeFile(join(raiz, 'ab', semExtensao), ORIGINAL)
    await writeFile(join(raiz, 'ab', `${semExtensao}${SUFIXO_TEMPORARIO}`), 'parcial')

    expect(await chavesDeAnexo(raiz)).toEqual({ chaves: [CHAVE, `ab/${semExtensao}`].sort(), ignoradas: [] })
  })

  it('link simbólico com nome de anexo é dito, não vira chave (revisão de segurança do #215, S3)', async (contexto) => {
    const link = `ab${'f'.repeat(30)}.pdf`
    if (!(await criarLink(join(raiz, 'ab', NOME), join(raiz, 'ab', link)))) contexto.skip()

    expect(await chavesDeAnexo(raiz)).toEqual({ chaves: [CHAVE], ignoradas: [`ab/${link}`] })
  })

  it('pasta que ainda não existe: a falha sobe com o código, para quem chama decidir', async () => {
    await expect(chavesDeAnexo(join(raiz, 'nunca-criada'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

/** No Windows sem permissão de link, `symlink` dá `EPERM`: o teste pula ali e roda no CI. */
async function criarLink(alvo: string, caminho: string): Promise<boolean> {
  try {
    await symlink(alvo, caminho)
    return true
  } catch (erro) {
    if ((erro as { code?: unknown }).code === 'EPERM') return false
    throw erro
  }
}

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
