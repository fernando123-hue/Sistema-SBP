import { beforeEach, describe, expect, it } from 'vitest'

import { IaMock } from '../adapters/ia-mock'
import { IngestaoMock } from '../adapters/ingestao-mock'
import { sequenciaDeDatas } from '../core/util/datas'
import { obterPrisma } from '../servidor/prisma'
import { DATA_BASE, limparTudo, semearBase } from '../testes/apoio'
import { confirmar, previa } from './distribuicao'
import { concluir, minhaFila, transferir } from './fila'
import { sincronizar } from './ingestao'
import { conferirConservacao, porCategoria } from './painel'
import { aprovarTodosPendentes, listarPendentes } from './revisao'

/**
 * Testes de integração do pipeline.
 *
 * Prioridade máxima do projeto: DISTRIBUIÇÃO e INTEGRIDADE (entrada == saída).
 * Estes testes rodam contra um banco SQLite real, não contra mocks de banco —
 * constraint, transação e índice único são parte do que está sendo verificado.
 */

const banco = obterPrisma()

function deps(datas: readonly string[], semente = 7, malicioso = false) {
  return {
    banco,
    ingestao: new IngestaoMock({ datas, semente, incluirMalicioso: malicioso }),
    ia: new IaMock(),
  }
}

beforeEach(async () => {
  await limparTudo(banco)
})

