import { mkdtemp, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ArmazenamentoEmDisco } from '../adapters/armazenamento-disco'
import { FalhaDeArmazenamento, type ArmazenamentoPort } from '../ports/armazenamento'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo, semearBase } from '../testes/apoio'
import { recusada } from '../testes/recusa'
import {
  LIMITE_DE_ORFAOS_POR_EXECUCAO,
  LimpezaDeOrfaosRecusadaError,
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
    await anexoNoBanco(await arquivoGravadoHa(400))
    const orfao = await arquivoGravadoHa(8)

    const resultado = await expurgar()

    expect(resultado).toEqual({ avaliados: 2, semRegistro: 1, removidos: 1 })
    expect(await noDisco()).not.toContain(orfao)
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
    await anexoNoBanco(await arquivoGravadoHa(400))
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

    await anexoNoBanco(await arquivoGravadoHa(400))
    for (let i = 0; i <= LIMITE_DE_ORFAOS_POR_EXECUCAO; i += 1) await arquivoGravadoHa(8)

    await recusada(expurgar(), LimpezaDeOrfaosRecusadaError, /limite/)

    expect(await noDisco()).toHaveLength(LIMITE_DE_ORFAOS_POR_EXECUCAO + 2)
    expect(await banco.logAuditoria.count({ where: { acao: 'anexo_orfao_removido' } })).toBe(0)
  })
})

describe('uma pessoa aceita o número que viu (revisão técnica do #211, M2)', () => {
  // Sem saída, a recusa se repetiria todo dia para sempre. A saída é uma
  // pessoa conferir e repetir o número EXATO; outro número não serve.
  it('com o número exato, os órfãos saem mesmo sem nenhum arquivo com dono, e a trilha diz que foi aceito', async () => {
    for (let i = 0; i < 3; i += 1) await arquivoGravadoHa(8)

    const resultado = await expurgarAnexosOrfaos(banco, { diasDeRetencao: 7, armazenamento, aceitarOrfaos: 3 })

    expect(resultado.removidos).toBe(3)
    const linha = await banco.logAuditoria.findFirstOrThrow({ where: { acao: 'anexo_orfao_removido' } })
    expect(JSON.parse(linha.depois!)).toMatchObject({ aceitoNaLinhaDeComando: 3 })
  })

  it('número diferente do encontrado: nada sai', async () => {
    for (let i = 0; i < 3; i += 1) await arquivoGravadoHa(8)

    await recusada(
      expurgarAnexosOrfaos(banco, { diasDeRetencao: 7, armazenamento, aceitarOrfaos: 2 }),
      LimpezaDeOrfaosRecusadaError,
      /3/,
    )

    expect(await noDisco()).toHaveLength(3)
  })

  it('nenhum arquivo do disco tem registro: é banco errado ou vazio, e nada sai', async () => {
    // Menos de 50, então o limite sozinho não pegaria: com o banco vazio e
    // três documentos vencidos, os três sumiriam. Revisão técnica do #211 (M1).
    for (let i = 0; i < 3; i += 1) await arquivoGravadoHa(8)

    await recusada(expurgar(), LimpezaDeOrfaosRecusadaError, /nenhum arquivo/i)

    expect(await noDisco()).toHaveLength(3)
  })

  it('com um arquivo que tem dono, o órfão ao lado sai', async () => {
    await anexoNoBanco(await arquivoGravadoHa(400))
    await arquivoGravadoHa(8)

    expect(await expurgar()).toEqual({ avaliados: 2, semRegistro: 1, removidos: 1 })
  })

  it('remoção feita e transação que aborta depois: o log diz que o arquivo SAIU sem trilha', async () => {
    // A trilha e a remoção correm juntas, mas o disco não volta atrás. Se o
    // commit falha depois de o arquivo sair, o log não pode dizer "continua
    // guardado" — é o contrário. Revisão técnica do #211 (M3).
    const orfao = await arquivoGravadoHa(8)
    await anexoNoBanco(await arquivoGravadoHa(400))
    const bancoQueAborta = new Proxy(banco, {
      get(alvo, propriedade) {
        if (propriedade !== '$transaction') return Reflect.get(alvo, propriedade)
        return (executar: (tx: unknown) => Promise<unknown>) =>
          alvo.$transaction(async (tx) => {
            await executar(tx)
            throw new Error('commit simulado')
          })
      },
    })
    const linhas: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((linha) => {
      linhas.push(String(linha))
      return true
    })

    await recusada(
      expurgarAnexosOrfaos(bancoQueAborta, { diasDeRetencao: 7, armazenamento }),
      FalhaDeArmazenamento,
    )

    expect(await noDisco()).not.toContain(orfao)
    expect(await banco.logAuditoria.count({ where: { acao: 'anexo_orfao_removido' } })).toBe(0)
    const registro = linhas.find((linha) => linha.includes(orfao))
    expect(registro).toMatch(/apagado sem linha na trilha/)
  })

  it('remoção que falha não deixa trilha mentindo, e não segura as outras', async () => {
    const comDono = await arquivoGravadoHa(400)
    await anexoNoBanco(comDono)
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

    expect(await noDisco()).toEqual([comDono, travado].sort())
    const removidos = await banco.logAuditoria.findMany({ where: { acao: 'anexo_orfao_removido' } })
    expect(removidos.map((linha) => linha.entidadeId)).toEqual([livre])
  })
})
