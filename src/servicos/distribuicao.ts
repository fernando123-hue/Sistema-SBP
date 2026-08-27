import { ALGORITMO_VERSAO, distribuir } from '../core/distribuicao/motor'
import { serializar, type PedidoDistribuicao } from '../core/esquemas'
import type { Categoria, Elegivel, ResultadoRodada } from '../core/tipos'
import { deslocarDias, fimDoDia, inicioDoDia } from '../core/util/datas'
import { somar } from '../core/util/numero'
import { exigirPapel, type Ator } from '../servidor/ator'
import {
  mensagemDoErro,
  novaCorrelacao,
  registrarEvento,
  registrarLog,
} from '../servidor/observabilidade'
import type { Banco, Transacao } from '../servidor/prisma'
import { auditarLote } from './auditoria'

/**
 * Tamanho da janela do critério "recebido no período" do desempate.
 *
 * Decisão do dono do processo em 27/08/2026: janela deslizante de 30 dias, no
 * lugar do mês corrente. Ver DECISOES.md.
 */
const DIAS_DA_JANELA = 30

/**
 * Serviço de distribuição.
 *
 * A decisão em si vive no motor puro (`core/distribuicao/motor.ts`). Aqui só
 * acontecem três coisas: carregar o estado, chamar o motor, gravar em transação.
 *
 * `previa` e `confirmar` chamam EXATAMENTE a mesma função de planejamento —
 * o que o operador vê na tela é literalmente o que vai ser gravado.
 */

export interface PlanoCategoria {
  categoria: Categoria
  quantidade: number
  itensIds: string[]
  resultado: ResultadoRodada | null
  erro: string | null
}

export interface RelatorioDistribuicao {
  correlacaoId: string
  data: string
  planos: PlanoCategoria[]
  totalDistribuido: number
  rodadasGravadas: number
}

// ─── Planejamento (sem efeito colateral) ─────────────────────

/**
 * Ajuste em memória do crédito global entre categorias da mesma rodada.
 * Chave: colaboradorId. Valor: delta acumulado pelas categorias já planejadas.
 */
export type AjusteDeCredito = Map<string, number>

/**
 * Planeja UMA categoria.
 *
 * `ajusteGlobal` carrega o efeito das categorias já planejadas nesta mesma
 * rodada. Sem ele, a segunda categoria decidiria o desempate com o crédito
 * global anterior à primeira — e favoreceria a mesma pessoa duas vezes seguidas
 * quando o critério secundário desempata.
 */
export async function planejarCategoria(
  banco: Banco | Transacao,
  categoria: Categoria,
  data: string,
  ajusteGlobal: AjusteDeCredito = new Map(),
): Promise<PlanoCategoria | null> {
  // Corte temporal: a fila do dia é "aprovado E já recebido até o fim deste
  // dia". O backlog de ontem entra; o e-mail que só chega depois de amanhã,
  // não. Sem este corte, distribuir a data de hoje varreria o futuro inteiro.
  //
  // O fim do dia é no FUSO DA OPERAÇÃO. Com `Z`, um e-mail das 22h em Brasília
  // (01h UTC do dia seguinte) ficava de fora da própria data em que chegou.
  const limite = fimDoDia(data)

  const itens = await banco.item.findMany({
    where: {
      categoriaId: categoria.id,
      // `devolvido` entra junto com `aprovado`: um item devolvido volta ao pool
      // e é redistribuído na próxima rodada, com o crédito já atualizado.
      // O status separado mantém visível no painel que houve devolução.
      status: { in: ['aprovado', 'devolvido'] },
      OR: [
        { email: { recebidoEm: { lte: limite } } },
        { emailId: null, criadoEm: { lte: limite } },
      ],
    },
    orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
    select: { id: true },
  })

  if (itens.length === 0) return null

  const elegiveis = await carregarElegiveis(
    banco,
    categoria.id,
    data,
    categoria.frente,
    ajusteGlobal,
  )
  const base = { categoria, quantidade: itens.length, itensIds: itens.map((item) => item.id) }

  try {
    const resultado = distribuir({ data, categoria, quantidade: itens.length, elegiveis })
    return { ...base, resultado, erro: null }
  } catch (erro) {
    // Falha explícita, nunca silenciosa. Sem elegível, o trabalho FICA na fila
    // — que é o oposto do que a planilha faz quando perde 16 itens de LIGA.
    return { ...base, resultado: null, erro: mensagemDoErro(erro) }
  }
}

