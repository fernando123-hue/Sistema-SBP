import { novaCorrelacao } from '../servidor/observabilidade'
import type { Banco } from '../servidor/prisma'
import { auditar } from './auditoria'

/**
 * Fila individual e execução.
 *
 * Substitui o `Realizado` digitado por evento com carimbo. Ninguém declara
 * quantidade: o colaborador conclui itens reais, um a um, e o número do painel
 * é consequência.
 *
 * O defeito RN-09 da planilha — quem realiza mais do que recebeu tem o
 * excedente descartado — simplesmente não existe aqui: é impossível concluir um
 * item que não é seu. Ajudar um colega passa por `transferir`, que deixa rastro.
 */

export interface ItemDaFila {
  itemId: string
  titulo: string
  categoriaCodigo: string
  categoriaRotulo: string
  status: string
  remetente: string | null
  assunto: string | null
  recebidoEm: Date | null
  atribuidoEm: Date
}

export async function minhaFila(banco: Banco, colaboradorId: string): Promise<ItemDaFila[]> {
  const atribuicoes = await banco.atribuicao.findMany({
    where: {
      colaboradorId,
      ativa: true,
      item: { status: { in: ['distribuido', 'em_andamento'] } },
    },
    orderBy: { atribuidoEm: 'asc' },
    include: { item: { include: { categoria: true, email: true } } },
  })

  return atribuicoes.map((atribuicao) => ({
    itemId: atribuicao.itemId,
    titulo: atribuicao.item.titulo,
    categoriaCodigo: atribuicao.item.categoria.codigo,
    categoriaRotulo: atribuicao.item.categoria.rotulo,
    status: atribuicao.item.status,
    remetente: atribuicao.item.email?.remetente ?? null,
    assunto: atribuicao.item.email?.assunto ?? null,
    recebidoEm: atribuicao.item.email?.recebidoEm ?? null,
    atribuidoEm: atribuicao.atribuidoEm,
  }))
}

export async function concluir(
  banco: Banco,
  entrada: { itemId: string; colaboradorId: string; observacao?: string },
): Promise<void> {
  const correlacaoId = novaCorrelacao()

  await banco.$transaction(async (tx) => {
    const atribuicao = await tx.atribuicao.findFirst({
      where: { itemId: entrada.itemId, ativa: true },
      include: { item: true },
    })

    if (!atribuicao) throw new Error(`Item "${entrada.itemId}" não tem responsável ativo.`)
    if (atribuicao.colaboradorId !== entrada.colaboradorId) {
      throw new Error('Só o responsável ativo pode concluir o item. Use transferência.')
    }
    if (atribuicao.item.status === 'concluido') return

    await tx.execucao.create({
      data: {
        itemId: entrada.itemId,
        colaboradorId: entrada.colaboradorId,
        concluidoEm: new Date(),
        resultado: 'concluido',
        observacao: entrada.observacao ?? null,
      },
    })

    await tx.item.update({ where: { id: entrada.itemId }, data: { status: 'concluido' } })

    await auditar(tx, {
      entidade: 'Item',
      entidadeId: entrada.itemId,
      acao: 'concluido',
      antes: { status: atribuicao.item.status },
      depois: { status: 'concluido', por: entrada.colaboradorId },
      usuario: entrada.colaboradorId,
      correlacaoId,
    })
  })
}

/**
 * Transferência manual.
 *
 * NÃO altera a rodada original — o histórico é imutável. Encerra a atribuição
 * vigente e cria uma nova com motivo e justificativa. É o que separa as três
 * intenções que hoje moram numa coluna `Mov. Extra` só (RN-06).
 *
 * O crédito NÃO é estornado: quem recebeu na rodada continua tendo recebido.
 * Ver DECISOES.md § AT-07.
 */
export async function transferir(
  banco: Banco,
  entrada: {
    itemId: string
    paraColaboradorId: string
    justificativa: string
    executadoPor: string
    motivo?: 'transferencia' | 'devolucao'
  },
): Promise<void> {
  if (entrada.justificativa.trim().length < 5) {
    throw new Error('Transferência exige justificativa.')
  }

  const correlacaoId = novaCorrelacao()

  await banco.$transaction(async (tx) => {
    const atual = await tx.atribuicao.findFirst({
      where: { itemId: entrada.itemId, ativa: true },
    })
    if (!atual) throw new Error(`Item "${entrada.itemId}" não tem responsável ativo.`)
    if (atual.colaboradorId === entrada.paraColaboradorId) return

    // `ativa: null` libera o índice único `(itemId, ativa)` para a nova
    // atribuição — a garantia de responsável único é do banco, não do código.
    await tx.atribuicao.update({
      where: { id: atual.id },
      data: { ativa: null, encerradoEm: new Date() },
    })

    await tx.atribuicao.create({
      data: {
        itemId: entrada.itemId,
        colaboradorId: entrada.paraColaboradorId,
        rodadaId: atual.rodadaId,
        motivo: entrada.motivo ?? 'transferencia',
        justificativa: entrada.justificativa,
        atribuidoPor: entrada.executadoPor,
        ativa: true,
      },
    })

    await auditar(tx, {
      entidade: 'Atribuicao',
      entidadeId: entrada.itemId,
      acao: entrada.motivo ?? 'transferencia',
      antes: { colaboradorId: atual.colaboradorId },
      depois: { colaboradorId: entrada.paraColaboradorId, justificativa: entrada.justificativa },
      usuario: entrada.executadoPor,
      correlacaoId,
    })
  })
}
