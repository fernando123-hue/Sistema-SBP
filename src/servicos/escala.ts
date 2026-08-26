import { DataIsoSchema, EscalaEntradaSchema } from '../core/esquemas'
import { fimDoDia, inicioDoDia } from '../core/util/datas'
import { exigirPapel, type Ator } from '../servidor/ator'
import { novaCorrelacao } from '../servidor/observabilidade'
import type { Banco } from '../servidor/prisma'
import { auditar } from './auditoria'

/**
 * Escala do dia.
 *
 * Substitui a coluna `J` da planilha, que dizia QUANTOS e nunca QUEM. Aqui,
 * trocar o plantão é marcar uma caixa — não editar fórmula em 6 blocos de
 * colunas, que é a fragilidade estrutural nº 1 do arquivo atual (RN-02).
 */

export interface LinhaDaEscala {
  colaboradorId: string
  nome: string
  papel: string
  disponivel: boolean
  capacidadeRelativa: number
  /** Categorias em que a pessoa está habilitada nesta data. */
  categorias: string[]
}

export async function obterEscala(banco: Banco, data: string): Promise<LinhaDaEscala[]> {
  DataIsoSchema.parse(data)

  const colaboradores = await banco.colaborador.findMany({
    where: { ativo: true, habilitacoes: { some: { podeReceber: true } } },
    orderBy: { nome: 'asc' },
    include: {
      habilitacoes: {
        where: {
          podeReceber: true,
          vigenciaInicio: { lte: fimDoDia(data) },
          OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: inicioDoDia(data) } }],
        },
        include: { categoria: { select: { codigo: true } } },
      },
      escalas: { where: { data } },
    },
  })

  return colaboradores.map((colaborador) => {
    const escala = colaborador.escalas[0]
    return {
      colaboradorId: colaborador.id,
      nome: colaborador.nome,
      papel: colaborador.papel,
      // Sem registro para o dia, a pessoa NÃO entra no rateio. O padrão é
      // conservador de propósito: distribuir para quem não está trabalhando é
      // exatamente o defeito que a planilha corrige à mão com `Mov. Extra`.
      disponivel: escala?.disponivel ?? false,
      capacidadeRelativa: escala?.capacidadeRelativa ?? 1,
      categorias: colaborador.habilitacoes.map((habilitacao) => habilitacao.categoria.codigo),
    }
  })
}

export async function definirEscala(
  banco: Banco,
  entrada: unknown,
  ator: Ator,
): Promise<LinhaDaEscala[]> {
  exigirPapel(ator, 'definir escala', 'operador', 'gestor')

  const dados = EscalaEntradaSchema.parse(entrada)
  const correlacaoId = novaCorrelacao()

  await banco.$transaction(async (tx) => {
    const anterior = await tx.escala.findUnique({
      where: { data_colaboradorId: { data: dados.data, colaboradorId: dados.colaboradorId } },
    })

    await tx.escala.upsert({
      where: { data_colaboradorId: { data: dados.data, colaboradorId: dados.colaboradorId } },
      create: {
        data: dados.data,
        colaboradorId: dados.colaboradorId,
        disponivel: dados.disponivel,
        capacidadeRelativa: dados.capacidadeRelativa,
        observacao: dados.observacao,
      },
      update: {
        disponivel: dados.disponivel,
        capacidadeRelativa: dados.capacidadeRelativa,
        observacao: dados.observacao,
      },
    })

    await auditar(tx, {
      entidade: 'Escala',
      entidadeId: `${dados.data}:${dados.colaboradorId}`,
      acao: 'escala_definida',
      antes: anterior ? { disponivel: anterior.disponivel } : undefined,
      depois: { disponivel: dados.disponivel },
      usuario: ator.colaboradorId,
      correlacaoId,
    })
  })

  return obterEscala(banco, dados.data)
}
