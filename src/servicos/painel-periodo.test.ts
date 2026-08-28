import { beforeEach, describe, expect, it } from 'vitest'

import { obterPrisma } from '../servidor/prisma'
import { atorDeTeste, limparTudo, semearBase } from '../testes/apoio'
import { conferirPendencia, periodoPadrao, porCategoria } from './painel'

/**
 * Painel com recorte de período.
 *
 * O painel contava desde a fundação do sistema e chamava isso de "pendente".
 * Na rodada de comparação com a planilha — que tem uma aba por mês — os dois
 * números nunca iriam bater, e a conclusão natural de quem olha é que o
 * substituto está errado.
 *
 * O que se verifica aqui é o MAPEAMENTO: cada coluna do painel tem de
 * corresponder a uma coluna da planilha, e a pendência tem de fechar contada
 * de duas maneiras independentes.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

/** Cria um item numa data específica, para montar histórico. */
async function itemEm(categoriaCodigo: string, criadoEm: string, status = 'aprovado') {
  const categoria = await banco.categoria.findUniqueOrThrow({ where: { codigo: categoriaCodigo } })
  return banco.item.create({
    data: {
      categoriaId: categoria.id,
      titulo: `item de ${criadoEm}`,
      status,
      criadoEm: new Date(`${criadoEm}T12:00:00.000Z`),
    },
  })
}

async function concluirEm(itemId: string, colaboradorId: string, quando: string) {
  await banco.execucao.create({
    data: {
      itemId,
      colaboradorId,
      resultado: 'concluido',
      concluidoEm: new Date(`${quando}T12:00:00.000Z`),
    },
  })
  await banco.item.update({ where: { id: itemId }, data: { status: 'concluido' } })
}

async function cancelarEm(itemId: string, quando: string) {
  await banco.item.update({
    where: { id: itemId },
    data: { status: 'cancelado', canceladoEm: new Date(`${quando}T12:00:00.000Z`) },
  })
}

function linhaDe(linhas: Awaited<ReturnType<typeof porCategoria>>, codigo: string) {
  return linhas.find((linha) => linha.categoriaCodigo === codigo)!
}

describe('o que entrou antes do período vira saldo inicial', () => {
  it('separa saldo de entrada, como as colunas da planilha', async () => {
    await semearBase(banco, { totalDeDias: 1 })

    await itemEm('LIGANTE', '2026-05-20')
    await itemEm('LIGANTE', '2026-05-21')
    await itemEm('LIGANTE', '2026-06-03')

    const junho = await porCategoria(banco, { de: '2026-06-01', ate: '2026-06-30' })
    const linha = linhaDe(junho, 'LIGANTE')

    // `Saldo` da planilha: o que atravessou a virada do mês.
    expect(linha.saldoInicial).toBe(2)
    // `Mov. do Dia` + `Mov. Extra`.
    expect(linha.entrouNoPeriodo).toBe(1)
    // `ABERTO = Saldo + Mov. do Dia + Mov. Extra`.
    expect(linha.aberto).toBe(3)
    expect(linha.pendente).toBe(3)
  })

  it('o que já tinha fechado antes NÃO entra no saldo', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!

    const antigo = await itemEm('LIGANTE', '2026-05-10')
    await concluirEm(antigo.id, pessoa.id, '2026-05-12')
    await itemEm('LIGANTE', '2026-05-20')

    const junho = await porCategoria(banco, { de: '2026-06-01', ate: '2026-06-30' })

    // Contar item já concluído como saldo faria a pendência nunca zerar — o
    // sistema acumularia dívida imaginária mês a mês.
    expect(linhaDe(junho, 'LIGANTE').saldoInicial).toBe(1)
  })
})

describe('conclusão conta no período em que aconteceu', () => {
  it('item de maio concluído em junho aparece no Realizado de junho', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!

    const item = await itemEm('LIGANTE', '2026-05-20')
    await concluirEm(item.id, pessoa.id, '2026-06-05')

    const junho = await porCategoria(banco, { de: '2026-06-01', ate: '2026-06-30' })
    const linha = linhaDe(junho, 'LIGANTE')

    // É o caso de limpeza de backlog: entrou antes, fechou agora. Na planilha,
    // é onde `Realizado` passa de `Aberto` e o grampo em zero come o excedente.
    expect(linha.saldoInicial).toBe(1)
    expect(linha.entrouNoPeriodo).toBe(0)
    expect(linha.concluidoNoPeriodo).toBe(1)
    expect(linha.pendente).toBe(0)
  })

  it('conclusão fora da janela não conta na janela', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!

    const item = await itemEm('LIGANTE', '2026-06-02')
    await concluirEm(item.id, pessoa.id, '2026-07-01')

    const junho = await porCategoria(banco, { de: '2026-06-01', ate: '2026-06-30' })
    const linha = linhaDe(junho, 'LIGANTE')

    expect(linha.concluidoNoPeriodo).toBe(0)
    expect(linha.pendente).toBe(1)
  })
})

