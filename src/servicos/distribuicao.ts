import { ALGORITMO_VERSAO, distribuir } from '../core/distribuicao/motor'
import { narrarRodada } from '../core/distribuicao/narrativa'
import { ConservacaoVioladaError, ErroDeNegocio, SemElegiveisError } from '../core/erros'
import {
  FrenteSchema,
  GrupoSchema,
  serializar,
  type PedidoDistribuicao,
} from '../core/esquemas'
import { lerDoBanco } from '../core/lido-do-banco'
import type {
  Categoria,
  Elegivel,
  GrupoIndivisivel,
  ResultadoRodada,
} from '../core/tipos'
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
  /**
   * Os mesmos itens de `itensIds`, com o vínculo de liga.
   *
   * `itensIds` sozinho bastava enquanto a entrega era por quantidade. Com o
   * `A4` a entrega passou a seguir o LOTE, e o lote é definido pelo `ligaId` —
   * então quem grava precisa saber a que liga cada item pertence, não só
   * quantos itens existem. Ver `repartirItens`.
   */
  itens: { id: string; ligaId: string | null }[]
  resultado: ResultadoRodada | null
  erro: string | null
}

export interface RelatorioDistribuicao {
  correlacaoId: string
  data: string
  planos: PlanoCategoria[]
  totalDistribuido: number
  rodadasGravadas: number
  /**
   * O que foi feito, como e por quê, em português (`A6`).
   *
   * Vem do snapshot que o motor acabou de produzir — nada aqui é recalculado.
   * Ver `core/distribuicao/narrativa.ts`.
   */
  narrativas: NarrativaDeCategoria[]
  /**
   * Categorias ativas cujo cadastro no banco traz valor fora do domínio
   * (`frente` ou `grupo`), e por isso ficaram FORA desta rodada.
   *
   * Antes, uma única linha assim fazia `lerDoBanco` lançar dentro do `.map()` de
   * `carregarCategorias`, e a prévia e a confirmação de TODAS as categorias do
   * dia falhavam juntas. Agora a inválida sai nomeada, na tela e no evento, e as
   * demais seguem. Revisão do PR #36; `DECISOES.md § AT-15`.
   */
  categoriasInvalidas: CategoriaInvalida[]
}

export interface CategoriaInvalida {
  codigo: string
  motivo: string
}

export interface NarrativaDeCategoria {
  categoriaCodigo: string
  rotulo: string
  linhas: string[]
}

/**
 * Escreve a narrativa de cada plano.
 *
 * FORA da transação de propósito. A busca de nomes é uma consulta a mais, e
 * `confirmar` segura a trava do dia enquanto a transação estiver aberta —
 * enfiar leitura de conveniência ali dentro alarga a janela em que ninguém
 * mais consegue distribuir, para produzir texto que ninguém lê antes do fim.
 */
