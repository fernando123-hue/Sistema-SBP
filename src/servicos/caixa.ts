import {
  BuscaPorChaveSchema,
  MENSAGEM_BUSCA_NAO_RECONHECIDA,
  MENSAGEM_CPF_NAO_CONFERE,
  interpretarBusca,
} from '../core/busca-por-chave'
import { ErroDeNegocio } from '../core/erros'
import { StatusItemSchema } from '../core/esquemas'
import type { ItemDaCaixa } from '../core/tipos'
import type { Ator } from '../servidor/ator'
import { protegerCpf } from '../servidor/cpf-protegido'
import type { Banco } from '../servidor/prisma'
import { contarBusca } from './contagem-de-buscas'

export type { ItemDaCaixa }

/**
 * Caixa de entrada.
 *
 * A tela que substitui a coluna de contagem: em vez de "e-mail: 47", a lista
 * dos 47 itens reais, com remetente, assunto e o grau de confiança da IA.
 */

/**
 * O que cada cargo enxerga da caixa (`A24`).
 *
 * Colaborador vê só os itens em que é o RESPONSÁVEL ATIVO. Operador e gestor
 * veem tudo — são eles que equilibram a carga e precisam do quadro inteiro.
 *
 * ═══ POR QUE AQUI, E NÃO NA ROTA ═══
 *
 * `A24` diz que a restrição é do servidor, porque esconder na tela deixaria o
 * dado na resposta HTTP. Dentro do servidor, ela mora no SERVIÇO pelo mesmo
 * motivo de `minhaFila`: a próxima porta que precisar da caixa — outra rota,
 * um relatório, um agente — passa por esta função, não pelo arquivo da rota.
 * Guarda que vive só na rota é guarda que a segunda porta não tem.
 *
 * ═══ ITEM SEM DONO TAMBÉM NÃO APARECE ═══
 *
 * Item aprovado e ainda não distribuído é trabalho do setor, de ninguém. Para
 * o colaborador ele não é "o próprio trabalho", e mostrá-lo devolveria pela
 * janela o que a porta fechou: remetente e assunto de associado que não tem
 * relação com o que essa pessoa faz hoje.
 *
 * Quem ajuda num item (`A18`) ainda NÃO entra aqui: a ajuda é da fase 3, e o
 * modelo que a sustenta não existe. Quando existir, é este filtro que ganha o
 * segundo caminho — em um lugar só.
 */
export function recorteDaCaixa(ator: Ator): { atribuicoes?: { some: { colaboradorId: string; ativa: true } } } {
  if (ator.papel !== 'colaborador') return {}
  return { atribuicoes: { some: { colaboradorId: ator.colaboradorId, ativa: true } } }
}

export interface FiltroDaCaixa {
  status?: string | undefined
  categoriaCodigo?: string | undefined
  ligaId?: string | undefined
  /** Código de `protegerCpf`. Só `buscarPorChave` preenche. */
  cpfProtegido?: string | undefined
  matricula?: string | undefined
  limite?: number | undefined
}

export async function listarCaixa(
  banco: Banco,
  filtro: FiltroDaCaixa,
  ator: Ator,
): Promise<ItemDaCaixa[]> {
  const status = filtro.status ? StatusItemSchema.parse(filtro.status) : undefined
  const limite = Math.min(Math.max(filtro.limite ?? 100, 1), 500)

  const itens = await banco.item.findMany({
    where: {
      ...recorteDaCaixa(ator),
      ...(status ? { status } : {}),
      ...(filtro.categoriaCodigo ? { categoria: { codigo: filtro.categoriaCodigo } } : {}),
      ...(filtro.ligaId ? { ligaId: filtro.ligaId } : {}),
      ...(filtro.cpfProtegido ? { cpfProtegido: filtro.cpfProtegido } : {}),
      ...(filtro.matricula ? { matricula: filtro.matricula } : {}),
    },
    orderBy: [{ criadoEm: 'desc' }, { sequencia: 'asc' }],
    take: limite,
    include: {
      categoria: { select: { codigo: true, rotulo: true, grupo: true, limiarConfianca: true } },
      liga: { select: { id: true, nome: true } },
      email: {
        select: {
          recebidoEm: true,
          conteudoExpurgadoEm: true,
          // Nulo quando a retenção já expurgou o conteúdo. O item continua
          // inteiro: título, categoria, responsável e carga não dependem disto.
          conteudo: { select: { remetente: true, assunto: true } },
          _count: { select: { itens: true } },
        },
      },
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
    limiarConfianca: item.categoria.limiarConfianca,
    grupo: item.categoria.grupo,
    status: item.status,
    confianca: item.confianca,
    classificadaPorIa: item.modeloIa !== null,
    remetente: item.email?.conteudo?.remetente ?? null,
    assunto: item.email?.conteudo?.assunto ?? null,
    recebidoEm: item.email?.recebidoEm ?? null,
    conteudoRemovidoEm: item.email?.conteudoExpurgadoEm ?? null,
    irmaos: item.email?._count.itens ?? 1,
    responsavel: item.atribuicoes[0]?.colaborador.nome ?? null,
    ligaId: item.liga?.id ?? null,
    ligaNome: item.liga?.nome ?? null,
  }))
}