describe('conservação de totais — critério de aceitação nº 1', () => {
  it('em 30 dias simulados, Σ distribuído == Σ entrada em 100% das rodadas', async () => {
    const base = await semearBase(banco, { totalDeDias: 30, pessoasDePlantao: 3 })
    const datas = sequenciaDeDatas(DATA_BASE, 30)

    await sincronizar(deps(datas, 31), base.operadorId)
    await aprovarTodosPendentes(banco, base.operadorId)

    for (const data of datas) {
      await confirmar(banco, { data, categorias: [], executadoPor: base.operadorId })
    }

    const conservacao = await conferirConservacao(banco)
    expect(conservacao.rodadas).toBeGreaterThan(0)
    expect(conservacao.divergentes).toEqual([])

    // Nada some: todo item aprovado virou exatamente uma atribuição ativa.
    const aprovadosRestantes = await banco.item.count({ where: { status: 'aprovado' } })
    const distribuidos = await banco.item.count({ where: { status: 'distribuido' } })
    const atribuicoes = await banco.atribuicao.count({ where: { ativa: true } })

    expect(aprovadosRestantes).toBe(0)
    expect(atribuicoes).toBe(distribuidos)
  })

  it('com rateio sempre divisível, |crédito| fica abaixo de 1 unidade', async () => {
    // `limiarIndivisivel = 1` desliga o caminho "lote pequeno vai inteiro para
    // um só". Aí vale o invariante forte do PRD: |crédito| < 1 a todo momento.
    const base = await semearBase(banco, {
      totalDeDias: 20,
      pessoasDePlantao: 3,
      limiarIndivisivel: 1,
    })
    const datas = sequenciaDeDatas(DATA_BASE, 20)

    await sincronizar(deps(datas, 99), base.operadorId)
    await aprovarTodosPendentes(banco, base.operadorId)

    for (const data of datas) {
      await confirmar(banco, { data, categorias: [], executadoPor: base.operadorId })
    }

    const saldos = await banco.saldoCarga.findMany({ select: { creditoAcumulado: true } })
    expect(saldos.length).toBeGreaterThan(0)
    for (const saldo of saldos) {
      expect(Math.abs(saldo.creditoAcumulado)).toBeLessThan(1)
    }
  })

  it('com lote indivisível, o crédito é limitado pelo tamanho do lote e volta a zerar', async () => {
    // Comportamento documentado, não escondido: quando `Q <= limiarIndivisivel`
    // o lote inteiro vai para uma pessoa e o crédito salta até o tamanho do
    // lote. Em troca, ninguém fragmenta trabalho de volume baixo. Ver
    // DECISOES.md § C2 e § AT-01.
    const LIMIAR = 3
    const base = await semearBase(banco, {
      totalDeDias: 20,
      pessoasDePlantao: 3,
      limiarIndivisivel: LIMIAR,
    })
    const datas = sequenciaDeDatas(DATA_BASE, 20)

    await sincronizar(deps(datas, 99), base.operadorId)
    await aprovarTodosPendentes(banco, base.operadorId)

    for (const data of datas) {
      await confirmar(banco, { data, categorias: [], executadoPor: base.operadorId })
    }

    const saldos = await banco.saldoCarga.findMany({ select: { creditoAcumulado: true } })
    for (const saldo of saldos) {
      expect(Math.abs(saldo.creditoAcumulado)).toBeLessThanOrEqual(LIMIAR)
    }

    // O que importa no fim: a carga acumulada por pessoa fica junta.
    const porPessoa = await banco.atribuicao.groupBy({
      by: ['colaboradorId'],
      where: { ativa: true },
      _count: { _all: true },
    })
    const totais = porPessoa.map((linha) => linha._count._all)
    const media = totais.reduce((soma, valor) => soma + valor, 0) / totais.length
    for (const total of totais) {
      // Desvio proporcional pequeno: o rateio não favorece ninguém de forma sistemática.
      expect(Math.abs(total - media)).toBeLessThan(media * 0.25 + LIMIAR)
    }
  })

  it('não distribui itens que ainda não chegaram', async () => {
    const base = await semearBase(banco, { totalDeDias: 5, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 5)

    await sincronizar(deps(datas, 5), base.operadorId)
    await aprovarTodosPendentes(banco, base.operadorId)

    // Distribui só o primeiro dia.
    await confirmar(banco, { data: datas[0]!, categorias: [], executadoPor: base.operadorId })

    const distribuidos = await banco.item.findMany({
      where: { status: 'distribuido' },
      include: { email: { select: { recebidoEm: true } } },
    })

    const limite = new Date(`${datas[0]!}T23:59:59.999Z`)
    for (const item of distribuidos) {
      expect(item.email!.recebidoEm.getTime()).toBeLessThanOrEqual(limite.getTime())
    }
    expect(await banco.item.count({ where: { status: 'aprovado' } })).toBeGreaterThan(0)
  })
})

describe('idempotência', () => {
  it('reprocessar os mesmos e-mails não cria item nenhum a mais', async () => {
    const base = await semearBase(banco, { totalDeDias: 3 })
    const datas = sequenciaDeDatas(DATA_BASE, 3)

    const primeira = await sincronizar(deps(datas), base.operadorId)
    const segunda = await sincronizar(deps(datas), base.operadorId)

    expect(primeira.itensCriados).toBeGreaterThan(0)
    expect(segunda.novos).toBe(0)
    expect(segunda.duplicados).toBe(primeira.recebidos)
    expect(segunda.itensCriados).toBe(0)
    expect(await banco.item.count()).toBe(primeira.itensCriados)
  })
})

describe('desdobramento — um e-mail pode gerar N itens (decisão A1)', () => {
  it('um e-mail com lista de ligantes vira N unidades de carga', async () => {
    const base = await semearBase(banco, { totalDeDias: 3 })
    const datas = sequenciaDeDatas(DATA_BASE, 3)

    const resumo = await sincronizar(deps(datas), base.operadorId)
    expect(resumo.itensCriados).toBeGreaterThan(resumo.recebidos)

    const comMuitosItens = await banco.email.findFirst({
      where: { itens: { some: { sequencia: { gt: 1 } } } },
      include: { itens: true },
    })
    expect(comMuitosItens).not.toBeNull()
    expect(comMuitosItens!.itens.length).toBeGreaterThan(1)
  })
})

describe('segurança — conteúdo não confiável', () => {
  it('e-mail com prompt injection vira item comum e cai na fila de revisão', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)

    await sincronizar(deps(datas, 7, true), base.operadorId)

    const pendentes = await listarPendentes(banco, 500)
    const suspeitos = pendentes.filter((item) => item.motivo === 'conteudo_suspeito')

    expect(suspeitos.length).toBe(1)
    // A instrução do remetente NÃO teve efeito: nada foi distribuído nem aprovado.
    const item = await banco.item.findUniqueOrThrow({ where: { id: suspeitos[0]!.itemId } })
    expect(item.status).toBe('aguardando_revisao')
    expect(item.confianca).toBeLessThan(0.85)
    expect(await banco.atribuicao.count()).toBe(0)
  })

  it('anexo com travessia de diretório é normalizado e registrado', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)

    await sincronizar(deps(datas, 7, true), base.operadorId)

    const email = await banco.email.findFirstOrThrow({
      where: { messageId: { contains: 'injecao' } },
    })
    const anexos = JSON.parse(email.anexos) as { nome: string; aceito: boolean }[]

    expect(anexos[0]!.nome).toBe('passwd.pdf')
    expect(anexos[0]!.nome).not.toContain('..')
  })
})