/**
 * Planeja o dia inteiro, simulando a sequência sem gravar nada.
 *
 * O efeito de cada categoria sobre o crédito global é acumulado em memória e
 * repassado à próxima. Assim `previa` e `confirmar` produzem exatamente a mesma
 * alocação — a promessa de que o operador vê o que será gravado — E o desempate
 * respeita a ordem sequencial correta.
 */
export async function planejar(
  banco: Banco | Transacao,
  pedido: PedidoDistribuicao,
): Promise<PlanoCategoria[]> {
  const categorias = await carregarCategorias(banco, pedido.categorias)
  const planos: PlanoCategoria[] = []
  const ajusteGlobal: AjusteDeCredito = new Map()

  for (const categoria of categorias) {
    const plano = await planejarCategoria(banco, categoria, pedido.data, ajusteGlobal)
    if (!plano) continue
    planos.push(plano)
    if (!plano.resultado) continue

    for (const colaboradorId of plano.resultado.ordemDesempate) {
      const delta =
        (plano.resultado.creditoGlobalDepois[colaboradorId] ?? 0) -
        (plano.resultado.creditoGlobalAntes[colaboradorId] ?? 0)
      ajusteGlobal.set(colaboradorId, (ajusteGlobal.get(colaboradorId) ?? 0) + delta)
    }
  }

  return planos
}

export async function previa(
  banco: Banco,
  pedido: PedidoDistribuicao,
  ator: Ator,
): Promise<RelatorioDistribuicao> {
  exigirPapel(ator, 'ver prévia da distribuição', 'operador', 'gestor')
  const planos = await planejar(banco, pedido)

  return {
    correlacaoId: 'previa',
    data: pedido.data,
    planos,
    totalDistribuido: somar(planos.map((plano) => (plano.resultado ? plano.quantidade : 0))),
    rodadasGravadas: 0,
  }
}

// ─── Confirmação (transacional) ──────────────────────────────

export async function confirmar(
  banco: Banco,
  pedido: PedidoDistribuicao,
  ator: Ator,
): Promise<RelatorioDistribuicao> {
  exigirPapel(ator, 'confirmar distribuição', 'operador', 'gestor')

  const correlacaoId = novaCorrelacao()
  const inicio = Date.now()

  await registrarEvento(banco, {
    correlacaoId,
    etapa: 'distribuicao',
    situacao: 'iniciado',
    referencia: pedido.data,
  })

  const relatorio = await banco.$transaction(async (tx) => {
    // Serializa o dia ANTES de qualquer leitura de crédito. Duas confirmações
    // concorrentes de categorias diferentes leriam o crédito global uma da
    // outra ainda não gravado e decidiriam o desempate com dado obsoleto —
    // sem erro, sem exceção, só um rateio injusto. Ver o comentário de
    // `TravaDeDistribuicao` no schema.
    await tx.travaDeDistribuicao.upsert({
      where: { data: pedido.data },
      create: { data: pedido.data, execucoes: 1 },
      update: { execucoes: { increment: 1 } },
    })

    // Replaneja DENTRO da transação: o estado pode ter mudado entre a prévia
    // que o operador viu e o clique em confirmar. Mesma função da prévia.
    const planos = await planejar(tx, pedido)
    let rodadasGravadas = 0
    let totalDistribuido = 0

    for (const plano of planos) {
      if (!plano.resultado) continue
      await gravarRodada(tx, plano, pedido.data, ator, correlacaoId)
      rodadasGravadas += 1
      totalDistribuido += plano.quantidade
    }

    return {
      correlacaoId,
      data: pedido.data,
      planos,
      totalDistribuido,
      rodadasGravadas,
    } satisfies RelatorioDistribuicao
  })

  const comErro = relatorio.planos.filter((plano) => plano.erro)
  if (comErro.length > 0) {
    registrarLog('aviso', 'categorias não distribuídas', {
      correlacaoId,
      data: pedido.data,
      categorias: comErro.map((plano) => `${plano.categoria.codigo}: ${plano.erro}`),
    })
  }

  await registrarEvento(banco, {
    correlacaoId,
    etapa: 'distribuicao',
    situacao: comErro.length > 0 ? 'reprocessavel' : 'sucesso',
    referencia: pedido.data,
    mensagem: `${relatorio.rodadasGravadas} rodadas · ${relatorio.totalDistribuido} itens`,
    duracaoMs: Date.now() - inicio,
  })

  return relatorio
}