/** Quantos itens a busca devolve. Um CPF com mais que isso é caso de conferência, não de lista. */
const LIMITE_DA_BUSCA = 200

/**
 * Busca por CPF ou matrícula (`A23(b)`, `A40` resposta 24).
 *
 * É a MESMA leitura da Caixa com um filtro a mais, de propósito: quando a fase 2
 * limitar o que cada cargo vê na Caixa (`A24`), a busca herda o limite em vez de
 * virar uma porta lateral para itens de outra pessoa.
 *
 * Nunca chama `listarCaixa` sem filtro de chave: um filtro vazio devolveria a
 * Caixa inteira como se fosse o resultado da busca.
 */
export async function buscarPorChave(
  banco: Banco,
  entrada: unknown,
  ator: Ator,
  opcoes: { hoje?: string } = {},
): Promise<ItemDaCaixa[]> {
  const { texto } = BuscaPorChaveSchema.parse(entrada)
  const busca = interpretarBusca(texto)

  if (busca.tipo === 'nao_reconhecido') throw new ErroDeNegocio(MENSAGEM_BUSCA_NAO_RECONHECIDA)
  if (busca.tipo === 'cpf_nao_confere') throw new ErroDeNegocio(MENSAGEM_CPF_NAO_CONFERE)

  let filtro: FiltroDaCaixa
  if (busca.tipo === 'matricula') {
    filtro = { matricula: busca.matricula, limite: LIMITE_DA_BUSCA }
  } else {
    const cpfProtegido = protegerCpf(busca.cpf)
    if (cpfProtegido === null) throw new ErroDeNegocio(MENSAGEM_CPF_NAO_CONFERE)
    filtro = { cpfProtegido, limite: LIMITE_DA_BUSCA }
  }

  const itens = await listarCaixa(banco, filtro, ator)

  // Contada aqui, no serviço, e só depois de procurar (`A44(h)`): texto
  // recusado não é busca. "Nada encontrado" é o que ESTA pessoa viu — com o
  // recorte de `A24`, é também o que uma varredura feita por esta conta veria.
  await contarBusca(banco, ator.colaboradorId, itens.length > 0, opcoes.hoje)
  return itens
}

export interface ResumoDaCaixa {
  total: number
  porStatus: Record<string, number>
  porCategoria: { codigo: string; rotulo: string; grupo: string; total: number }[]
}

/**
 * O resumo conta o MESMO universo que a listagem mostra (`A24`).
 *
 * Sem o recorte aqui, o cabeçalho da Caixa diria "47 itens" sobre uma lista de
 * três — um número que não fecha com a tela logo abaixo dele, que é a doença
 * que este sistema existe para curar.
 */
export async function resumirCaixa(banco: Banco, ator: Ator): Promise<ResumoDaCaixa> {
  const recorte = recorteDaCaixa(ator)

  const [porStatus, porCategoria, categorias] = await Promise.all([
    banco.item.groupBy({ by: ['status'], where: recorte, _count: { _all: true } }),
    banco.item.groupBy({ by: ['categoriaId'], where: recorte, _count: { _all: true } }),
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
