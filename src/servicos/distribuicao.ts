import { ALGORITMO_VERSAO, distribuir } from '../core/distribuicao/motor'
import { serializar, type PedidoDistribuicao } from '../core/esquemas'
import type { Categoria, Elegivel, ResultadoRodada } from '../core/tipos'
import { inicioDoMes } from '../core/util/datas'
import { somar } from '../core/util/numero'
import {
  mensagemDoErro,
  novaCorrelacao,
  registrarEvento,
  registrarLog,
} from '../servidor/observabilidade'
import type { Banco, Transacao } from '../servidor/prisma'
import { auditarLote } from './auditoria'

/**
 * Serviço de distribuição.
 *
 * A decisão em si vive no motor puro (`core/distribuicao/motor.ts`). Aqui só
 * acontecem três coisas: carregar o estado, chamar o motor, gravar em transação.
 *
 * `previa` e `confirmar` chamam EXATAMENTE a mesma função de planejamento —
 * o que o operador vê na tela é literalmente o que vai ser gravado. Nenhuma
 * chance de a prévia e a gravação divergirem.
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
 * Monta o plano do dia sem gravar nada.
 *
 * O backlog entra sozinho: a fila é "tudo que está aprovado e ainda não foi
 * distribuído", não "o que chegou hoje". Isso encerra RN-10 e RN-11 — os dois
 * carry-overs que hoje são redigitação manual e quebram em ~10% dos dias.
 */
export async function planejar(
  banco: Banco | Transacao,
  pedido: PedidoDistribuicao,
): Promise<PlanoCategoria[]> {
  const categorias = await carregarCategorias(banco, pedido.categorias)
  const planos: PlanoCategoria[] = []

  // Corte temporal: a fila do dia é "aprovado E já recebido até o fim deste
  // dia". O backlog de ontem entra; o e-mail que só chega depois de amanhã,
  // não. Sem este corte, distribuir a data de hoje varreria o futuro inteiro.
  const fimDoDia = new Date(`${pedido.data}T23:59:59.999Z`)

  for (const categoria of categorias) {
    const itens = await banco.item.findMany({
      where: {
        categoriaId: categoria.id,
        status: 'aprovado',
        OR: [
          { email: { recebidoEm: { lte: fimDoDia } } },
          { emailId: null, criadoEm: { lte: fimDoDia } },
        ],
      },
      orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
      select: { id: true },
    })

    if (itens.length === 0) continue

    const elegiveis = await carregarElegiveis(banco, categoria.id, pedido.data)
    const base = {
      categoria,
      quantidade: itens.length,
      itensIds: itens.map((item) => item.id),
    }

    try {
      const resultado = distribuir({
        data: pedido.data,
        categoria,
        quantidade: itens.length,
        elegiveis,
      })
      planos.push({ ...base, resultado, erro: null })
    } catch (erro) {
      // Falha explícita, nunca silenciosa. Sem elegível, o trabalho FICA na fila
      // — que é o oposto do que a planilha faz quando perde 16 itens de LIGA.
      planos.push({ ...base, resultado: null, erro: mensagemDoErro(erro) })
    }
  }

  return planos
}

export async function previa(
  banco: Banco,
  pedido: PedidoDistribuicao,
): Promise<RelatorioDistribuicao> {
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
): Promise<RelatorioDistribuicao> {
  const correlacaoId = novaCorrelacao()
  const inicio = Date.now()

  await registrarEvento(banco, {
    correlacaoId,
    etapa: 'distribuicao',
    situacao: 'iniciado',
    referencia: pedido.data,
  })

  const relatorio = await banco.$transaction(async (tx) => {
    // Replaneja DENTRO da transação: o estado pode ter mudado entre a prévia
    // que o operador viu e o clique em confirmar.
    const planos = await planejar(tx, pedido)
    let rodadasGravadas = 0
    let totalDistribuido = 0

    for (const plano of planos) {
      if (!plano.resultado) continue
      await gravarRodada(tx, plano, pedido, correlacaoId)
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
  pedido: PedidoDistribuicao,
  correlacaoId: string,
): Promise<void> {
  const resultado = plano.resultado!

  const rodada = await tx.rodadaDistribuicao.create({
    data: {
      data: pedido.data,
      categoriaId: plano.categoria.id,
      quantidadeEntrada: resultado.quantidadeEntrada,
      algoritmoVersao: ALGORITMO_VERSAO,
      criterio: resultado.criterio,
      base: resultado.base,
      resto: resultado.resto,
      cotaJusta: resultado.cotaJusta,
      elegiveis: serializar(resultado.ordemDesempate),
      ordemDesempate: serializar(resultado.ordemDesempate),
      alocacao: serializar(resultado.alocacao),
      creditoAntes: serializar(resultado.creditoCategoriaAntes),
      creditoDepois: serializar(resultado.creditoCategoriaDepois),
      executadoPor: pedido.executadoPor,
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
          atribuidoPor: pedido.executadoPor,
          ativa: true,
        },
      })
      await tx.item.update({ where: { id: itemId }, data: { status: 'distribuido' } })
      atribuidos += 1
    }

    await atualizarSaldos(tx, {
      colaboradorId,
      categoriaId: plano.categoria.id,
      data: pedido.data,
      recebido: cota,
      pesoCategoria: plano.categoria.peso,
      cotaJusta: resultado.cotaJusta,
      creditoCategoria: resultado.creditoCategoriaDepois[colaboradorId] ?? 0,
      // O crédito GLOBAL soma o delta em vez de gravar o valor absoluto.
      // Numa mesma confirmação, várias categorias escrevem na MESMA linha de
      // SaldoCargaGlobal; todas leram o estado anterior à transação, então
      // gravar o absoluto faria a última categoria apagar o efeito das outras.
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
      usuario: pedido.executadoPor,
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
      cotaJusta: entrada.cotaJusta,
      creditoAcumulado: entrada.creditoCategoria,
    },
    update: {
      recebido: { increment: entrada.recebido },
      cotaJusta: entrada.cotaJusta,
      creditoAcumulado: entrada.creditoCategoria,
    },
  })

  await tx.saldoCargaGlobal.upsert({
    where: {
      colaboradorId_data: { colaboradorId: entrada.colaboradorId, data: entrada.data },
    },
    // Primeira categoria do dia: abre a linha com o crédito herdado de ontem
    // mais o delta de agora. As seguintes só incrementam.
    create: {
      colaboradorId: entrada.colaboradorId,
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
 */
async function carregarElegiveis(
  banco: Banco | Transacao,
  categoriaId: string,
  data: string,
): Promise<Elegivel[]> {
  const habilitacoes = await banco.habilitacao.findMany({
    where: {
      categoriaId,
      podeReceber: true,
      vigenciaInicio: { lte: new Date(`${data}T23:59:59.999Z`) },
      OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: new Date(`${data}T00:00:00.000Z`) } }],
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
        where: { colaboradorId: escala.colaboradorId, data: { lte: data } },
        orderBy: { data: 'desc' },
        select: { creditoGlobal: true },
      }),
      banco.saldoCarga.aggregate({
        where: {
          colaboradorId: escala.colaboradorId,
          categoriaId,
          data: { gte: inicioDoMes(data), lte: data },
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
      creditoGlobal: saldoGlobal?.creditoGlobal ?? 0,
      recebidoPeriodo: doMes._sum.recebido ?? 0,
      recebidoDia: doDia?.recebido ?? 0,
      capacidadeRelativa: escala.capacidadeRelativa,
    })
  }

  return elegiveis
}
