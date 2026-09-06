import { beforeEach, describe, expect, it } from 'vitest'

import { CATEGORIAS_CADASTRO, limiarConfiancaSemente } from '../core/config'
import { obterPrisma } from '../servidor/prisma'
import { DATA_BASE, limparTudo, semearBase } from '../testes/apoio'
import { confirmar } from './distribuicao'
import { decidirRevisao } from './ingestao'
import { registrarManual } from './itens'

/**
 * Decisões A11 (peso) e A12 (limiar de confiança) por categoria.
 *
 * As duas vieram da MESMA frase do cliente — "documento e ficha demandam mais
 * atenção" — e cada uma cai num lugar diferente do sistema:
 *
 *   A11 · peso            → equilíbrio ENTRE categorias, via cota justa e o
 *                           livro-razão ponderado
 *   A12 · limiarConfianca → quanto a IA precisa estar segura para aprovar
 *                           sozinha; é o corte ANTES do motor
 *
 * Estes testes existem porque as duas decisões são VALOR DE DADO, não lógica
 * nova: o motor já sabia multiplicar por peso, e a ingestão já lia o limiar da
 * categoria. Um valor de dado que volta ao padrão não quebra nada — ele só
 * passa a distribuir diferente, em silêncio, e ninguém tem onde olhar. É
 * exatamente a forma de perda que este projeto existe para eliminar, então os
 * números decididos pelo dono do negócio ficam presos por teste.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

function categoria(codigo: string) {
  return CATEGORIAS_CADASTRO.find((item) => item.codigo === codigo)!
}

describe('A11 — peso por categoria', () => {
  it('documento e ficha pesam mais; o resto fica na base', () => {
    expect(categoria('DOC_CADASTRO').peso).toBe(4)
    expect(categoria('FICHA_CADASTRO').peso).toBe(1.75)

    for (const codigo of ['EMAIL_CADASTRO', 'LIGA', 'LIGANTE', 'EMAIL_LIGA']) {
      expect(categoria(codigo).peso).toBe(1)
    }
  })

  it('o peso chega ao livro-razão: 3 documentos valem 12 unidades de carga', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 1 })

    await registrarManual(
      banco,
      { categoriaCodigo: 'DOC_CADASTRO', titulo: 'Documento no balcão', quantidade: 3 },
      base.operador,
    )
    await confirmar(banco, { data: DATA_BASE, categorias: ['DOC_CADASTRO'] }, base.operador)

    const saldo = await banco.saldoCarga.findFirstOrThrow({
      where: { categoria: { codigo: 'DOC_CADASTRO' } },
      select: { recebido: true, recebidoPonderado: true },
    })

    // `recebido` responde "quantos itens"; `recebidoPonderado`, "quanta carga".
    // Antes do A11 os dois eram sempre o mesmo número, e a diferença entre as
    // perguntas era invisível.
    expect(saldo.recebido).toBe(3)
    expect(saldo.recebidoPonderado).toBe(12)
  })

  it('a mesma contagem em categoria leve vale menos carga — que é o ponto do A11', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 1 })

    await registrarManual(
      banco,
      { categoriaCodigo: 'EMAIL_CADASTRO', titulo: 'E-mail de cadastro', quantidade: 3 },
      base.operador,
    )
    await confirmar(banco, { data: DATA_BASE, categorias: ['EMAIL_CADASTRO'] }, base.operador)

    const saldo = await banco.saldoCarga.findFirstOrThrow({
      where: { categoria: { codigo: 'EMAIL_CADASTRO' } },
      select: { recebido: true, recebidoPonderado: true },
    })

    expect(saldo.recebido).toBe(3)
    expect(saldo.recebidoPonderado).toBe(3)

    // O efeito que o cliente pediu: três documentos e três e-mails são a mesma
    // CONTAGEM e esforços diferentes. Quem passou o dia em documento aparece
    // como mais carregado no desempate entre categorias, e não recebe também
    // um monte de trabalho leve por cima.
  })
})

describe('A12 — limiar de confiança por categoria', () => {
  it('documento e ficha exigem mais certeza da IA; o resto fica na base', () => {
    expect(limiarConfiancaSemente('DOC_CADASTRO')).toBe(0.95)
    expect(limiarConfiancaSemente('FICHA_CADASTRO')).toBe(0.9)

    for (const codigo of ['EMAIL_CADASTRO', 'LIGA', 'LIGANTE', 'EMAIL_LIGA']) {
      expect(limiarConfiancaSemente(codigo)).toBe(0.85)
    }
  })

  it('categoria sem valor próprio nasce no padrão, nunca indefinida', () => {
    expect(limiarConfiancaSemente('CATEGORIA_QUE_NAO_EXISTE')).toBe(0.85)
  })

  it('a categoria nasce no banco com o limiar decidido', async () => {
    await semearBase(banco, { totalDeDias: 1 })

    const doc = await banco.categoria.findUniqueOrThrow({ where: { codigo: 'DOC_CADASTRO' } })
    const email = await banco.categoria.findUniqueOrThrow({ where: { codigo: 'EMAIL_CADASTRO' } })

    expect(doc.limiarConfianca).toBe(0.95)
    expect(email.limiarConfianca).toBe(0.85)
  })

  it('a MESMA confiança aprova e-mail e manda documento para revisão', () => {
    // 0,92: acima do limiar de e-mail (0,85), abaixo do de documento (0,95).
    // É a faixa inteira que o A12 move para a conferência humana.
    const confianca = 0.92

    const noEmail = decidirRevisao(confianca, limiarConfiancaSemente('EMAIL_CADASTRO'), false, false, false, false)
    const noDocumento = decidirRevisao(confianca, limiarConfiancaSemente('DOC_CADASTRO'), false, false, false, false)

    expect(noEmail).toBeNull()
    expect(noDocumento).toBe('baixa_confianca')
  })
})