describe('invariantes de atribuição', () => {
  it('o banco impede dois responsáveis ativos para o mesmo item', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)

    await sincronizar(deps(datas), base.operadorId)
    await aprovarTodosPendentes(banco, base.operadorId)
    await confirmar(banco, { data: datas[0]!, categorias: [], executadoPor: base.operadorId })

    const existente = await banco.atribuicao.findFirstOrThrow({ where: { ativa: true } })

    // Índice único (itemId, ativa) — a garantia é do banco, não do código.
    await expect(
      banco.atribuicao.create({
        data: {
          itemId: existente.itemId,
          colaboradorId: base.colaboradores[1]!.id,
          motivo: 'manual',
          atribuidoPor: base.operadorId,
          ativa: true,
        },
      }),
    ).rejects.toThrow()
  })

  it('ninguém conclui item que não é seu', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)

    await sincronizar(deps(datas), base.operadorId)
    await aprovarTodosPendentes(banco, base.operadorId)
    await confirmar(banco, { data: datas[0]!, categorias: [], executadoPor: base.operadorId })

    const atribuicao = await banco.atribuicao.findFirstOrThrow({ where: { ativa: true } })
    const outro = base.colaboradores.find((pessoa) => pessoa.id !== atribuicao.colaboradorId)!

    await expect(
      concluir(banco, { itemId: atribuicao.itemId, colaboradorId: outro.id }),
    ).rejects.toThrow(/responsável ativo/i)
  })

  it('transferência troca o dono, exige justificativa e não altera a rodada', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)

    await sincronizar(deps(datas), base.operadorId)
    await aprovarTodosPendentes(banco, base.operadorId)
    await confirmar(banco, { data: datas[0]!, categorias: [], executadoPor: base.operadorId })

    const atribuicao = await banco.atribuicao.findFirstOrThrow({ where: { ativa: true } })
    const rodadaAntes = await banco.rodadaDistribuicao.findUniqueOrThrow({
      where: { id: atribuicao.rodadaId! },
    })
    const outro = base.colaboradores.find((pessoa) => pessoa.id !== atribuicao.colaboradorId)!

    await expect(
      transferir(banco, {
        itemId: atribuicao.itemId,
        paraColaboradorId: outro.id,
        justificativa: 'x',
        executadoPor: base.operadorId,
      }),
    ).rejects.toThrow(/justificativa/i)

    await transferir(banco, {
      itemId: atribuicao.itemId,
      paraColaboradorId: outro.id,
      justificativa: 'Colega de férias a partir de amanhã.',
      executadoPor: base.operadorId,
    })

    const ativas = await banco.atribuicao.findMany({
      where: { itemId: atribuicao.itemId, ativa: true },
    })
    expect(ativas).toHaveLength(1)
    expect(ativas[0]!.colaboradorId).toBe(outro.id)
    expect(ativas[0]!.motivo).toBe('transferencia')

    // Histórico imutável: a rodada original continua idêntica.
    const rodadaDepois = await banco.rodadaDistribuicao.findUniqueOrThrow({
      where: { id: atribuicao.rodadaId! },
    })
    expect(rodadaDepois.alocacao).toBe(rodadaAntes.alocacao)
    expect(rodadaDepois.quantidadeEntrada).toBe(rodadaAntes.quantidadeEntrada)

    // E a atribuição anterior virou histórico, não sumiu.
    const encerradas = await banco.atribuicao.count({
      where: { itemId: atribuicao.itemId, ativa: null },
    })
    expect(encerradas).toBe(1)
  })
})

