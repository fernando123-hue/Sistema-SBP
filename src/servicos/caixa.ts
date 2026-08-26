import { StatusItemSchema } from '../core/esquemas'
import type { Banco } from '../servidor/prisma'

/**
 * Caixa de entrada.
 *
 * A tela que substitui a coluna de contagem: em vez de "e-mail: 47", a lista
 * dos 47 itens reais, com remetente, assunto e o grau de confiança da IA.
 */

export interface ItemDaCaixa {
  itemId: string
  titulo: string
  categoriaCodigo: string
  categoriaRotulo: string
  grupo: string
  status: string
  confianca: number
  remetente: string | null
  assunto: string | null
  recebidoEm: Date | null
  /** Quantos itens o mesmo e-mail gerou. Mostra o desdobramento na tela. */
  irmaos: number
  responsavel: string | null
}

export interface FiltroDaCaixa {
  status?: string | undefined
  categoriaCodigo?: string | undefined
  limite?: number | undefined
}

export async function listarCaixa(
  banco: Banco,
  filtro: FiltroDaCaixa = {},
): Promise<ItemDaCaixa[]> {
  const status = filtro.status ? StatusItemSchema.parse(filtro.status) : undefined
  const limite = Math.min(Math.max(filtro.limite ?? 100, 1), 500)

  const itens = await banco.item.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(filtro.categoriaCodigo ? { categoria: { codigo: filtro.categoriaCodigo } } : {}),
    },
    orderBy: [{ criadoEm: 'desc' }, { sequencia: 'asc' }],
    take: limite,
    include: {
      categoria: { select: { codigo: true, rotulo: true, grupo: true } },
      email: { select: { remetente: true, assunto: true, recebidoEm: true, _count: { select: { itens: true } } } },
      atribuicoes: {
        where: { ativa: true },
        select: { colaborador: { select: { nome: true } } },
      },
    },
  })

  return itens.map((item) => ({
    itemId: item.id,
    titulo: item.titulo,
    categoriaCodigo: item.categoria.codigo,
    categoriaRotulo: item.categoria.rotulo,
    grupo: item.categoria.grupo,
    status: item.status,
    confianca: item.confianca,
    remetente: item.email?.remetente ?? null,
    assunto: item.email?.assunto ?? null,
    recebidoEm: item.email?.recebidoEm ?? null,
    irmaos: item.email?._count.itens ?? 1,
    responsavel: item.atribuicoes[0]?.colaborador.nome ?? null,
  }))
}

export interface ResumoDaCaixa {
  total: number
  porStatus: Record<string, number>
  porCategoria: { codigo: string; rotulo: string; grupo: string; total: number }[]
}

export async function resumirCaixa(banco: Banco): Promise<ResumoDaCaixa> {
  const [porStatus, porCategoria, categorias] = await Promise.all([
    banco.item.groupBy({ by: ['status'], _count: { _all: true } }),
    banco.item.groupBy({ by: ['categoriaId'], _count: { _all: true } }),
    banco.categoria.findMany({ select: { id: true, codigo: true, rotulo: true, grupo: true } }),
  ])

  return {
    total: porStatus.reduce((soma, linha) => soma + linha._count._all, 0),
    porStatus: Object.fromEntries(porStatus.map((linha) => [linha.status, linha._count._all])),
    porCategoria: categorias
      .map((categoria) => ({
        codigo: categoria.codigo,
        rotulo: categoria.rotulo,
        grupo: categoria.grupo,
        total: porCategoria.find((linha) => linha.categoriaId === categoria.id)?._count._all ?? 0,
      }))
      .filter((linha) => linha.total > 0),
  }
}

/**
 * Auditoria de uma rodada: tudo que é preciso para responder
 * "por que essa pessoa recebeu essa quantidade?".
 */
export async function detalharRodada(banco: Banco, rodadaId: string) {
  const rodada = await banco.rodadaDistribuicao.findUnique({
    where: { id: rodadaId },
    include: {
      categoria: { select: { codigo: true, rotulo: true } },
      atribuicoes: {
        include: {
          colaborador: { select: { id: true, nome: true } },
          item: { select: { id: true, titulo: true, status: true } },
        },
      },
    },
  })

  if (!rodada) return null

  const nomes = new Map(rodada.atribuicoes.map((a) => [a.colaborador.id, a.colaborador.nome]))

  return {
    id: rodada.id,
    data: rodada.data,
    categoria: rodada.categoria,
    quantidadeEntrada: rodada.quantidadeEntrada,
    algoritmoVersao: rodada.algoritmoVersao,
    criterio: rodada.criterio,
    base: rodada.base,
    resto: rodada.resto,
    cotaJusta: rodada.cotaJusta,
    executadoEm: rodada.executadoEm,
    executadoPor: rodada.executadoPor,
    correlacaoId: rodada.correlacaoId,
    elegiveis: JSON.parse(rodada.elegiveis) as Record<string, unknown>[],
    ordemDesempate: (JSON.parse(rodada.ordemDesempate) as string[]).map((id) => ({
      colaboradorId: id,
      nome: nomes.get(id) ?? id,
    })),
    alocacao: JSON.parse(rodada.alocacao) as Record<string, number>,
    creditoAntes: JSON.parse(rodada.creditoAntes) as Record<string, number>,
    creditoDepois: JSON.parse(rodada.creditoDepois) as Record<string, number>,
    itens: rodada.atribuicoes.map((atribuicao) => ({
      itemId: atribuicao.item.id,
      titulo: atribuicao.item.titulo,
      status: atribuicao.item.status,
      responsavel: atribuicao.colaborador.nome,
    })),
  }
}