describe('cancelamento tem carimbo próprio', () => {
  it('cancelar hoje não muda a pendência do mês passado', async () => {
    await semearBase(banco, { totalDeDias: 1 })

    const item = await itemEm('LIGANTE', '2026-06-10')
    const antesDoCancelamento = await porCategoria(banco, { de: '2026-06-01', ate: '2026-06-30' })

    await cancelarEm(item.id, '2026-07-15')

    const depoisDoCancelamento = await porCategoria(banco, { de: '2026-06-01', ate: '2026-06-30' })

    // Sem `canceladoEm`, o filtro seria pelo status atual e junho passaria a
    // ter um item a menos DEPOIS de junho ter acabado: o painel mudaria de
    // número sozinho entre duas consultas, e a comparação com a planilha
    // deixaria de significar coisa alguma.
    expect(linhaDe(antesDoCancelamento, 'LIGANTE').pendente).toBe(1)
    expect(linhaDe(depoisDoCancelamento, 'LIGANTE').pendente).toBe(1)

    const julho = await porCategoria(banco, { de: '2026-07-01', ate: '2026-07-31' })
    expect(linhaDe(julho, 'LIGANTE').canceladoNoPeriodo).toBe(1)
    expect(linhaDe(julho, 'LIGANTE').pendente).toBe(0)
  })
})

describe('as duas formas de contar pendência batem', () => {
  it('subtração e contagem direta dão o mesmo número, sempre', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!

    // Um pouco de tudo: entrada antes, entrada dentro, conclusão dentro,
    // conclusão fora, cancelamento dentro.
    const a = await itemEm('LIGANTE', '2026-05-15')
    const b = await itemEm('LIGANTE', '2026-06-02')
    const c = await itemEm('LIGANTE', '2026-06-08')
    await itemEm('LIGA', '2026-06-09')
    const e = await itemEm('LIGA', '2026-05-30')

    await concluirEm(a.id, pessoa.id, '2026-06-04')
    await concluirEm(b.id, pessoa.id, '2026-07-02')
    await cancelarEm(c.id, '2026-06-20')
    await concluirEm(e.id, pessoa.id, '2026-06-11')

    const conferencia = await conferirPendencia(banco, { de: '2026-06-01', ate: '2026-06-30' })

    // Este é o invariante do painel: `pendente` sai de uma subtração, e a
    // contagem direta de "quantos estavam abertos no fim" tem de concordar.
    // Divergência aqui é defeito do painel, nunca erro de operação — é
    // exatamente por não fechar que a planilha precisa grampear em zero.
    for (const linha of conferencia) {
      expect(linha.porSubtracao).toBe(linha.porContagem)
    }
  })

  it('a pendência nunca fica negativa, mesmo limpando backlog inteiro', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!

    // Cinco itens velhos, todos fechados no mesmo período, e nada entrando.
    for (const dia of ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05']) {
      const item = await itemEm('LIGANTE', dia)
      await concluirEm(item.id, pessoa.id, '2026-06-10')
    }

    const junho = await porCategoria(banco, { de: '2026-06-01', ate: '2026-06-30' })
    const linha = linhaDe(junho, 'LIGANTE')

    // Na planilha este é o dia em que `Aberto − Realizado` fica negativo e o
    // `IF(...,"0",...)` descarta o excedente (`RN-09`). Aqui a conta fecha em
    // zero sozinha, porque só entra em `concluidoNoPeriodo` o que estava em
    // `aberto`. Não há excedente para descartar.
    expect(linha.saldoInicial).toBe(5)
    expect(linha.concluidoNoPeriodo).toBe(5)
    expect(linha.pendente).toBe(0)
  })
})

describe('período padrão', () => {
  it('é o mês corrente, que é a unidade da planilha', async () => {
    const periodo = periodoPadrao()
    expect(periodo.de).toMatch(/^\d{4}-\d{2}-01$/)
    expect(periodo.ate >= periodo.de).toBe(true)
    expect(periodo.de.slice(0, 7)).toBe(periodo.ate.slice(0, 7))
  })

  it('atores de teste continuam válidos', () => {
    // Guarda contra o helper mudar de forma e os testes acima calarem.
    expect(atorDeTeste('x', 'gestor').papel).toBe('gestor')
  })
})