async function gravarRodada(
  tx: Transacao,
  plano: PlanoCategoria,
  data: string,
  ator: Ator,
  correlacaoId: string,
): Promise<void> {
  const resultado = plano.resultado!

  const rodada = await tx.rodadaDistribuicao.create({
    data: {
      data,
      categoriaId: plano.categoria.id,
      quantidadeEntrada: resultado.quantidadeEntrada,
      algoritmoVersao: ALGORITMO_VERSAO,
      criterio: resultado.criterio,
      base: resultado.base,
      resto: resultado.resto,
      cotaJusta: resultado.cotaJusta,
      // Snapshot COMPLETO dos elegíveis: crédito, recebido no período e no dia
      // de cada candidato. É o que responde "por que ela levou a sobra?".
      elegiveis: serializar(resultado.elegiveis),
      ordemDesempate: serializar(resultado.ordemDesempate),
      alocacao: serializar(resultado.alocacao),
      creditoAntes: serializar(resultado.creditoCategoriaAntes),
      creditoDepois: serializar(resultado.creditoCategoriaDepois),
      executadoPor: ator.colaboradorId,
      correlacaoId,
    },
  })

  // Reparte os itens CONCRETOS seguindo a ordem de desempate. A planilha diz
  // "Paulo: 24"; aqui fica registrado QUAIS 24.
  let cursor = 0
  let atribuidos = 0

  for (const colaboradorId of resultado.ordemDesempate) {
    const cota = resultado.alocacao[colaboradorId] ?? 0
    const fatia = plano.itensIds.slice(cursor, cursor + cota)
    cursor += cota

    for (const itemId of fatia) {
      await tx.atribuicao.create({
        data: {
          itemId,
          colaboradorId,
          rodadaId: rodada.id,
          motivo: 'algoritmo',
          atribuidoPor: ator.colaboradorId,
          ativa: true,
        },
      })
      await tx.item.update({ where: { id: itemId }, data: { status: 'distribuido' } })
      atribuidos += 1
    }

    await atualizarSaldos(tx, {
      colaboradorId,
      categoriaId: plano.categoria.id,
      data,
      recebido: cota,
      pesoCategoria: plano.categoria.peso,
      escopo: plano.categoria.frente,
      cotaJusta: resultado.cotaJusta,
      creditoCategoria: resultado.creditoCategoriaDepois[colaboradorId] ?? 0,
      creditoGlobalAnterior: resultado.creditoGlobalAntes[colaboradorId] ?? 0,
      deltaCreditoGlobal:
        (resultado.creditoGlobalDepois[colaboradorId] ?? 0) -
        (resultado.creditoGlobalAntes[colaboradorId] ?? 0),
    })
  }

  // Segunda trava, agora sobre os itens reais gravados — não só sobre a
  // aritmética do motor. Falhou, a transação inteira volta atrás.
  if (atribuidos !== resultado.quantidadeEntrada) {
    throw new Error(
      `Conservação violada ao gravar: entrada ${resultado.quantidadeEntrada}, ` +
        `itens atribuídos ${atribuidos}, categoria ${plano.categoria.codigo}.`,
    )
  }

  await auditarLote(
    tx,
    resultado.ordemDesempate.map((colaboradorId) => ({
      entidade: 'RodadaDistribuicao',
      entidadeId: rodada.id,
      acao: 'distribuido',
      antes: { credito: resultado.creditoCategoriaAntes[colaboradorId] },
      depois: {
        colaboradorId,
        recebido: resultado.alocacao[colaboradorId] ?? 0,
        credito: resultado.creditoCategoriaDepois[colaboradorId],
      },
      usuario: ator.colaboradorId,
      correlacaoId,
    })),
  )
}

