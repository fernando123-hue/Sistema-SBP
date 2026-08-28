import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { conferirAssinatura } from '../core/seguranca/assinatura-de-arquivo'
import { FalhaDeArmazenamento } from '../ports/armazenamento'
import { ArmazenamentoEmDisco } from './armazenamento-disco'

/**
 * Testes do armazenamento de anexos e da conferência de tipo real.
 *
 * Usam um diretório temporário de verdade — o ponto do adapter é justamente
 * tocar o disco, e um duble aqui testaria o duble.
 */

let raiz: string
let armazenamento: ArmazenamentoEmDisco

const PDF = new TextEncoder().encode('%PDF-1.4\nconteudo sintetico\n%%EOF')
const EXECUTAVEL = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00])

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), 'sbp-armazenamento-'))
  armazenamento = new ArmazenamentoEmDisco(raiz)
})

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true })
})

describe('armazenamento em disco', () => {
  it('guarda e devolve os mesmos bytes', async () => {
    const chave = await armazenamento.guardar(PDF, '.pdf')
    const lido = await armazenamento.ler(chave)

    expect(lido).not.toBeNull()
    expect(Array.from(lido!)).toEqual(Array.from(PDF))
  })

  it('a chave não deriva do nome do arquivo', async () => {
    const primeira = await armazenamento.guardar(PDF, '.pdf')
    const segunda = await armazenamento.guardar(PDF, '.pdf')

    // Nome de anexo vem do remetente. Derivar caminho dele é convite a
    // travessia de diretório e a colisão entre dois `documento.pdf` de pessoas
    // diferentes — o segundo sobrescreveria o primeiro em silêncio.
    expect(primeira).not.toBe(segunda)
  })

  it('ler chave inexistente devolve nulo, não explode', async () => {
    // Ausente é resposta legítima: a retenção pode ter expurgado o arquivo.
    expect(await armazenamento.ler('aa/naoexiste.pdf')).toBeNull()
  })

  it('remover é idempotente', async () => {
    const chave = await armazenamento.guardar(PDF, '.pdf')
    await armazenamento.remover(chave)
    await expect(armazenamento.remover(chave)).resolves.toBeUndefined()
    expect(await armazenamento.ler(chave)).toBeNull()
  })

  it('recusa chave que escapa da raiz', async () => {
    // Defesa em profundidade: a chave é gerada aqui, mas se um dia vier de um
    // banco corrompido ou de migração mal feita, não pode virar caminho válido.
    await expect(armazenamento.ler('../../etc/passwd')).rejects.toThrow(FalhaDeArmazenamento)
  })

  it('extensão forjada não vira caminho', async () => {
    const chave = await armazenamento.guardar(PDF, '../../malicioso')
    expect(chave).not.toContain('..')
    expect(await armazenamento.ler(chave)).not.toBeNull()
  })

  it('espalha em subpastas em vez de amontoar tudo numa só', async () => {
    await armazenamento.guardar(PDF, '.pdf')
    const entradas = await readdir(raiz)

    // Diretório único com dezenas de milhares de arquivos fica lento em
    // qualquer sistema de arquivos.
    expect(entradas[0]!.length).toBe(2)
  })
})

describe('conferência do tipo real do arquivo', () => {
  it('aceita PDF de verdade', () => {
    expect(conferirAssinatura('laudo.pdf', PDF).situacao).toBe('confere')
  })

  it('recusa executável disfarçado de PDF', () => {
    // O caso que a allowlist de extensão NÃO pega: o nome termina em `.pdf` e
    // passa por ela inteiro. Só os bytes denunciam.
    const veredicto = conferirAssinatura('laudo.pdf', EXECUTAVEL)
    expect(veredicto.situacao).toBe('divergente')
  })

  it('recusa arquivo vazio com extensão que exige assinatura', () => {
    expect(conferirAssinatura('vazio.pdf', new Uint8Array()).situacao).toBe('divergente')
  })

  it('admite que texto puro não tem assinatura, em vez de fingir que tem', () => {
    // Honestidade sobre o limite: `.txt` é qualquer sequência de bytes. Inventar
    // uma verificação aqui daria falsa sensação de proteção.
    expect(conferirAssinatura('lista.txt', EXECUTAVEL).situacao).toBe('sem_assinatura_conhecida')
    expect(conferirAssinatura('planilha.csv', PDF).situacao).toBe('sem_assinatura_conhecida')
  })

  it('reconhece PNG, JPEG e OOXML pelos bytes certos', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])
    const docx = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14])

    expect(conferirAssinatura('foto.png', png).situacao).toBe('confere')
    expect(conferirAssinatura('foto.jpg', jpeg).situacao).toBe('confere')
    expect(conferirAssinatura('doc.docx', docx).situacao).toBe('confere')

    // E não confunde um com o outro.
    expect(conferirAssinatura('foto.png', jpeg).situacao).toBe('divergente')
  })
})
