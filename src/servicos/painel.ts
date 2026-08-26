import { deslocarDias, hojeIso } from '../core/util/datas'
import type { Banco } from '../servidor/prisma'

/** Janela padrão da conferência de conservação exibida no painel. */
export const JANELA_PADRAO_DE_DIAS = 90

/**
 * Painel.
 *
 * TODA métrica aqui é agregação derivada de `Item.status` e `Execucao`.
 * Não existe campo digitável, não existe total armazenado, não existe
 * `SUBTOTAL(109)` que colapsa quando alguém oculta uma linha, e não existe
 * string `"3,0"` digitada à mão sustentando o indicador anual.
 *
 * `Saldo`, `Aberto` e `Pend.` da planilha não são colunas — são estas consultas.
 */

export interface LinhaPainel {
  categoriaCodigo: string
  rotulo: string
  grupo: string
  recebido: number
  aguardandoRevisao: number
  aprovado: number
  distribuido: number
  emAndamento: number
  concluido: number
  /** O que a planilha chama de `Pend.`: recebido e ainda não concluído. */
  pendente: number
}

export interface LinhaPorPessoa {
  colaboradorId: string
  nome: string
  atribuidos: number
  concluidos: number
  pendentes: number
  creditoGlobal: number
}

export async function porCategoria(banco: Banco): Promise<LinhaPainel[]> {
  const categorias = await banco.categoria.findMany({
    where: { ativa: true },
    orderBy: { ordem: 'asc' },
  })

  const contagens = await banco.item.groupBy({
    by: ['categoriaId', 'status'],
    _count: { _all: true },
  })

  return categorias.map((categoria) => {
    const doGrupo = contagens.filter((linha) => linha.categoriaId === categoria.id)
    const contar = (status: string): number =>
      doGrupo.find((linha) => linha.status === status)?._count._all ?? 0

    const concluido = contar('concluido')
    const recebido = doGrupo.reduce((total, linha) => total + linha._count._all, 0)
    const cancelado = contar('cancelado')

    return {
      categoriaCodigo: categoria.codigo,
      rotulo: categoria.rotulo,
      grupo: categoria.grupo,
      recebido,
      aguardandoRevisao: contar('aguardando_revisao'),
      aprovado: contar('aprovado'),
      distribuido: contar('distribuido'),
      emAndamento: contar('em_andamento'),
      concluido,
      pendente: recebido - concluido - cancelado,
    }
  })
}

export async function porPessoa(banco: Banco): Promise<LinhaPorPessoa[]> {
  const colaboradores = await banco.colaborador.findMany({
    where: { ativo: true },
    orderBy: { nome: 'asc' },
  })

  const linhas: LinhaPorPessoa[] = []

  for (const colaborador of colaboradores) {
    const [atribuidos, concluidos, pendentes, saldo] = await Promise.all([
      banco.atribuicao.count({ where: { colaboradorId: colaborador.id, ativa: true } }),
      banco.execucao.count({
        where: { colaboradorId: colaborador.id, resultado: 'concluido' },
      }),
      // Pendente é CONTADO, não subtraído.
      //
      // Era `atribuidos - concluidos`, misturando dois universos: atribuições
      // ativas AGORA menos execuções DESDE SEMPRE. Bastava transferir um item
      // já concluído para a pessoa ficar com pendência negativa — que é
      // exatamente o defeito E.9 da planilha ("Realizado maior que o recebido,
      // fisicamente impossível") reconstruído dentro do substituto.
      banco.atribuicao.count({
        where: {
          colaboradorId: colaborador.id,
          ativa: true,
          item: { status: { in: ['distribuido', 'em_andamento'] } },
        },
      }),
      banco.saldoCargaGlobal.findFirst({
        where: { colaboradorId: colaborador.id },
        orderBy: { data: 'desc' },
        select: { creditoGlobal: true },
      }),
    ])

    linhas.push({
      colaboradorId: colaborador.id,
      nome: colaborador.nome,
      atribuidos,
      concluidos,
      pendentes,
      creditoGlobal: saldo?.creditoGlobal ?? 0,
    })
  }

  return linhas
}

/**
 * Verificação de conservação — o critério de aceitação nº 1.
 *
 * Compara, por rodada, a quantidade de entrada com a soma das atribuições
 * efetivamente gravadas. A planilha falha nisso em 29% dos dias; aqui, qualquer
 * linha com `conservado: false` é bug e tem que quebrar o build.
 */
export async function conferirConservacao(
  banco: Banco,
  opcoes: { desde?: string } = {},
): Promise<{
  rodadas: number
  desde: string
  divergentes: { rodadaId: string; entrada: number; gravado: number }[]
}> {
  // Recorte temporal obrigatório. Sem ele, a query cresce com o TEMPO DE VIDA
  // do sistema — e roda a cada carregamento do painel, que é a tela mais
  // visitada. Nenhuma tela deve precisar ler a tabela inteira desde a fundação
  // para responder "está tudo certo?". Conferência histórica completa é
  // relatório sob demanda, não parte do carregamento síncrono.
  const desde = opcoes.desde ?? deslocarDias(hojeIso(), -JANELA_PADRAO_DE_DIAS)

  const rodadas = await banco.rodadaDistribuicao.findMany({
    where: { data: { gte: desde } },
    select: {
      id: true,
      quantidadeEntrada: true,
      // SÓ as atribuições ATIVAS. Contando todas, uma transferência — que cria
      // a nova sem apagar a anterior, de propósito, para o histórico ficar
      // imutável — somava +1 e marcava a rodada como divergente. O indicador
      // que prova o valor do sistema acusava erro justamente quando o sistema
      // funcionava como projetado.
      _count: { select: { atribuicoes: { where: { ativa: true } } } },
    },
  })

  const divergentes = rodadas
    .filter((rodada) => rodada._count.atribuicoes !== rodada.quantidadeEntrada)
    .map((rodada) => ({
      rodadaId: rodada.id,
      entrada: rodada.quantidadeEntrada,
      gravado: rodada._count.atribuicoes,
    }))

  return { rodadas: rodadas.length, desde, divergentes }
}