async function atualizarSaldos(
  tx: Transacao,
  entrada: {
    colaboradorId: string
    categoriaId: string
    data: string
    recebido: number
    pesoCategoria: number
    /** Frente da categoria. Mantém razões de `CADASTRO` e `TITULOS` separados. */
    escopo: string
    cotaJusta: number
    creditoCategoria: number
    creditoGlobalAnterior: number
    deltaCreditoGlobal: number
  },
): Promise<void> {
  await tx.saldoCarga.upsert({
    where: {
      colaboradorId_categoriaId_data: {
        colaboradorId: entrada.colaboradorId,
        categoriaId: entrada.categoriaId,
        data: entrada.data,
      },
    },
    create: {
      colaboradorId: entrada.colaboradorId,
      categoriaId: entrada.categoriaId,
      data: entrada.data,
      recebido: entrada.recebido,
      // Contagem e carga gravadas lado a lado. Hoje uma é múltipla da outra;
      // quando o peso passar a variar por item, deixam de ser — e é por isso
      // que as duas são gravadas desde já, em vez de uma ser derivada da outra.
      recebidoPonderado: entrada.recebido * entrada.pesoCategoria,
      cotaJusta: entrada.cotaJusta,
      creditoAcumulado: entrada.creditoCategoria,
    },
    update: {
      recebido: { increment: entrada.recebido },
      recebidoPonderado: { increment: entrada.recebido * entrada.pesoCategoria },
      // `cotaJusta` ACUMULA, igual a `recebido`. Sobrescrevendo, num dia com
      // duas rodadas da mesma categoria a linha passava a comparar a cota da
      // segunda rodada com o recebido do dia inteiro — número silenciosamente
      // errado, do tipo que um relatório lê três meses depois.
      // `creditoAcumulado` é diferente: vem absoluto do motor, não é delta.
      cotaJusta: { increment: entrada.cotaJusta },
      creditoAcumulado: entrada.creditoCategoria,
    },
  })

  await tx.saldoCargaGlobal.upsert({
    where: {
      colaboradorId_escopo_data: {
        colaboradorId: entrada.colaboradorId,
        escopo: entrada.escopo,
        data: entrada.data,
      },
    },
    // Primeira categoria do dia: abre a linha com o crédito herdado de ontem
    // mais o delta de agora. As seguintes só incrementam.
    create: {
      colaboradorId: entrada.colaboradorId,
      escopo: entrada.escopo,
      data: entrada.data,
      recebidoPonderado: entrada.recebido * entrada.pesoCategoria,
      creditoGlobal: entrada.creditoGlobalAnterior + entrada.deltaCreditoGlobal,
    },
    update: {
      recebidoPonderado: { increment: entrada.recebido * entrada.pesoCategoria },
      creditoGlobal: { increment: entrada.deltaCreditoGlobal },
    },
  })
}

// ─── Carregamento de estado ──────────────────────────────────

async function carregarCategorias(
  banco: Banco | Transacao,
  codigos: readonly string[],
): Promise<Categoria[]> {
  const registros = await banco.categoria.findMany({
    where: {
      ativa: true,
      entraNoRateio: true,
      ...(codigos.length > 0 ? { codigo: { in: [...codigos] } } : {}),
    },
    orderBy: { ordem: 'asc' },
  })

  return registros.map((registro) => ({
    id: registro.id,
    codigo: registro.codigo,
    rotulo: registro.rotulo,
    frente: registro.frente as Categoria['frente'],
    grupo: registro.grupo as Categoria['grupo'],
    divisivel: registro.divisivel,
    peso: registro.peso,
    limiarIndivisivel: registro.limiarIndivisivel,
    entraNoRateio: registro.entraNoRateio,
  }))
}

