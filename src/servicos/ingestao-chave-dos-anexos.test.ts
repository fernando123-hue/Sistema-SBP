import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ArmazenamentoEmDisco } from '../adapters/armazenamento-disco'
import { IaMock } from '../adapters/ia-mock'
import { IngestaoMock } from '../adapters/ingestao-mock'
import { ChaveDosAnexosMudouError } from '../ports/armazenamento'
import { obterPrisma } from '../servidor/prisma'
import { DATA_BASE, atorDeTeste, limparTudo } from '../testes/apoio'
import { sincronizar } from './ingestao'

/**
 * Chave dos anexos trocada para a ingestão ANTES de gastar uma chamada de IA.
 *
 * Revisão do PR #36: a sentinela conferia a chave dentro de `guardar`, que roda
 * depois de `interpretar`. Com a chave errada, cada e-mail com anexo pagava a
 * IA e falhava um a um, e o evento gravava só o nome da classe.
 *
 * O duble de ingestão entrega anexos sem bytes — `guardar` nunca é chamado por
 * ele. Então, sem a conferência no início de `sincronizar`, este lote passaria
 * inteiro com a chave errada: é isso que dá prova ao teste.
 */

const banco = obterPrisma()
const PDF = new TextEncoder().encode('%PDF-1.4\nconteudo sintetico\n%%EOF')
const operador = atorDeTeste('operador-sintetico', 'operador')

let raiz: string

beforeEach(async () => {
  await limparTudo(banco)
  raiz = await mkdtemp(join(tmpdir(), 'sbp-ingestao-chave-'))
  // A pasta nasce com um anexo cifrado pela chave ANTIGA — e com a sentinela dela.
  await new ArmazenamentoEmDisco(raiz, 'segredo-de-teste-antigo').guardar(PDF, '.pdf')
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(raiz, { recursive: true, force: true })
})

describe('ingestão com a chave dos anexos', () => {
  it('chave trocada: o lote para antes da primeira chamada de IA, com o motivo na memória', async () => {
    const ia = new IaMock()
    const interpretar = vi.spyOn(ia, 'interpretar')

    await expect(
      sincronizar(
        {
          banco,
          ingestao: new IngestaoMock({ datas: [DATA_BASE], semente: 5 }),
          ia,
          armazenamento: new ArmazenamentoEmDisco(raiz, 'segredo-de-teste-novo'),
        },
        operador,
      ),
    ).rejects.toBeInstanceOf(ChaveDosAnexosMudouError)

    expect(interpretar).not.toHaveBeenCalled()
    expect(await banco.email.count()).toBe(0)

    const evento = await banco.eventoProcessamento.findFirst({
      where: { etapa: 'ingestao', situacao: 'reprocessavel' },
    })
    // Legível na memória operacional — não só o nome da classe.
    expect(evento?.mensagem).toMatch(/ANEXOS_SECRET/)
  })

  it('chave certa: a conferência não atrapalha o lote', async () => {
    const ia = new IaMock()
    const interpretar = vi.spyOn(ia, 'interpretar')

    await sincronizar(
      {
        banco,
        ingestao: new IngestaoMock({ datas: [DATA_BASE], semente: 5 }),
        ia,
        armazenamento: new ArmazenamentoEmDisco(raiz, 'segredo-de-teste-antigo'),
      },
      operador,
    )

    expect(interpretar).toHaveBeenCalled()
  })
})