describe('falha explícita em vez de trabalho perdido', () => {
  it('sem ninguém de plantão, o trabalho fica na fila e a rodada não é gravada', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)

    await sincronizar(deps(datas), base.operadorId)
    await aprovarTodosPendentes(banco, base.operadorId)

    // Ninguém disponível — o cenário que na planilha some com 16 itens de LIGA.
    await banco.escala.updateMany({ where: { data: datas[0]! }, data: { disponivel: false } })

    const aprovadosAntes = await banco.item.count({ where: { status: 'aprovado' } })
    const relatorio = await confirmar(banco, {
      data: datas[0]!,
      categorias: [],
      executadoPor: base.operadorId,
    })

    expect(relatorio.rodadasGravadas).toBe(0)
    expect(relatorio.planos.every((plano) => plano.erro !== null)).toBe(true)
    expect(relatorio.planos[0]!.erro).toMatch(/elegível/i)

    // Nada perdido: continua tudo aprovado, esperando plantão.
    expect(await banco.item.count({ where: { status: 'aprovado' } })).toBe(aprovadosAntes)
    expect(await banco.atribuicao.count()).toBe(0)
  })
})

describe('painel derivado', () => {
  it('todo número do painel vem de agregação, e pendente cai ao concluir', async () => {
    const base = await semearBase(banco, { totalDeDias: 2, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 2)

    await sincronizar(deps(datas), base.operadorId)
    await aprovarTodosPendentes(banco, base.operadorId)
    for (const data of datas) {
      await confirmar(banco, { data, categorias: [], executadoPor: base.operadorId })
    }

    const antes = await porCategoria(banco)
    const pendenteAntes = antes.reduce((total, linha) => total + linha.pendente, 0)

    const pessoa = base.colaboradores[0]!
    const fila = await minhaFila(banco, pessoa.id)
    expect(fila.length).toBeGreaterThan(0)

    await concluir(banco, { itemId: fila[0]!.itemId, colaboradorId: pessoa.id })

    const depois = await porCategoria(banco)
    const pendenteDepois = depois.reduce((total, linha) => total + linha.pendente, 0)
    expect(pendenteDepois).toBe(pendenteAntes - 1)
  })

  it('prévia e confirmação produzem a mesma alocação', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 3 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)

    await sincronizar(deps(datas), base.operadorId)
    await aprovarTodosPendentes(banco, base.operadorId)

    const pedido = { data: datas[0]!, categorias: [], executadoPor: base.operadorId }
    const antes = await previa(banco, pedido)
    const depois = await confirmar(banco, pedido)

    const alocacaoDaPrevia = antes.planos.map((plano) => plano.resultado?.alocacao)
    const alocacaoGravada = depois.planos.map((plano) => plano.resultado?.alocacao)

    expect(alocacaoGravada).toEqual(alocacaoDaPrevia)
    // E a prévia realmente não gravou nada por conta própria.
    expect(depois.rodadasGravadas).toBe(antes.planos.filter((plano) => plano.resultado).length)
  })
})