/**
 * Elegível = Habilitação vigente ∩ Escala do dia.
 *
 * Isto encerra RN-02, a fragilidade estrutural nº 1 da planilha: hoje, mudar
 * quem está de plantão exige EDITAR FÓRMULA. Aqui é linha de tabela.
 *
 * DÍVIDA CONHECIDA: 4 consultas por colaborador escalado. Com a equipe real
 * (4 a 7 pessoas, 2 a 3 de plantão) são dezenas de consultas por rodada, o que
 * é irrelevante. Vira problema com equipe grande; a correção é uma consulta
 * com `IN` e agregação em memória. Registrado em DECISOES.md § G.
 */
async function carregarElegiveis(
  banco: Banco | Transacao,
  categoriaId: string,
  data: string,
  escopo: string,
  ajusteGlobal: AjusteDeCredito = new Map(),
): Promise<Elegivel[]> {
  const habilitacoes = await banco.habilitacao.findMany({
    where: {
      categoriaId,
      podeReceber: true,
      // Fronteiras no fuso da operação: uma habilitação que termina hoje vale
      // o dia inteiro de hoje, não até as 21h.
      vigenciaInicio: { lte: fimDoDia(data) },
      OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: inicioDoDia(data) } }],
      colaborador: { ativo: true },
    },
    select: { colaboradorId: true },
  })

  if (habilitacoes.length === 0) return []

  const candidatos = habilitacoes.map((habilitacao) => habilitacao.colaboradorId)

  const escalas = await banco.escala.findMany({
    where: { data, colaboradorId: { in: candidatos }, disponivel: true },
    select: { colaboradorId: true, capacidadeRelativa: true },
  })

  const elegiveis: Elegivel[] = []

  for (const escala of escalas) {
    const [saldoCategoria, saldoGlobal, doMes, doDia] = await Promise.all([
      banco.saldoCarga.findFirst({
        where: { colaboradorId: escala.colaboradorId, categoriaId, data: { lte: data } },
        orderBy: { data: 'desc' },
        select: { creditoAcumulado: true },
      }),
      banco.saldoCargaGlobal.findFirst({
        where: { colaboradorId: escala.colaboradorId, escopo, data: { lte: data } },
        orderBy: { data: 'desc' },
        select: { creditoGlobal: true },
      }),
      // JANELA DESLIZANTE, não mês corrente.
      //
      // Com `inicioDoMes`, todo dia 1º o histórico do desempate zerava: quem
      // recebeu muito no dia 31 voltava ao topo da fila no dia seguinte, e a
      // fronteira mensal que a `RN-11` manda eliminar reaparecia dentro do
      // próprio substituto da planilha. A janela move-se com o dia e não tem
      // essa borda. O livro-razão é diário, então qualquer janela é calculável
      // — trocar o tamanho é trocar esta constante.
      banco.saldoCarga.aggregate({
        where: {
          colaboradorId: escala.colaboradorId,
          categoriaId,
          data: { gte: deslocarDias(data, -(DIAS_DA_JANELA - 1)), lte: data },
        },
        _sum: { recebido: true },
      }),
      banco.saldoCarga.findUnique({
        where: {
          colaboradorId_categoriaId_data: {
            colaboradorId: escala.colaboradorId,
            categoriaId,
            data,
          },
        },
        select: { recebido: true },
      }),
    ])

    elegiveis.push({
      colaboradorId: escala.colaboradorId,
      creditoCategoria: saldoCategoria?.creditoAcumulado ?? 0,
      // Estado do banco + o que as categorias anteriores desta mesma rodada
      // já consumiram (ainda não gravado).
      creditoGlobal:
        (saldoGlobal?.creditoGlobal ?? 0) + (ajusteGlobal.get(escala.colaboradorId) ?? 0),
      recebidoPeriodo: doMes._sum.recebido ?? 0,
      recebidoDia: doDia?.recebido ?? 0,
      capacidadeRelativa: escala.capacidadeRelativa,
    })
  }

  return elegiveis
}