async function narrar(banco: Banco, planos: PlanoCategoria[]): Promise<NarrativaDeCategoria[]> {
  const ids = [
    ...new Set(planos.flatMap((plano) => plano.resultado?.ordemDesempate ?? [])),
  ]
  if (ids.length === 0) return []

  const pessoas = await banco.colaborador.findMany({
    where: { id: { in: ids } },
    select: { id: true, nome: true },
  })
  const nomes = new Map(pessoas.map((pessoa) => [pessoa.id, pessoa.nome]))
  // Cai no id quando o nome não vier: narrativa incompleta é melhor que
  // narrativa ausente, e some-nome é problema de leitura, não de decisão.
  const nomeDe = (id: string): string => nomes.get(id) ?? id

  return planos
    .filter((plano) => plano.resultado !== null)
    .map((plano) => ({
      categoriaCodigo: plano.categoria.codigo,
      rotulo: plano.categoria.rotulo,
      linhas: narrarRodada(plano.resultado!, plano.categoria.rotulo, nomeDe),
    }))
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
    select: { id: true, ligaId: true },
  })

  if (itens.length === 0) return null

  const elegiveis = await carregarElegiveis(
    banco,
    categoria.id,
    data,
    categoria.frente,
    ajusteGlobal,
  )
  const base = {
    categoria,
    quantidade: itens.length,
    itensIds: itens.map((item) => item.id),
    itens,
  }

  try {
    const resultado = distribuir({
      data,
      categoria,
      quantidade: itens.length,
      elegiveis,
      // Só as categorias que agrupam recebem grupos. Nas demais o campo fica
      // ausente e o motor se comporta exatamente como sempre.
      ...(categoria.agrupaPorLiga ? { grupos: agruparPorLiga(itens) } : {}),
    })
    return { ...base, resultado, erro: null }
  } catch (erro) {
    // SÓ "ninguém de plantão" vira resultado. Todo o resto sobe.
    //
    // Sem elegível é situação de OPERAÇÃO: o trabalho fica na fila e a tela
    // diz por categoria o que aconteceu — o oposto do que a planilha faz
    // quando perde 16 itens de LIGA.
    //
    // Os outros erros que `distribuir` pode lançar são DEFEITO, e um deles é
    // `ConservacaoVioladaError` — a trava que materializa o invariante nº 3,
    // o único que o `CLAUDE.md` descreve como razão de o sistema existir.
    // Capturá-la aqui a rebaixava a uma linha de log de nível `aviso`,
    // indistinguível de um dia sem escala, e a categoria inteira era pulada
    // com os itens presos na fila. A trava existe para gritar; engolir o
    // grito é pior do que não ter trava, porque dá a impressão de que há uma.
    if (erro instanceof SemElegiveisError) {
      return { ...base, resultado: null, erro: mensagemDoErro(erro) }
    }
    throw erro
  }
}

/**
 * Monta os lotes que não se separam (`A4`).
 *
 * A UNIDADE É `(liga, dia)`, NÃO `(liga, e-mail)` — decisão `A4.1`. Esta função
 * recebe os itens do dia inteiro para a categoria, então dois e-mails da mesma
 * liga no mesmo dia caem no mesmo grupo naturalmente: é o agrupamento por
 * `ligaId` que faz isso, sem precisar saber de e-mail nenhum.
 *
 * Entre DIAS não há vínculo: cada rodada monta os grupos do zero e a escolha é
 * de quem está mais credor naquele momento. É o que impede a liga de ficar
 * presa a uma pessoa, que o `A4` descarta explicitamente.
 *
 * Item SEM liga vira grupo de um item só — indivisível por definição, e
 * portanto neutro. A chave leva o id do item para não colidir com outra.
 */
/**
 * A chave do lote de um item. Uma definição só, usada nos dois lados.
 *
 * Existe como função porque a chave é montada duas vezes — ao formar os grupos
 * para o motor e ao devolver os itens de cada grupo na hora de gravar. Duas
 * cópias da mesma regra de nomeação divergiriam em silêncio, e a divergência
 * apareceria como liga partida, sem erro nenhum.
 */
function chaveDoLote(item: { id: string; ligaId: string | null }): string {
  // `item:` e `liga:` são prefixos de espaço de nomes: sem eles, um id de
  // item igual a um id de liga fundiria dois grupos que não têm relação.
  return item.ligaId === null ? `item:${item.id}` : `liga:${item.ligaId}`
}

/**
 * Que itens concretos vão para cada pessoa.
 *
 * Dois modos, e a escolha é do critério da rodada:
 *
 * - `por_grupo`: cada lote vai INTEIRO para quem o motor escolheu. É o `A4`.
 * - todos os demais: fatia posicional na ordem de desempate, como sempre foi —
 *   quando a decisão é por quantidade, qualquer conjunto de N itens serve, e a
 *   ordem por `criadoEm` entrega os mais antigos primeiro (`A7`).
 */
