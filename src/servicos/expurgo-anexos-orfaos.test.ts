import { mkdtemp, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ArmazenamentoEmDisco } from '../adapters/armazenamento-disco'
import { FalhaDeArmazenamento, type ArmazenamentoPort } from '../ports/armazenamento'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo, semearBase } from '../testes/apoio'
import { recusada } from '../testes/recusa'
import {
  LIMITE_DE_ORFAOS_POR_EXECUCAO,
  OrfaosAlemDoLimiteError,
  expurgarAnexosOrfaos,
} from './expurgo-anexos-orfaos'

const banco = obterPrisma()
const DIA = 24 * 60 * 60 * 1000

/**
 * `A78`: o arquivo de anexo que nenhuma linha de `Anexo` aponta sai na limpeza
 * diária, depois do prazo do conteúdo, e a saída fica na trilha.
 *
 * Contra o disco de verdade, numa pasta temporária: a data que protege uma
 * ingestão em curso é a do sistema de arquivos, e um duble só provaria o duble.
 * Dados 100% sintéticos.
 */

let raiz: string
let armazenamento: ArmazenamentoEmDisco
let contador = 0

beforeEach(async () => {
  await limparTudo(banco)
  await semearBase(banco, { totalDeDias: 1 })
  raiz = await mkdtemp(join(tmpdir(), 'sbp-orfaos-'))
  armazenamento = new ArmazenamentoEmDisco(raiz)
})

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true })
})

/** Um arquivo no disco, gravado há `dias` dias. */
async function arquivoGravadoHa(dias: number): Promise<string> {
  const chave = await armazenamento.guardar(new Uint8Array([1, 2, 3]), '.pdf')
  const quando = new Date(Date.now() - dias * DIA)
  await utimes(join(raiz, chave), quando, quando)
  return chave
}

/** Uma linha de `Anexo` apontando para `chave` — o arquivo que tem dono. */
async function anexoNoBanco(chave: string): Promise<void> {
  contador += 1
  await banco.email.create({
    data: {
      messageId: `<orfao-${contador}@exemplo.test>`,
      recebidoEm: new Date(),
      anexos: {
        create: {
          nomeSeguro: 'documento-sintetico.pdf',
          tipoDeclarado: 'application/pdf',
          tamanho: 3,
          aceito: true,
          chaveArmazenamento: chave,
          armazenadoEm: new Date(),
        },
      },
    },
  })
}

async function noDisco(): Promise<string[]> {
  return (await armazenamento.listar()).map((arquivo) => arquivo.chave).sort()
}

function expurgar(alvo: ArmazenamentoPort | null = armazenamento) {
  return expurgarAnexosOrfaos(banco, { diasDeRetencao: 7, armazenamento: alvo })
}

describe('o que sai e o que fica', () => {
  it('arquivo sem linha e com mais de 7 dias sai, e a trilha guarda a chave', async () => {
    const orfao = await arquivoGravadoHa(8)

    const resultado = await expurgar()

    expect(resultado).toEqual({ avaliados: 1, semRegistro: 1, removidos: 1 })
    expect(await noDisco()).toEqual([])
    const linha = await banco.logAuditoria.findFirstOrThrow({ where: { acao: 'anexo_orfao_removido' } })
    expect(linha.entidadeId).toBe(orfao)
    expect(linha.usuario).toBe('sistema')
  })

  it('arquivo sem linha e recente fica: pode ser uma ingestão em curso', async () => {
    const recente = await arquivoGravadoHa(6)

    const resultado = await expurgar()

    expect(resultado).toEqual({ avaliados: 1, semRegistro: 1, removidos: 0 })
    expect(await noDisco()).toEqual([recente])
    expect(await banco.logAuditoria.count({ where: { acao: 'anexo_orfao_removido' } })).toBe(0)
  })

  it('arquivo com linha fica, por mais antigo que seja', async () => {
    const comDono = await arquivoGravadoHa(400)
    await anexoNoBanco(comDono)

    expect(await expurgar()).toEqual({ avaliados: 1, semRegistro: 0, removidos: 0 })
    expect(await noDisco()).toEqual([comDono])
  })

  it('chave antiga gravada com separador do Windows ainda é dona do arquivo (N-25)', async () => {
    // Antes do N-25 a chave ia para o banco com `\`. O disco lista com `/`.
    // Comparar o texto cru faria de todo anexo antigo um órfão — e o apagaria.
    const antiga = await arquivoGravadoHa(400)
    await anexoNoBanco(antiga.replace('/', '\\'))

    expect(await expurgar()).toEqual({ avaliados: 1, semRegistro: 0, removidos: 0 })
    expect(await noDisco()).toEqual([antiga])
  })

  it('a trilha não leva o conteúdo nem o nome do arquivo, só a chave e a data', async () => {
    await arquivoGravadoHa(8)

    await expurgar()

    const linha = await banco.logAuditoria.findFirstOrThrow({ where: { acao: 'anexo_orfao_removido' } })
    expect(Object.keys(JSON.parse(linha.depois!)).sort()).toEqual(['gravadoEm', 'prazoEmDias'])
  })
})

describe('falhar alto', () => {
  it('sem armazenamento, falha: não ter olhado não é não ter órfão', async () => {
    await recusada(expurgar(null), FalhaDeArmazenamento)
  })

  it(`mais de ${LIMITE_DE_ORFAOS_POR_EXECUCAO} órfãos vencidos: nada sai e a execução falha`, async () => {
    // Banco errado (outra `DATABASE_URL`, base vazia) faria de TODO anexo um
    // órfão. O limite transforma isso numa falha visível, não numa pasta vazia.
    for (let i = 0; i <= LIMITE_DE_ORFAOS_POR_EXECUCAO; i += 1) await arquivoGravadoHa(8)

    await recusada(expurgar(), OrfaosAlemDoLimiteError)

    expect(await noDisco()).toHaveLength(LIMITE_DE_ORFAOS_POR_EXECUCAO + 1)
    expect(await banco.logAuditoria.count({ where: { acao: 'anexo_orfao_removido' } })).toBe(0)
  })

  it('remoção que falha não deixa trilha mentindo, e não segura as outras', async () => {
    const travado = await arquivoGravadoHa(8)
    const livre = await arquivoGravadoHa(8)
    const comFalha: ArmazenamentoPort = {
      nome: 'disco-com-falha',
      guardar: (bytes, extensao) => armazenamento.guardar(bytes, extensao),
      ler: (chave) => armazenamento.ler(chave),
      listar: () => armazenamento.listar(),
      remover: async (chave) => {
        if (chave === travado) throw new FalhaDeArmazenamento('remover', 'falha simulada')
        await armazenamento.remover(chave)
      },
    }

    await recusada(expurgar(comFalha), FalhaDeArmazenamento)

    expect(await noDisco()).toEqual([travado])
    const removidos = await banco.logAuditoria.findMany({ where: { acao: 'anexo_orfao_removido' } })
    expect(removidos.map((linha) => linha.entidadeId)).toEqual([livre])
  })
})
