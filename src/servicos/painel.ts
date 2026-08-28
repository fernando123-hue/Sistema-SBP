import { deslocarDias, fimDoDia, hojeIso, inicioDoDia } from '../core/util/datas'
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

/**
 * Uma linha do painel, recortada por período.
 *
 * Os quatro primeiros números existem para poder ser postos LADO A LADO com
 * as colunas da planilha na rodada de comparação. Sem esse mapeamento, a
 * conferência vira discussão sobre o que cada palavra significa.
 *
 * | Aqui                 | Planilha                     |
 * |----------------------|------------------------------|
 * | `saldoInicial`       | `Saldo`                      |
 * | `entrouNoPeriodo`    | `Mov. do Dia` + `Mov. Extra` |
 * | `aberto`             | `ABERTO`                     |
 * | `concluidoNoPeriodo` | `Realizado`                  |
 * | `pendente`           | `Pend.`                      |
 *
 * UMA DIFERENÇA É DELIBERADA e vai aparecer na comparação: a planilha calcula
 * `Pend. = IF((Aberto − Realizado) < 0, "0", ...)`, ou seja, ela GRAMPEIA o
 * resultado em zero. Quem conclui mais do que recebeu — limpando backlog
 * antigo — tem o excedente descartado (`RN-09`). Aqui o grampo não existe e
 * nem precisa: `concluidoNoPeriodo` só conta item que estava em `aberto`,
 * então a subtração não tem como ficar negativa. Quando os dois números
 * divergirem num dia de limpeza de backlog, o certo é este.
 */
export interface LinhaPainel {
  categoriaCodigo: string
  rotulo: string
  grupo: string

  /** Entrou antes do período e ainda estava aberto quando ele começou. */
  saldoInicial: number
  /** Entrou dentro do período. */
  entrouNoPeriodo: number
  /** `saldoInicial + entrouNoPeriodo` — tudo que esteve na mesa no período. */
  aberto: number
  /** Fechado dentro do período. */
  concluidoNoPeriodo: number
  /** Cancelado dentro do período. A planilha não tem coluna equivalente. */
  canceladoNoPeriodo: number
  /** Ainda aberto no fim do período. */
  pendente: number

  /** Estado AGORA, para tocar o dia. Não tem recorte de período. */
  aguardandoRevisao: number
  aprovado: number
  distribuido: number
  emAndamento: number
}

export interface Periodo {
  de: string
  ate: string
}

export interface LinhaPorPessoa {
  colaboradorId: string
  nome: string
  atribuidos: number
  concluidos: number
  pendentes: number
  creditoGlobal: number
}

/**
 * Janela padrão do painel: o mês corrente até hoje.
 *
 * Espelha a aba mensal da planilha, que é a unidade em que a operação pensa —
 * e é o recorte que a comparação lado a lado vai usar.
 */
export function periodoPadrao(): Periodo {
  const hoje = hojeIso()
  return { de: `${hoje.slice(0, 7)}-01`, ate: hoje }
}

