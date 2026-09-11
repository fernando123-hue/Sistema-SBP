import { mkdtemp, readdir, rm } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FalhaDeArmazenamento } from '../ports/armazenamento'
import { ArmazenamentoEmDisco } from './armazenamento-disco'

/**
 * A sentinela da chave diante de falha de DISCO.
 *
 * Arquivo próprio porque troca `node:fs/promises` por um duble parcial, e o
 * mock não pode vazar para os testes que tocam o disco de verdade. Só `link` e
 * `writeFile` são interceptados, e só quando o teste pede; o resto é o módulo
 * real.
 *
 * Os dois defeitos vieram da segunda revisão da correção da corrida:
 * temporário órfão quando a gravação dele falha no meio, e `EPERM` — que no
 * Windows cobre também antivírus e ACL — tratado como "disco sem link físico",
 * degradando calado para a publicação não atômica.
 */

vi.mock('node:fs/promises', async (importarOriginal) => {
  const original = await importarOriginal<typeof import('node:fs/promises')>()
  return {
    ...original,
    link: vi.fn(original.link),
    writeFile: vi.fn(original.writeFile),
  }
})

const PDF = new TextEncoder().encode('%PDF-1.4\nconteudo sintetico\n%%EOF')
const SENTINELA = '.sentinela-da-chave'

let raiz: string

function erroDeDisco(codigo: string): Error {
  return Object.assign(new Error(`${codigo}: falha sintética de disco`), { code: codigo })
}

async function arquivosNaRaiz(): Promise<string[]> {
  return (await readdir(raiz, { withFileTypes: true }))
    .filter((entrada) => entrada.isFile())
    .map((entrada) => entrada.name)
}

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), 'sbp-sentinela-disco-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.mocked(fs.link).mockReset()
  vi.mocked(fs.writeFile).mockReset()
  await rm(raiz, { recursive: true, force: true })
})

describe('sentinela da chave diante de falha de disco', () => {
  it('temporário que falha no meio da gravação não fica órfão na raiz', async () => {
    const writeFileReal = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises'))
      .writeFile
    vi.mocked(fs.writeFile).mockImplementationOnce(async (caminho, _dados, opcoes) => {
      // Cria o arquivo (o `wx` já abriu) e falha antes de terminar — disco cheio.
      await writeFileReal(caminho, new Uint8Array(), opcoes)
      throw erroDeDisco('ENOSPC')
    })

    await expect(new ArmazenamentoEmDisco(raiz, 'segredo-de-teste-disco').guardar(PDF, '.pdf')).rejects.toBeInstanceOf(
      FalhaDeArmazenamento,
    )

    expect(await arquivosNaRaiz()).toEqual([])
  })

  it('EPERM ao publicar falha alto — não degrada para a publicação não atômica', async () => {
    vi.mocked(fs.link).mockRejectedValueOnce(erroDeDisco('EPERM'))

    await expect(new ArmazenamentoEmDisco(raiz, 'segredo-de-teste-eperm').guardar(PDF, '.pdf')).rejects.toBeInstanceOf(
      FalhaDeArmazenamento,
    )

    expect(await arquivosNaRaiz()).toEqual([])
  })

  it('disco sem link físico degrada para a gravação direta — e deixa isso escrito no log', async () => {
    vi.mocked(fs.link).mockRejectedValueOnce(erroDeDisco('ENOTSUP'))
    const saida: string[] = []
    const capturar = (pedaco: unknown) => {
      saida.push(String(pedaco))
      return true
    }
    vi.spyOn(process.stdout, 'write').mockImplementation(capturar)
    vi.spyOn(process.stderr, 'write').mockImplementation(capturar)

    await new ArmazenamentoEmDisco(raiz, 'segredo-de-teste-sem-link').guardar(PDF, '.pdf')

    expect(await arquivosNaRaiz()).toEqual([SENTINELA])
    expect(saida.join('')).toContain('sem link físico')
  })
})
