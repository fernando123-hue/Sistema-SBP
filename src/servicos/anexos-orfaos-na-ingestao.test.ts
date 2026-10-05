import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EmailBrutoSchema, type EmailBruto, type Interpretacao } from '../core/esquemas'
import { FalhaDeArmazenamento } from '../ports/armazenamento'
import type { AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo, semearBase } from '../testes/apoio'
import { ArmazenamentoEmMemoria } from '../testes/armazenamento-em-memoria'
import { sincronizar } from './ingestao'

/**
 * Bytes gravados por uma tentativa que NÃO virou linha de `Anexo` saem na
 * hora, com o processo vivo — não esperam a varredura dos 7 dias (`A78`).
 * Revisão técnica do #211, M4. Dados sintéticos.
 */

const banco = obterPrisma()
const PDF = new TextEncoder().encode('%PDF-1.4\nconteudo sintetico\n%%EOF')

beforeEach(async () => {
  await limparTudo(banco)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const INTERPRETACAO: Interpretacao = {
  itens: [
    {
      categoriaCodigo: 'DOC_CADASTRO',
      titulo: 'Documento sintético',
      confianca: 0.99,
      campos: { nome: 'Fulano Sintético' },
      camposAusentes: [],
      ligaMencionada: null,
      observacao: null,
    },
  ],
  conteudoSuspeito: false,
  padroesSuspeitos: [],
  modelo: 'duble',
  versaoPrompt: 'teste',
}

function comDoisAnexos(messageId: string): IngestaoPort {
  const email: EmailBruto = EmailBrutoSchema.parse({
    messageId,
    remetente: 'associado@exemplo.test',
    assunto: 'Documentos',
    corpo: 'Seguem os documentos.',
    recebidoEm: new Date(),
    anexos: [
      { nome: 'primeiro.pdf', tamanho: PDF.byteLength, conteudo: PDF },
      { nome: 'segundo.pdf', tamanho: PDF.byteLength, conteudo: PDF },
    ],
  })
  return { nome: 'teste', buscarNovos: async () => [email] }
}

/** Grava o primeiro arquivo e falha no segundo — disco cheio no meio do e-mail. */
class ArmazenamentoQueEnche extends ArmazenamentoEmMemoria {
  private gravados = 0

  override async guardar(bytes: Uint8Array, extensao = ''): Promise<string> {
    this.gravados += 1
    if (this.gravados === 2) throw new FalhaDeArmazenamento('guardar', 'disco cheio (simulado)')
    return super.guardar(bytes, extensao)
  }
}

describe('a ingestão não deixa arquivo sem linha com o processo vivo', () => {
  it('um guardar que falha no meio do e-mail desfaz o que os outros anexos já gravaram', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const armazenamento = new ArmazenamentoQueEnche()
    const ia: AiPort = { nome: 'duble', interpretar: async () => INTERPRETACAO }

    const resumo = await sincronizar(
      { banco, ingestao: comDoisAnexos('<enche@exemplo.test>'), ia, armazenamento },
      base.operador,
    )

    expect(await armazenamento.listar()).toEqual([])
    // A falha continua sendo a de antes: o e-mail não foi gravado e volta na
    // próxima busca.
    expect(resumo.falhas).toBe(1)
    expect(await banco.email.count({ where: { messageId: '<enche@exemplo.test>' } })).toBe(0)
  })

  it('se não der para conferir as linhas, o desfazer não apaga nada (a varredura decide depois)', async () => {
    // Um arquivo a mais fica para a limpeza diária; um a menos não tem volta.
    // Revisão de segurança do #213, rodada 2, N1.
    const base = await semearBase(banco, { totalDeDias: 1 })
    const armazenamento = new ArmazenamentoQueEnche()
    const ia: AiPort = { nome: 'duble', interpretar: async () => INTERPRETACAO }
    const anexoQueFalha = new Proxy(banco.anexo, {
      get(alvo, propriedade) {
        if (propriedade === 'findMany') return async () => Promise.reject(new Error('banco fora (simulado)'))
        return Reflect.get(alvo, propriedade)
      },
    })
    const bancoSemConferencia = new Proxy(banco, {
      get(alvo, propriedade) {
        return propriedade === 'anexo' ? anexoQueFalha : Reflect.get(alvo, propriedade)
      },
    })

    await sincronizar(
      { banco: bancoSemConferencia, ingestao: comDoisAnexos('<sem-conferencia@exemplo.test>'), ia, armazenamento },
      base.operador,
    )

    expect(await armazenamento.listar()).toHaveLength(1)
  })

  it('commit efetivado e resposta perdida: o desfazer não apaga arquivo que tem linha', async () => {
    // O banco gravou, mas o erro chegou mesmo assim (conexão caiu depois do
    // COMMIT). O `catch` desfaz por crença; sem conferir as linhas, apagaria
    // os documentos que o banco acabou de registrar. Revisão de segurança do
    // #213, S1.
    const base = await semearBase(banco, { totalDeDias: 1 })
    const armazenamento = new ArmazenamentoEmMemoria()
    const ia: AiPort = { nome: 'duble', interpretar: async () => INTERPRETACAO }
    const bancoQuePerdeAResposta = new Proxy(banco, {
      get(alvo, propriedade) {
        if (propriedade !== '$transaction') return Reflect.get(alvo, propriedade)
        return async (...argumentos: unknown[]) => {
          const resultado = await (alvo.$transaction as (...a: unknown[]) => Promise<unknown>)(...argumentos)
          if (typeof argumentos[0] === 'function') throw new Error('conexão caiu depois do commit (simulado)')
          return resultado
        }
      },
    })

    await sincronizar(
      { banco: bancoQuePerdeAResposta, ingestao: comDoisAnexos('<perdida@exemplo.test>'), ia, armazenamento },
      base.operador,
    )

    const linhas = await banco.anexo.findMany({ select: { chaveArmazenamento: true } })
    expect(linhas).toHaveLength(2)
    expect((await armazenamento.listar()).map((arquivo) => arquivo.chave).sort()).toEqual(
      linhas.map((linha) => linha.chaveArmazenamento).sort(),
    )
  })

  it('outra sincronização gravou o mesmo e-mail primeiro: os arquivos desta tentativa saem', async () => {
    // A corrida entre duas sincronizações: a checagem de fora passa, e a de
    // dentro da transação acha o e-mail já processado pela outra. Simulada
    // gravando o e-mail processado enquanto "a IA lê".
    const base = await semearBase(banco, { totalDeDias: 1 })
    const armazenamento = new ArmazenamentoEmMemoria()
    let daOutra = ''
    const ia: AiPort = {
      nome: 'duble',
      interpretar: async () => {
        // A outra sincronização, com o anexo DELA já gravado e com linha.
        daOutra = await armazenamento.guardar(PDF, '.pdf')
        await banco.email.create({
          data: {
            messageId: '<corrida@exemplo.test>',
            recebidoEm: new Date(),
            processadoEm: new Date(),
            anexos: {
              create: {
                nomeSeguro: 'primeiro.pdf',
                tipoDeclarado: 'application/pdf',
                tamanho: PDF.byteLength,
                aceito: true,
                chaveArmazenamento: daOutra,
                armazenadoEm: new Date(),
              },
            },
          },
        })
        return INTERPRETACAO
      },
    }

    const resumo = await sincronizar(
      { banco, ingestao: comDoisAnexos('<corrida@exemplo.test>'), ia, armazenamento },
      base.operador,
    )

    expect(resumo.duplicados).toBe(1)
    // Os dois desta tentativa saíram; o da outra, que tem linha, ficou.
    expect((await armazenamento.listar()).map((arquivo) => arquivo.chave)).toEqual([daOutra])
    expect(await banco.anexo.count()).toBe(1)
  })

  it('e-mail que já existe SEM processadoEm: recusa alto antes da IA, e a trilha diz o que fazer (revisões do #213, S2, e do #224)', async () => {
    // Nada no sistema cria esse estado: a ingestão é a única criadora e sempre
    // preenche `processadoEm`. Antes, o `upsert` caía no ramo `update`, que não
    // cria linha de `Anexo`: o e-mail virava "processado", e os arquivos
    // ficavam sem dono até a varredura.
    const base = await semearBase(banco, { totalDeDias: 1 })
    const armazenamento = new ArmazenamentoEmMemoria()
    let leituras = 0
    const ia: AiPort = {
      nome: 'duble',
      interpretar: async () => {
        leituras += 1
        return INTERPRETACAO
      },
    }
    await banco.email.create({ data: { messageId: '<sem-processado@exemplo.test>', recebidoEm: new Date() } })
    capturarErros()

    const resumo = await sincronizar(
      { banco, ingestao: comDoisAnexos('<sem-processado@exemplo.test>'), ia, armazenamento },
      base.operador,
    )

    expect(resumo.falhas).toBe(1)
    expect(resumo.duplicados).toBe(0)
    // Recusado antes da IA e antes de gravar qualquer arquivo.
    expect(leituras).toBe(0)
    expect(await armazenamento.listar()).toEqual([])
    expect(await banco.anexo.count()).toBe(0)
    const email = await banco.email.findUniqueOrThrow({ where: { messageId: '<sem-processado@exemplo.test>' } })
    expect(email.processadoEm).toBeNull()
    const evento = await banco.eventoProcessamento.findFirstOrThrow({
      where: { etapa: 'ingestao', referencia: '<sem-processado@exemplo.test>' },
    })
    expect(evento.situacao).toBe('reprocessavel')
    expect(evento.mensagem).toMatch(/investigar a linha/)
    expect(evento.mensagem).not.toContain('sem-processado@exemplo.test')
  })

  it('a linha sem processadoEm aparece DURANTE a leitura da IA: a transação recusa e desfaz os arquivos (revisão de segurança do #213, S2)', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const armazenamento = new ArmazenamentoEmMemoria()
    const ia: AiPort = {
      nome: 'duble',
      interpretar: async () => {
        await banco.email.create({ data: { messageId: '<no-meio@exemplo.test>', recebidoEm: new Date() } })
        return INTERPRETACAO
      },
    }
    capturarErros()

    const resumo = await sincronizar(
      { banco, ingestao: comDoisAnexos('<no-meio@exemplo.test>'), ia, armazenamento },
      base.operador,
    )

    expect(resumo.falhas).toBe(1)
    expect(await armazenamento.listar()).toEqual([])
    expect(await banco.anexo.count()).toBe(0)
  })

  it('dois anexos falham: sobe a primeira falha e a segunda é dita no log, com o messageId (revisão técnica do #213)', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const ia: AiPort = { nome: 'duble', interpretar: async () => INTERPRETACAO }
    const armazenamento = new (class extends ArmazenamentoEmMemoria {
      override async guardar(): Promise<string> {
        throw new FalhaDeArmazenamento('guardar', 'disco cheio (simulado)')
      }
    })()
    const erros = capturarErros()

    const resumo = await sincronizar(
      { banco, ingestao: comDoisAnexos('<duas-falhas@exemplo.test>'), ia, armazenamento },
      base.operador,
    )

    expect(resumo.falhas).toBe(1)
    const outra = erros.filter((linha) => linha.includes('outro anexo do mesmo e-mail também falhou'))
    expect(outra).toHaveLength(1)
    expect(outra[0]).toContain('duas-falhas@exemplo.test')
  })
})

/** As linhas de erro que o código escreve no stderr, sem sujar a saída do teste. */
function capturarErros(): string[] {
  const linhas: string[] = []
  vi.spyOn(process.stderr, 'write').mockImplementation((linha) => {
    linhas.push(String(linha))
    return true
  })
  return linhas
}
