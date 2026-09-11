import type { LinhaPainel, LinhaPorPessoa } from '../core/tipos'
import {
  deslocarDias,
  diasEntre,
  fimDoDia,
  hojeIso,
  inicioDoDia,
  paraDataIso,
} from '../core/util/datas'
import type { Banco } from '../servidor/prisma'

export type { LinhaPainel, LinhaPorPessoa }

/** Janela padrão da conferência de conservação exibida no painel. */
export const JANELA_PADRAO_DE_DIAS = 90

/**
 * Os status em que um item ainda está na mesa de alguém.
 *
 * Fonte única do que "aberto" significa no painel: os contadores de estado
 * atual e o indicador de atraso do `A7` leem esta mesma lista. Item concluído
 * ou cancelado saiu da mesa e, por definição, parou de envelhecer.
 *
 * `devolvido` ESTÁ aqui, e a ausência dele era defeito: o item devolvido volta
 * ao pool esperando a próxima rodada — `planejarCategoria` o recolhe junto com
 * `aprovado` —, então ele continua sendo trabalho a fazer e continua
 * envelhecendo. Sem ele, `pendente` (que o conta) e "Mais antigo (hoje)" (que
 * não contava) discordavam na mesma linha da mesma tela: a categoria dizia ter
 * pendência e, ao lado, que nada estava envelhecendo.
 */
const ABERTOS = ['aguardando_revisao', 'aprovado', 'distribuido', 'em_andamento', 'devolvido']

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

export interface Periodo {
  de: string
  ate: string
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
  // Lido UMA vez: com uma chamada por categoria, uma consulta que atravessasse
  // a virada da meia-noite produziria linhas medidas contra dias diferentes.
  const hoje = hojeIso()

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
    maisAntigoAberto,
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
    // Item aberto mais antigo por categoria — o indicador de atraso do `A7`.
    //
    // "Aberto" aqui são exatamente os quatro status de `estadoAtual`: o que já
    // fechou (`concluido`) e o que foi retirado (`cancelado`) não envelhece.
    // Usar a mesma lista dos contadores ao lado mantém uma definição só de
    // "aberto" na tela inteira.
    banco.item.groupBy({
      by: ['categoriaId'],
      where: { status: { in: ABERTOS } },
      _min: { criadoEm: true },
    }),
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
      diasDoMaisAntigo: idadeDoMaisAntigo(maisAntigoAberto, categoria.id, hoje),
    }
  })
}

/**
 * Idade, em dias, do item aberto mais antigo de uma categoria.
 *
 * A conta é feita sobre a CHAVE de data no fuso da operação, não sobre o
 * instante bruto: um item criado ontem às 23h está parado "há 1 dia" às 8h de
 * hoje, que é como a operação fala. Subtrair instantes daria `0`, e o número
 * que serve para enxergar backlog não pode arredondar para baixo o dia inteiro.
 */
function idadeDoMaisAntigo(
  linhas: { categoriaId: string; _min?: { criadoEm?: Date | null } }[],
  categoriaId: string,
  hoje: string,
): number | null {
  const achado = linhas.find((linha) => linha.categoriaId === categoriaId)
  const criadoEm = achado?._min?.criadoEm
  if (!criadoEm) return null
  return diasEntre(paraDataIso(criadoEm), hoje)
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
      // `escopo` explícito. Sem ele, a linha mais recente vinha de CADASTRO ou
      // de TITULOS, qualquer que fosse — e o próprio modelo diz que somar os
      // dois razões tira o sentido do crédito. Hoje só existe CADASTRO, então
      // nada aparecia; a reescrita em lote do `H-D8` cimentaria o defeito no dia
      // em que TITULOS entrasse. A V1 cobre só CADASTRO (`Frente`).
      banco.saldoCargaGlobal.findFirst({
        where: { colaboradorId: colaborador.id, escopo: 'CADASTRO' },
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
    select: { id: true, quantidadeEntrada: true },
  })

  if (rodadas.length === 0) return { rodadas: 0, desde, divergentes: [] }

  // ═══ O QUE ESTA CONTAGEM PRECISA MEDIR ═══
  //
  // A pergunta é "a rodada entregou tantos itens quantos entraram?", e a
  // resposta certa é o número de ITENS DISTINTOS que aquela rodada atribuiu —
  // não o número de atribuições, nem o de atribuições vigentes.
  //
  // As duas formas anteriores erravam, cada uma de um jeito, e as duas em
  // situação NORMAL de operação:
  //
  //   - contando TODAS as atribuições, uma transferência somava +1 (ela encerra
  //     a anterior e cria outra, de propósito, para o histórico ficar imutável)
  //     e a rodada aparecia divergente;
  //   - contando só as ATIVAS — a correção que veio depois —, toda DEVOLUÇÃO ao
  //     pool passou a subtrair 1 para sempre: `devolver` encerra a atribuição e
  //     NÃO cria substituta, porque o item fica sem dono esperando a próxima
  //     rodada. A devolução é um caminho previsto do sistema (`AT-07`), então
  //     bastava alguém devolver um item para o painel passar a dizer, todo dia,
  //     que os números não são confiáveis.
  //
  // Um alarme que dispara na operação normal deixa de ser alarme: quem opera
  // aprende a ignorá-lo, e no dia de uma violação de verdade ninguém olha. Isso
  // é degradação silenciosa da própria trava que o invariante 3 institui.
  //
  // Item distinto por rodada é imune aos dois: a transferência não muda o
  // conjunto de itens que a rodada tocou, e a devolução também não — o que
  // muda é quem é o dono AGORA, que é outra pergunta.
  const entregas = await banco.atribuicao.findMany({
    where: { rodadaId: { in: rodadas.map((rodada) => rodada.id) } },
    select: { rodadaId: true, itemId: true },
    distinct: ['rodadaId', 'itemId'],
  })

  const itensPorRodada = new Map<string, number>()
  for (const entrega of entregas) {
    if (!entrega.rodadaId) continue
    itensPorRodada.set(entrega.rodadaId, (itensPorRodada.get(entrega.rodadaId) ?? 0) + 1)
  }

  const divergentes = rodadas
    .map((rodada) => ({
      rodadaId: rodada.id,
      entrada: rodada.quantidadeEntrada,
      gravado: itensPorRodada.get(rodada.id) ?? 0,
    }))
    .filter((rodada) => rodada.gravado !== rodada.entrada)

  return { rodadas: rodadas.length, desde, divergentes }
}
