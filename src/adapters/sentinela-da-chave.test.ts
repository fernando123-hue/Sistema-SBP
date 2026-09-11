import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FalhaDeArmazenamento } from '../ports/armazenamento'
import { ArmazenamentoEmDisco, chaveDeCifragem, cifrarBytes } from './armazenamento-disco'

/**
 * A sentinela da chave dos anexos.
 *
 * Achado 34 da auditoria de 08/09/2026: trocar a chave (rotacionar
 * `SESSAO_SECRET` sem fixar `ANEXOS_SECRET`) só falhava quando alguém abria um
 * documento antigo — e até lá cada anexo novo era gravado com a chave nova. A
 * garantia que estes testes guardam é a de ORDEM: a chave errada falha antes de
 * o primeiro documento ser gravado com ela.
 *
 * Diretório temporário de verdade, como em `armazenamento.test.ts`: o ponto é
 * tocar o disco.
 */

const PDF = new TextEncoder().encode('%PDF-1.4\nconteudo sintetico\n%%EOF')
const SEGREDO_ANTIGO = 'segredo-de-teste-antigo'
const SEGREDO_NOVO = 'segredo-de-teste-NOVO'
const SENTINELA = '.sentinela-da-chave'

let raiz: string

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), 'sbp-sentinela-'))
})

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true })
})

/** Anexos nas subpastas — a sentinela, na raiz, não conta. */
async function anexosNoDisco(): Promise<string[]> {
  const pastas = (await readdir(raiz, { withFileTypes: true })).filter((e) => e.isDirectory())
  const listas = await Promise.all(pastas.map((pasta) => readdir(join(raiz, pasta.name))))
  return listas.flat()
}

describe('sentinela da chave dos anexos', () => {
  it('a primeira gravação deixa na raiz uma sentinela cifrada, não legível', async () => {
    await new ArmazenamentoEmDisco(raiz, SEGREDO_ANTIGO).guardar(PDF, '.pdf')

    const sentinela = await readFile(join(raiz, SENTINELA))
    expect(sentinela.subarray(0, 12).toString()).toBe('SBP_ENC_v1!!')
    expect(sentinela.includes(Buffer.from('SENTINELA'))).toBe(false)
  })

  it('a mesma chave, noutra instância, segue gravando', async () => {
    await new ArmazenamentoEmDisco(raiz, SEGREDO_ANTIGO).guardar(PDF, '.pdf')
    await new ArmazenamentoEmDisco(raiz, SEGREDO_ANTIGO).guardar(PDF, '.pdf')

    expect(await anexosNoDisco()).toHaveLength(2)
  })

  it('chave trocada falha na PRIMEIRA gravação — e nenhum documento nasce com ela', async () => {
    await new ArmazenamentoEmDisco(raiz, SEGREDO_ANTIGO).guardar(PDF, '.pdf')

    const depoisDaRotacao = new ArmazenamentoEmDisco(raiz, SEGREDO_NOVO)
    await expect(depoisDaRotacao.guardar(PDF, '.pdf')).rejects.toThrow(/ANEXOS_SECRET/)

    expect(await anexosNoDisco()).toHaveLength(1)
  })

  it('chave trocada falha também na primeira LEITURA, com a mensagem que manda arrumar a chave', async () => {
    const chave = await new ArmazenamentoEmDisco(raiz, SEGREDO_ANTIGO).guardar(PDF, '.pdf')

    const depoisDaRotacao = new ArmazenamentoEmDisco(raiz, SEGREDO_NOVO)
    await expect(depoisDaRotacao.ler(chave)).rejects.toThrow(/mudou/)
  })

  it('instalação antiga, sem sentinela: a chave é testada contra um anexo existente antes de ser adotada', async () => {
    await mkdir(join(raiz, 'ab'), { recursive: true })
    await writeFile(join(raiz, 'ab', 'antigo.pdf'), cifrarBytes(PDF, chaveDeCifragem(SEGREDO_ANTIGO)))

    await expect(new ArmazenamentoEmDisco(raiz, SEGREDO_NOVO).guardar(PDF, '.pdf')).rejects.toThrow(
      /ANEXOS_SECRET/,
    )
    // A chave errada NÃO virou a sentinela — senão passaria a confirmá-la.
    expect(await readdir(raiz)).not.toContain(SENTINELA)

    await new ArmazenamentoEmDisco(raiz, SEGREDO_ANTIGO).guardar(PDF, '.pdf')
    expect(await readdir(raiz)).toContain(SENTINELA)
  })

  it('sentinela em texto puro não confirma chave nenhuma', async () => {
    await writeFile(join(raiz, SENTINELA), 'SBP-SENTINELA-DA-CHAVE-v1')

    await expect(
      new ArmazenamentoEmDisco(raiz, SEGREDO_ANTIGO).guardar(PDF, '.pdf'),
    ).rejects.toBeInstanceOf(FalhaDeArmazenamento)
  })

  it('primeiras gravações SIMULTÂNEAS numa pasta nova: todas passam, uma sentinela só, nenhum temporário largado', async () => {
    // A revisão reproduziu a corrida: quem perdia o `EEXIST` relia a sentinela
    // da outra ainda sendo escrita e acusava "a chave mudou" — um 503 falso,
    // com a chave certa, 6 vezes em 2000.
    const gravacoes = Array.from({ length: 8 }, () =>
      new ArmazenamentoEmDisco(raiz, SEGREDO_ANTIGO).guardar(PDF, '.pdf'),
    )
    await expect(Promise.all(gravacoes)).resolves.toHaveLength(8)

    const arquivosNaRaiz = (await readdir(raiz, { withFileTypes: true }))
      .filter((entrada) => entrada.isFile())
      .map((entrada) => entrada.name)
    expect(arquivosNaRaiz).toEqual([SENTINELA])
    expect(await anexosNoDisco()).toHaveLength(8)
  })

  it('o que não se consegue ler entre os anexos vira FalhaDeArmazenamento, não erro cru', async () => {
    // Uma pasta onde deveria haver arquivo: `readFile` falha com EISDIR. Erro
    // cru cairia no 500 genérico de `rota()`; a falha de fronteira tem nome.
    await mkdir(join(raiz, 'ab', 'nao-e-arquivo'), { recursive: true })

    await expect(
      new ArmazenamentoEmDisco(raiz, SEGREDO_ANTIGO).guardar(PDF, '.pdf'),
    ).rejects.toBeInstanceOf(FalhaDeArmazenamento)
  })
})