function repartirItens(
  plano: PlanoCategoria,
  resultado: ResultadoRodada,
): Map<string, string[]> {
  const porDono = new Map<string, string[]>()

  const donoDoGrupo = resultado.atribuicaoDeGrupos
  if (donoDoGrupo) {
    for (const item of plano.itens) {
      const dono = donoDoGrupo[chaveDoLote(item)]
      // Item sem dono seria item perdido — a doença que o sistema cura. A
      // conferência de tamanho no chamador o transformaria em erro de qualquer
      // jeito; aqui a mensagem diz o que de fato aconteceu.
      if (!dono) {
        throw new ErroDeNegocio(
          `O item "${item.id}" não pertence a nenhum lote da rodada. ` +
            'A distribuição foi abortada: nenhum item pode ficar sem responsável.',
        )
      }
      const fatia = porDono.get(dono) ?? []
      fatia.push(item.id)
      porDono.set(dono, fatia)
    }
    return porDono
  }

  let cursor = 0
  for (const colaboradorId of resultado.ordemDesempate) {
    const cota = resultado.alocacao[colaboradorId] ?? 0
    porDono.set(colaboradorId, plano.itensIds.slice(cursor, cursor + cota))
    cursor += cota
  }
  return porDono
}

function agruparPorLiga(itens: readonly { id: string; ligaId: string | null }[]): GrupoIndivisivel[] {
  const porLiga = new Map<string, number>()

  for (const item of itens) {
    // A MESMA função que `repartirItens` usa para achar o dono do item. Duas
    // cópias da regra de nomeação divergiriam em silêncio, e a divergência
    // apareceria como liga partida — sem erro nenhum.
    porLiga.set(chaveDoLote(item), (porLiga.get(chaveDoLote(item)) ?? 0) + 1)
  }

  return [...porLiga].map(([chave, tamanho]) => ({ chave, tamanho }))
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
): Promise<PlanoDoDia> {
  const { categorias, invalidas } = await carregarCategorias(banco, pedido.categorias)
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

  return { planos, categoriasInvalidas: invalidas }
}

/** O plano do dia: o que dá para distribuir, e o que ficou de fora por cadastro inválido. */
export interface PlanoDoDia {
  planos: PlanoCategoria[]
  categoriasInvalidas: CategoriaInvalida[]
}