export async function porCategoria(banco: Banco, periodo = periodoPadrao()): Promise<LinhaPainel[]> {
  const abertura = inicioDoDia(periodo.de)
  const fechamento = fimDoDia(periodo.ate)

  const categorias = await banco.categoria.findMany({
    where: { ativa: true },
    orderBy: { ordem: 'asc' },
  })

  // Item concluído NUNCA reabre — `devolver` recusa item concluído e `concluir`
  // sai cedo se já estiver. Por isso "estava fechado no dia X" é uma pergunta
  // com resposta exata: existe execução concluída até X. Sem essa garantia, o
  // recorte histórico precisaria de uma tabela de eventos de status.
  //
  // A COMPARAÇÃO É ESTRITA (`lt`), e isso não é detalhe. O período começa em
  // `gte: abertura`; se "antes do período" fosse `lte: abertura`, um item
  // concluído no instante exato da virada casaria com OS DOIS — descontado do
  // saldo inicial e descontado de novo como conclusão do período. A pendência
  // ia a −1: o defeito `E.9` da planilha ("realizado maior que o recebido,
  // fisicamente impossível") reconstruído dentro do substituto. Foi
  // `conferirPendencia` que pegou.
  const concluidoAntesDe = (quando: Date) => ({
    execucoes: { some: { resultado: 'concluido', concluidoEm: { lt: quando } } },
  })

  const [
    entrouAntes,
    entrouNoPeriodo,
    concluidoNoPeriodo,
    canceladoNoPeriodo,
    concluidoAntes,
    canceladoAntes,
    estadoAtual,
  ] = await Promise.all([
    banco.item.groupBy({
      by: ['categoriaId'],
      where: { criadoEm: { lt: abertura } },
      _count: { _all: true },
    }),
    banco.item.groupBy({
      by: ['categoriaId'],
      where: { criadoEm: { gte: abertura, lte: fechamento } },
      _count: { _all: true },
    }),
    banco.item.groupBy({
      by: ['categoriaId'],
      where: {
        execucoes: { some: { resultado: 'concluido', concluidoEm: { gte: abertura, lte: fechamento } } },
      },
      _count: { _all: true },
    }),
    banco.item.groupBy({
      by: ['categoriaId'],
      where: { canceladoEm: { gte: abertura, lte: fechamento } },
      _count: { _all: true },
    }),
    banco.item.groupBy({
      by: ['categoriaId'],
      where: { criadoEm: { lt: abertura }, ...concluidoAntesDe(abertura) },
      _count: { _all: true },
    }),
    banco.item.groupBy({
      by: ['categoriaId'],
      where: { criadoEm: { lt: abertura }, canceladoEm: { lt: abertura } },
      _count: { _all: true },
    }),
    banco.item.groupBy({ by: ['categoriaId', 'status'], _count: { _all: true } }),
  ])

  // O tipo que o `groupBy` do Prisma devolve marca `_count` como opcional,
  // ainda que ele venha sempre que for pedido. Estreitar aqui, num lugar só,
  // evita espalhar `?.` por toda a montagem da linha.
  interface Agrupado {
    categoriaId: string
    _count?: { _all?: number } | true
  }

  const somar = (linhas: Agrupado[], categoriaId: string): number => {
    const achado = linhas.find((linha) => linha.categoriaId === categoriaId)
    if (!achado || achado._count === undefined || achado._count === true) return 0
    return achado._count._all ?? 0
  }

  return categorias.map((categoria) => {
    const doGrupo = estadoAtual.filter((linha) => linha.categoriaId === categoria.id)
    const contarStatus = (status: string): number =>
      doGrupo.find((linha) => linha.status === status)?._count._all ?? 0

    // O que entrou antes e ainda não tinha fechado quando o período começou.
    // É o `Saldo` da planilha — que lá é digitado à mão e quebra em ~10% dos
    // dias; aqui é consulta.
    const saldoInicial =
      somar(entrouAntes, categoria.id) -
      somar(concluidoAntes, categoria.id) -
      somar(canceladoAntes, categoria.id)

    const entrou = somar(entrouNoPeriodo, categoria.id)
    const aberto = saldoInicial + entrou
    const concluido = somar(concluidoNoPeriodo, categoria.id)
    const cancelado = somar(canceladoNoPeriodo, categoria.id)

    return {
      categoriaCodigo: categoria.codigo,
      rotulo: categoria.rotulo,
      grupo: categoria.grupo,
      saldoInicial,
      entrouNoPeriodo: entrou,
      aberto,
      concluidoNoPeriodo: concluido,
      canceladoNoPeriodo: cancelado,
      // Sem grampo em zero, e sem precisar dele: tudo que foi concluído ou
      // cancelado no período estava em `aberto`, então a conta não tem como
      // ficar negativa. `conferirPendencia` prova isso contra a contagem direta.
      pendente: aberto - concluido - cancelado,
      aguardandoRevisao: contarStatus('aguardando_revisao'),
      aprovado: contarStatus('aprovado'),
      distribuido: contarStatus('distribuido'),
      emAndamento: contarStatus('em_andamento'),
    }
  })
}

/**
 * A pendência contada de outro jeito, para conferir a subtração.
 *
 * `porCategoria` chega em `pendente` subtraindo. Aqui se conta diretamente
 * quantos itens estavam abertos no fim do período. Os dois têm de bater sempre
 * — e é justamente por não bater que a planilha precisa do grampo em zero.
 *
 * Existe para teste e para conferência sob demanda, não para a tela: se algum
 * dia divergir, é defeito do painel, não erro de operação.
 */
export async function conferirPendencia(
  banco: Banco,
  periodo = periodoPadrao(),
): Promise<{ categoriaCodigo: string; porSubtracao: number; porContagem: number }[]> {
  const fechamento = fimDoDia(periodo.ate)
  const linhas = await porCategoria(banco, periodo)

  const categorias = await banco.categoria.findMany({
    where: { ativa: true },
    select: { id: true, codigo: true },
  })

  const abertosNoFim = await banco.item.groupBy({
    by: ['categoriaId'],
    where: {
      criadoEm: { lte: fechamento },
      NOT: { execucoes: { some: { resultado: 'concluido', concluidoEm: { lte: fechamento } } } },
      OR: [{ canceladoEm: null }, { canceladoEm: { gt: fechamento } }],
    },
    _count: { _all: true },
  })

  return linhas.map((linha) => {
    const categoria = categorias.find((item) => item.codigo === linha.categoriaCodigo)
    return {
      categoriaCodigo: linha.categoriaCodigo,
      porSubtracao: linha.pendente,
      porContagem:
        abertosNoFim.find((item) => item.categoriaId === categoria?.id)?._count._all ?? 0,
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
