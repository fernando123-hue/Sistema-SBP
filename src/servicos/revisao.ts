import { ResolucaoRevisaoSchema, serializar } from '../core/esquemas'
import { exigirPapel, type Ator } from '../servidor/ator'
import { novaCorrelacao } from '../servidor/observabilidade'
import type { Banco, Transacao } from '../servidor/prisma'
import { auditar } from './auditoria'

/**
 * `Revisao.resolvidoPor` é chave estrangeira para `Colaborador` — quem resolve
 * uma exceção é uma pessoa identificada, não uma string livre. A verificação
 * aqui existe só para trocar o erro cru de FK por uma mensagem que diz o que
 * está errado.
 */
async function exigirColaborador(tx: Transacao, colaboradorId: string): Promise<void> {
  const existe = await tx.colaborador.findUnique({
    where: { id: colaboradorId },
    select: { id: true },
  })
  if (!existe) {
    throw new Error(
      `Colaborador "${colaboradorId}" não existe. A resolução de revisão precisa de um usuário real.`,
    )
  }
}

/**
 * Fila de exceções da IA — e dataset de melhoria contínua.
 *
 * O operador não recomeça a análise do zero: ele parte da sugestão do modelo,
 * corrige o que estiver errado e aprova. A diferença entre `sugestaoIa` e
 * `valorFinal` é exatamente a medida de acerto do modelo, e é ela que autoriza
 * (ou não) afrouxar o limiar de confiança depois.
 */

export interface ItemEmRevisao {
  revisaoId: string
  itemId: string
  motivo: string
  confianca: number
  campoIncerto: string | null
  titulo: string
  categoriaCodigo: string
  remetente: string | null
  assunto: string | null
  sugestaoIa: string
}

export async function listarPendentes(banco: Banco, limite = 100): Promise<ItemEmRevisao[]> {
  const registros = await banco.revisao.findMany({
    where: { resolvidoEm: null },
    orderBy: [{ confianca: 'asc' }, { criadoEm: 'asc' }],
    take: limite,
    include: {
      item: { include: { categoria: { select: { codigo: true } }, email: true } },
    },
  })

  return registros.map((registro) => ({
    revisaoId: registro.id,
    itemId: registro.itemId,
    motivo: registro.motivo,
    confianca: registro.confianca,
    campoIncerto: registro.campoIncerto,
    titulo: registro.item.titulo,
    categoriaCodigo: registro.item.categoria.codigo,
    remetente: registro.item.email?.remetente ?? null,
    assunto: registro.item.email?.assunto ?? null,
    sugestaoIa: registro.sugestaoIa,
  }))
}

export async function resolver(
  banco: Banco,
  entrada: unknown,
  ator: Ator,
): Promise<{ itemId: string }> {
  exigirPapel(ator, 'resolver revisão', 'operador', 'gestor')
  const dados = ResolucaoRevisaoSchema.parse(entrada)
  const correlacaoId = novaCorrelacao()

  return banco.$transaction(async (tx) => {
    const revisao = await tx.revisao.findUnique({
      where: { id: dados.revisaoId },
      include: { item: true },
    })

    if (!revisao) throw new Error(`Revisão "${dados.revisaoId}" não encontrada.`)
    if (revisao.resolvidoEm) throw new Error(`Revisão "${dados.revisaoId}" já foi resolvida.`)

    await exigirColaborador(tx, ator.colaboradorId)

    const categoria = await tx.categoria.findUnique({
      where: { codigo: dados.categoriaCodigo },
      select: { id: true },
    })
    if (!categoria) throw new Error(`Categoria "${dados.categoriaCodigo}" não existe.`)

    const antes = {
      categoriaId: revisao.item.categoriaId,
      titulo: revisao.item.titulo,
      status: revisao.item.status,
    }

    const item = await tx.item.update({
      where: { id: revisao.itemId },
      data: {
        categoriaId: categoria.id,
        titulo: dados.titulo,
        payload: serializar({ campos: dados.campos, revisadoPorHumano: true }),
        // Aprovado por humano entra na próxima rodada. Recusado sai da fila
        // sem sumir do banco — cancelado é estado, não exclusão.
        status: dados.aprovar ? 'aprovado' : 'cancelado',
      },
    })

    await tx.revisao.update({
      where: { id: dados.revisaoId },
      data: {
        valorFinal: serializar({
          categoriaCodigo: dados.categoriaCodigo,
          titulo: dados.titulo,
          campos: dados.campos,
          aprovado: dados.aprovar,
        }),
        resolvidoPor: ator.colaboradorId,
        resolvidoEm: new Date(),
      },
    })

    await auditar(tx, {
      entidade: 'Item',
      entidadeId: item.id,
      acao: dados.aprovar ? 'revisao_aprovada' : 'revisao_recusada',
      antes,
      depois: { categoriaId: categoria.id, titulo: item.titulo, status: item.status },
      usuario: ator.colaboradorId,
      correlacaoId,
    })

    return { itemId: item.id }
  })
}

/**
 * Aprovação em massa dos itens que a IA já classificou com confiança suficiente.
 * Existe para a simulação e para o modo "confio no modelo nesta categoria".
 */
export async function aprovarTodosPendentes(
  banco: Banco,
  ator: Ator,
): Promise<{ aprovados: number }> {
  exigirPapel(ator, 'aprovar revisões em massa', 'operador', 'gestor')
  const usuario = ator.colaboradorId
  const correlacaoId = novaCorrelacao()

  return banco.$transaction(async (tx) => {
    await exigirColaborador(tx, usuario)

    const pendentes = await tx.revisao.findMany({
      where: { resolvidoEm: null },
      select: { id: true, itemId: true },
    })

    for (const pendente of pendentes) {
      await tx.item.update({ where: { id: pendente.itemId }, data: { status: 'aprovado' } })
      await tx.revisao.update({
        where: { id: pendente.id },
        data: {
          valorFinal: serializar({ aprovado: true, origem: 'aprovacao_em_massa' }),
          resolvidoPor: usuario,
          resolvidoEm: new Date(),
        },
      })
      await auditar(tx, {
        entidade: 'Item',
        entidadeId: pendente.itemId,
        acao: 'revisao_aprovada_em_massa',
        depois: { status: 'aprovado' },
        usuario,
        correlacaoId,
      })
    }

    return { aprovados: pendentes.length }
  })
}