export async function previa(
  banco: Banco,
  pedido: PedidoDistribuicao,
  ator: Ator,
): Promise<RelatorioDistribuicao> {
  exigirPapel(ator, 'ver prévia da distribuição', 'operador', 'gestor')
  const { planos, categoriasInvalidas } = await planejar(banco, pedido)

  return {
    correlacaoId: 'previa',
    data: pedido.data,
    planos,
    totalDistribuido: somar(planos.map((plano) => (plano.resultado ? plano.quantidade : 0))),
    rodadasGravadas: 0,
    // A narrativa acompanha a PRÉVIA também, e não só a confirmação: ler o
    // porquê antes de gravar é o que a torna útil para conferir. Depois de
    // confirmado, ela vira registro; antes, é revisão.
    narrativas: await narrar(banco, planos),
    categoriasInvalidas,
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
    const { planos, categoriasInvalidas } = await planejar(tx, pedido)
    let rodadasGravadas = 0
    let totalDistribuido = 0

    for (const plano of planos) {
      if (!plano.resultado) continue
      await gravarRodada(tx, plano, pedido.data, ator, correlacaoId)
      rodadasGravadas += 1
      totalDistribuido += plano.quantidade
    }

    // Sai da transação SEM a narrativa: ela é leitura de conveniência e não
    // pode alargar a janela em que a trava do dia está segurada. Ver `narrar`.
    return {
      correlacaoId,
      data: pedido.data,
      planos,
      totalDistribuido,
      rodadasGravadas,
      categoriasInvalidas,
    } satisfies Omit<RelatorioDistribuicao, 'narrativas'>
  })

  const comErro = relatorio.planos.filter((plano) => plano.erro)
  if (comErro.length > 0) {
    registrarLog('aviso', 'categorias não distribuídas', {
      correlacaoId,
      data: pedido.data,
      categorias: comErro.map((plano) => `${plano.categoria.codigo}: ${plano.erro}`),
    })
  }

  const invalidas = relatorio.categoriasInvalidas
  const ficouAlgoDeFora = comErro.length > 0 || invalidas.length > 0

  await registrarEvento(banco, {
    correlacaoId,
    etapa: 'distribuicao',
    situacao: ficouAlgoDeFora ? 'reprocessavel' : 'sucesso',
    referencia: pedido.data,
    mensagem: `${relatorio.rodadasGravadas} rodadas · ${relatorio.totalDistribuido} itens`,
    // QUAIS categorias falharam, não só que alguma falhou.
    //
    // O aviso acima vai para stdout, que roda e some. O evento dizia apenas
    // "N rodadas · M itens", então "quais categorias ficaram sem distribuir na
    // semana passada, e por quê?" exigia ter o terminal do servidor guardado.
    // Aqui o motivo fica na memória do sistema, junto do dia — inclusive o de
    // categoria que ficou de fora por cadastro inválido no banco.
    ...(ficouAlgoDeFora
      ? {
          detalhe: {
            ...(comErro.length > 0
              ? {
                  naoDistribuidas: comErro.map((plano) => ({
                    categoria: plano.categoria.codigo,
                    motivo: plano.erro,
                  })),
                }
              : {}),
            ...(invalidas.length > 0 ? { categoriasInvalidas: invalidas } : {}),
          },
        }
      : {}),
    duracaoMs: Date.now() - inicio,
  })

  return { ...relatorio, narrativas: await narrar(banco, relatorio.planos) }
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

  // Reparte os itens CONCRETOS. A planilha diz "Paulo: 24"; aqui fica
  // registrado QUAIS 24.
  //
  // ═══ QUANDO O MOTOR DECIDIU POR LOTE, A FATIA POSICIONAL ESTAVA ERRADA ═══
  //
  // Este laço fatiava `plano.itensIds` por posição — `slice(cursor, cursor +
  // cota)` — sobre uma lista ordenada por `criadoEm`. Para o rateio por
  // quantidade isso é correto: qualquer conjunto de N itens serve.
  //
  // Para o `A4` não era. O motor escolhe por LOTE ("a liga X inteira vai para
  // a Ana"), e o corte por posição só devolveria a liga inteira por acaso — se
  // os e-mails das duas ligas tivessem chegado sem se intercalar. Com duas
  // ligas intercaladas no tempo, a Ana levava as cinco PRIMEIRAS linhas, que
  // eram três de uma liga e duas de outra: a liga era partida entre pessoas,
  // que é exatamente o que o `A4` existe para impedir.
  //
  // E nada acusava. A soma continuava fechando, então a trava de conservação
  // — que só olha a soma — passava; a rodada gravava a alocação correta em
  // número; e a divergência aparecia só na mesa de quem atendia a liga.
  //
  // Agora, quando o motor decidiu por lote, a entrega segue o lote.
  const itensPorDono = repartirItens(plano, resultado)

  let atribuidos = 0

  for (const colaboradorId of resultado.ordemDesempate) {
    const cota = resultado.alocacao[colaboradorId] ?? 0
    const fatia = itensPorDono.get(colaboradorId) ?? []

    // A entrega concreta tem de bater com a decisão. Divergir aqui significaria
    // gravar uma alocação que o snapshot da rodada não explica.
    if (fatia.length !== cota) {
      throw new ConservacaoVioladaError(cota, fatia.length, resultado.alocacao)
    }

    // ═══ EM LOTE, NÃO ITEM A ITEM ═══
    //
    // Eram `atribuicao.create` + `item.update` por item, em sequência, com a
    // trava do dia segurada: 124 das ~288 consultas de uma confirmação típica, e
    // justamente a metade que cresce com o volume da associação. ~15 ms em
    // SQLite; ~0,9 s de trava por confirmação em PostgreSQL com 3 ms de RTT.
    // Achado 2 da auditoria de 08/09/2026.
    //
    // A conferência fica MAIS forte, não mais fraca: passa a comparar o que o
    // banco confirmou ter escrito. E o `updateMany` só marca item que ainda está
    // na fila (`aprovado`/`devolvido`, o mesmo corte de `planejarCategoria`) —
    // um item que tivesse mudado de estado dá contagem divergente e a transação
    // inteira volta atrás, em vez de ser redistribuído por cima.
    if (fatia.length > 0) {
      const gravadas = await tx.atribuicao.createMany({
        data: fatia.map((itemId) => ({
          itemId,
          colaboradorId,
          rodadaId: rodada.id,
          motivo: 'algoritmo',
          atribuidoPor: ator.colaboradorId,
          ativa: true,
        })),
      })
      const marcados = await tx.item.updateMany({
        where: { id: { in: fatia }, status: { in: ['aprovado', 'devolvido'] } },
        data: { status: 'distribuido' },
      })

      if (gravadas.count !== fatia.length || marcados.count !== fatia.length) {
        throw new Error(
          `Conservação violada ao gravar: fatia de ${fatia.length} itens, ` +
            `${gravadas.count} atribuições gravadas, ${marcados.count} itens marcados, ` +
            `categoria ${plano.categoria.codigo}.`,
        )
      }
      atribuidos += gravadas.count
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
      deltaCreditoCategoria:
        (resultado.creditoCategoriaDepois[colaboradorId] ?? 0) -
        (resultado.creditoCategoriaAntes[colaboradorId] ?? 0),
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
    /** Movimento do crédito DE CATEGORIA nesta rodada. Propaga para os dias seguintes. */
    deltaCreditoCategoria: number
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

  // ═══ O CRÉDITO GLOBAL É UM TOTAL CORRIDO, E TOTAL CORRIDO PRECISA PROPAGAR ═══
  //
  // `carregarElegiveis` lê o crédito global pegando a linha MAIS RECENTE com
  // `data <= data` — ou seja, cada linha guarda o acumulado até aquele dia, não
  // o movimento do dia.
  //
  // Enquanto os dias forem distribuídos em ordem, isso funciona: cada nova
  // linha nasce de `creditoGlobalAnterior + delta`. Distribuir uma data
  // ANTERIOR a outra já distribuída quebrava a cadeia — a linha retroativa
  // nascia certa, e as linhas dos dias seguintes continuavam com o valor que
  // tinham antes, calculado sem ela. A partir daí toda leitura para uma data
  // posterior pegava uma dessas linhas, e o efeito da rodada retroativa
  // simplesmente não existia para o desempate. Nenhum erro, nenhum aviso: o
  // razão que sustenta a justiça do rateio passava a afirmar um equilíbrio que
  // não era verdade.
  //
  // Distribuir fora de ordem é operação legítima — sexta-feira esquecida,
  // feriado processado depois. A correção é propagar, não proibir.
  //
  // No caminho normal (dia mais recente) não existe linha posterior e este
  // `updateMany` não toca em nada.
  if (entrada.deltaCreditoGlobal !== 0) {
    await tx.saldoCargaGlobal.updateMany({
      where: {
        colaboradorId: entrada.colaboradorId,
        escopo: entrada.escopo,
        data: { gt: entrada.data },
      },
      data: { creditoGlobal: { increment: entrada.deltaCreditoGlobal } },
    })
  }

  // ═══ O CRÉDITO DE CATEGORIA TAMBÉM É TOTAL CORRIDO ═══
  //
  // A propagação acima nasceu só para o global, e a revisão do PR #35 pegou a
  // metade que faltou: `carregarElegiveis` lê `SaldoCarga.creditoAcumulado`
  // exatamente do mesmo jeito — a linha mais recente com `data <= data` —, e é
  // ele o critério PRIMÁRIO do desempate. Distribuir o dia 1 depois do dia 2
  // deixava a linha do dia 2 sem o efeito do dia 1, e todo desempate dali em
  // diante decidia com a categoria desatualizada, sem erro nenhum.
  //
  // A linha do próprio dia continua gravada absoluta, como vem do motor; o que
  // vai para as linhas posteriores é o MOVIMENTO desta rodada.
  if (entrada.deltaCreditoCategoria !== 0) {
    await tx.saldoCarga.updateMany({
      where: {
        colaboradorId: entrada.colaboradorId,
        categoriaId: entrada.categoriaId,
        data: { gt: entrada.data },
      },
      data: { creditoAcumulado: { increment: entrada.deltaCreditoCategoria } },
    })
  }
}

// ─── Carregamento de estado ──────────────────────────────────

async function carregarCategorias(
  banco: Banco | Transacao,
  codigos: readonly string[],
): Promise<{ categorias: Categoria[]; invalidas: CategoriaInvalida[] }> {
  const registros = await banco.categoria.findMany({
    where: {
      ativa: true,
      entraNoRateio: true,
      ...(codigos.length > 0 ? { codigo: { in: [...codigos] } } : {}),
    },
    orderBy: { ordem: 'asc' },
  })

  const categorias: Categoria[] = []
  const invalidas: CategoriaInvalida[] = []

  for (const registro of registros) {
    // ═══ UMA LINHA RUIM NÃO DERRUBA O DIA ═══
    //
    // `lerDoBanco` falha alto com valor fora do domínio, e é o certo: um
    // `'CADASTROS'` semeado à mão em `frente` viraria `SaldoCargaGlobal.escopo`
    // e abriria um segundo razão global calado. Mas lançado dentro de um
    // `.map()` sobre a lista inteira, levava junto a prévia e a confirmação de
    // TODAS as categorias do dia. A inválida sai daqui nomeada — no log, na
    // tela e no evento da rodada —, e as demais seguem. `DECISOES.md § AT-15`.
    try {
      categorias.push({
        id: registro.id,
        codigo: registro.codigo,
        rotulo: registro.rotulo,
        frente: lerDoBanco(FrenteSchema, registro.frente, `Categoria.frente (${registro.codigo})`),
        grupo: lerDoBanco(GrupoSchema, registro.grupo, `Categoria.grupo (${registro.codigo})`),
        divisivel: registro.divisivel,
        peso: registro.peso,
        agrupaPorLiga: registro.agrupaPorLiga,
        limiarIndivisivel: registro.limiarIndivisivel,
        entraNoRateio: registro.entraNoRateio,
      })
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro)
      registrarLog('erro', 'categoria com cadastro inválido ficou fora da distribuição', {
        codigo: registro.codigo,
        motivo,
      })
      invalidas.push({ codigo: registro.codigo, motivo })
    }
  }

  return { categorias, invalidas }
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

  // AFASTAMENTO MANDA MAIS QUE ESCALA (`A10`).
  //
  // As duas respondem perguntas diferentes: a escala diz quem está de plantão
  // hoje — decisão diária do operador —, o afastamento diz quem está fora num
  // PERÍODO, declarado uma vez. Sem esta consulta, quem entrou de férias
  // continuaria recebendo trabalho por qualquer dia em que a escala tivesse
  // ficado marcada, e o item só apareceria como parado dias depois.
  //
  // `fim: null` é ausência em aberto: cobre a data enquanto ninguém encerrar.
  // Cancelado não conta — ausência que não aconteceu não tira ninguém do
  // rateio, mas fica registrada (ver o modelo).
  const afastados = await banco.afastamento.findMany({
    where: {
      colaboradorId: { in: candidatos },
      canceladoEm: null,
      inicio: { lte: data },
      OR: [{ fim: null }, { fim: { gte: data } }],
    },
    select: { colaboradorId: true },
  })
  const estaAfastado = new Set(afastados.map((afastamento) => afastamento.colaboradorId))

  const elegiveis: Elegivel[] = []

  for (const escala of escalas) {
    // O crédito de quem está afastado CONGELA por consequência, não por
    // mecanismo: crédito só muda para quem entra numa rodada, e quem sai aqui
    // não entra. Somado à janela deslizante de 30 dias (`A9`), quem volta de
    // férias não retorna como credor gigante levando tudo.
    if (estaAfastado.has(escala.colaboradorId)) continue
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
