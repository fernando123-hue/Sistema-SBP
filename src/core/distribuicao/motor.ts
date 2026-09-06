import {
  CategoriaForaDoRateioError,
  ConservacaoVioladaError,
  ElegiveisInvalidosError,
  QuantidadeInvalidaError,
  SemElegiveisError,
} from '../erros'
import type {
  ColaboradorId,
  CriterioRodada,
  GrupoIndivisivel,
  Elegivel,
  EntradaRodada,
  ResultadoRodada,
} from '../tipos'
import { ehInteiroNaoNegativo, somar } from '../util/numero'
import { ordenarElegiveis } from './ordenacao'

/**
 * Versão do algoritmo. Toda rodada persiste este valor.
 * Rodadas antigas continuam reproduzíveis com a versão que as gerou.
 */
export const ALGORITMO_VERSAO = '1.0.0'

/**
 * Motor de distribuição — resto maior com memória de crédito.
 *
 * FUNÇÃO PURA. Sem I/O, sem banco, sem relógio, sem aleatoriedade.
 * Mesma entrada produz exatamente a mesma saída, hoje e daqui a três anos.
 * É isso que torna o painel auditável.
 *
 * O que ele substitui na planilha:
 *   - `Mov. Do dia = B4/J4`, que produz `23,5` e exige correção humana
 *   - `Mov. Extra`, digitado 898 vezes por ano com três intenções misturadas
 *   - a memória humana que decide quem leva o `+0,5` hoje
 *
 * A prévia da tela e a gravação chamam ESTA função. O que o operador vê
 * é literalmente o que será gravado.
 */
export function distribuir(entrada: EntradaRodada): ResultadoRodada {
  const { data, categoria, quantidade, elegiveis } = entrada

  // 1. Validação da entrada — falhar alto, nunca degradar.
  if (!categoria.entraNoRateio) {
    throw new CategoriaForaDoRateioError(categoria.codigo)
  }
  if (!ehInteiroNaoNegativo(quantidade)) {
    throw new QuantidadeInvalidaError(quantidade)
  }
  if (elegiveis.length === 0) {
    throw new SemElegiveisError(categoria.codigo, data)
  }
  garantirIdsUnicos(elegiveis)

  // 2. Ordem determinística. Calculada sempre, inclusive quando Q = 0,
  //    porque a rodada é registrada de qualquer jeito.
  const ordem = ordenarElegiveis(elegiveis)
  const n = ordem.length

  const alocacao = zerar(ordem)
  let criterio: CriterioRodada
  let base = 0
  let resto = 0

  const grupos = entrada.grupos
  if (grupos) garantirGruposCoerentes(grupos, quantidade)

  if (quantidade === 0) {
    // Rodada vazia ainda é rodada: fica o registro de que nada entrou.
    criterio = 'sem_demanda'
  } else if (!categoria.divisivel || quantidade <= categoria.limiarIndivisivel) {
    // RN-05 / RN-07 — lote pequeno ou categoria de dono único vai inteiro
    // para quem está mais credor. Ver DECISOES.md § C1 sobre `<=`.
    criterio = 'indivisivel'
    const primeiro = ordem[0]!
    alocacao[primeiro.colaboradorId] = quantidade
  } else if (categoria.agrupaPorLiga && grupos && grupos.length > 0) {
    // A4 — a liga é a unidade que não se separa.
    //
    // Vem DEPOIS do corte de lote pequeno de propósito: com `Q <= limiar` vale
    // a regra de sempre (tudo para o primeiro). O `A4` permite que ligas
    // diferentes vão para pessoas diferentes; não obriga.
    criterio = 'por_grupo'
    for (const [colaboradorId, quantia] of alocarPorGrupos(grupos, ordem, categoria.peso)) {
      alocacao[colaboradorId] = quantia
    }
  } else {
    // RN-04 — piso para todos, resto inteiro para o topo da ordem.
    // Nunca arredondar. Nunca fracionar um item.
    criterio = 'resto_maior'
    base = Math.floor(quantidade / n)
    resto = quantidade % n

    for (const elegivel of ordem) {
      alocacao[elegivel.colaboradorId] = base
    }
    for (let i = 0; i < resto; i += 1) {
      const contemplado = ordem[i]!.colaboradorId
      alocacao[contemplado] = alocacao[contemplado]! + 1
    }
  }

  // 3. A trava. Sem isto, o sistema teria a mesma doença da planilha.
  const distribuido = somar(Object.values(alocacao))
  if (distribuido !== quantidade) {
    throw new ConservacaoVioladaError(quantidade, distribuido, alocacao)
  }

  // 4. Atualização do crédito, em unidades ponderadas (DECISOES.md § C6).
  //    Quem recebeu menos que a cota justa fica credor e leva a próxima sobra.
  //
  //    PRECISÃO: o crédito é um livro-razão que roda por anos. Arredondar a
  //    cota justa aqui vazaria até `n × 10⁻⁶` por rodada — a soma dos créditos
  //    deixaria de ser zero e o balanceamento derivaria devagar. Por isso o
  //    cálculo é feito em float64 cheio; o arredondamento só acontece na borda
  //    de exibição e persistência. Ver `util/numero.ts`.
  const cotaJusta = quantidade === 0 ? 0 : (quantidade * categoria.peso) / n

  const creditoCategoriaAntes: Record<ColaboradorId, number> = {}
  const creditoCategoriaDepois: Record<ColaboradorId, number> = {}
  const creditoGlobalAntes: Record<ColaboradorId, number> = {}
  const creditoGlobalDepois: Record<ColaboradorId, number> = {}

  for (const elegivel of ordem) {
    const id = elegivel.colaboradorId
    const recebidoPonderado = alocacao[id]! * categoria.peso
    const delta = cotaJusta - recebidoPonderado

    creditoCategoriaAntes[id] = elegivel.creditoCategoria
    creditoGlobalAntes[id] = elegivel.creditoGlobal
    creditoCategoriaDepois[id] = elegivel.creditoCategoria + delta
    creditoGlobalDepois[id] = elegivel.creditoGlobal + delta
  }

  return {
    data,
    categoriaId: categoria.id,
    quantidadeEntrada: quantidade,
    algoritmoVersao: ALGORITMO_VERSAO,
    criterio,
    base,
    resto,
    cotaJusta,
    ordemDesempate: ordem.map((elegivel) => elegivel.colaboradorId),
    // Snapshot completo: é o que permite responder "por que ela levou a sobra?"
    elegiveis: ordem.map((elegivel) => ({ ...elegivel })),
    alocacao,
    creditoCategoriaAntes,
    creditoCategoriaDepois,
    creditoGlobalAntes,
    creditoGlobalDepois,
  }
}

/**
 * Reparte lotes indivisíveis, o maior primeiro (`A4`).
 *
 * Cada grupo vai INTEIRO para quem estiver mais credor naquele instante, e a
 * ordem é recalculada depois de cada entrega — sem isso, o maior credor
 * levaria todos os grupos.
 *
 * "MENOS CARGA ACUMULADA" É LIDO COMO "MAIOR CRÉDITO", e é a decisão de
 * projeto aqui. O `A4` fala em carga; o resto do sistema mede quem está
 * devendo trabalho por crédito (`A2`, `RN-13`). Criar uma segunda definição de
 * "quem é o próximo" produziria dois números que discordam — então a ordem
 * reusa `ordenarElegiveis`, a MESMA de todas as outras rodadas, projetando
 * sobre o crédito o que a pessoa já levou nesta.
 *
 * O empate de tamanho desempata pela chave, para a saída não depender da ordem
 * em que os grupos chegaram.
 */
function alocarPorGrupos(
  grupos: readonly GrupoIndivisivel[],
  elegiveis: readonly Elegivel[],
  peso: number,
): Map<ColaboradorId, number> {
  const recebido = new Map<ColaboradorId, number>(
    elegiveis.map((elegivel) => [elegivel.colaboradorId, 0]),
  )

  const maiorPrimeiro = [...grupos].sort(
    (a, b) => b.tamanho - a.tamanho || (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0),
  )

  for (const grupo of maiorPrimeiro) {
    // Projeção: o crédito que a pessoa TERIA agora, já descontado o que ela
    // levou nesta rodada. É a mesma conta que o passo 4 faz no fim, adiantada.
    const projetados = elegiveis.map((elegivel) => {
      const jaLevou = recebido.get(elegivel.colaboradorId) ?? 0
      return {
        ...elegivel,
        creditoCategoria: elegivel.creditoCategoria - jaLevou * peso,
        creditoGlobal: elegivel.creditoGlobal - jaLevou * peso,
        recebidoDia: elegivel.recebidoDia + jaLevou,
      }
    })

    const alvo = ordenarElegiveis(projetados)[0]!.colaboradorId
    recebido.set(alvo, (recebido.get(alvo) ?? 0) + grupo.tamanho)
  }

  return recebido
}

/**
 * `grupos` REFINA `Q`; não o substitui.
 *
 * Se a soma dos lotes não bater com a quantidade, a rodada distribuiria um
 * número diferente do que entrou — e a trava de conservação pegaria isso
 * depois, já dentro da transação, com uma mensagem sobre o sintoma. Falhar
 * aqui nomeia a causa.
 */
function garantirGruposCoerentes(
  grupos: readonly GrupoIndivisivel[],
  quantidade: number,
): void {
  for (const grupo of grupos) {
    if (!ehInteiroNaoNegativo(grupo.tamanho) || grupo.tamanho < 1) {
      throw new ElegiveisInvalidosError(
        `grupo "${grupo.chave}" tem tamanho inválido (${grupo.tamanho})`,
      )
    }
  }

  const chaves = new Set(grupos.map((grupo) => grupo.chave))
  if (chaves.size !== grupos.length) {
    // Chave repetida significa que o mesmo lote foi montado duas vezes: a soma
    // ainda poderia bater, e a liga seria partida entre duas pessoas — que é
    // exatamente o que o A4 proíbe.
    throw new ElegiveisInvalidosError('há grupos com a mesma chave')
  }

  const somado = somar(grupos.map((grupo) => grupo.tamanho))
  if (somado !== quantidade) {
    throw new ElegiveisInvalidosError(
      `a soma dos grupos (${somado}) não bate com a quantidade da rodada (${quantidade})`,
    )
  }
}

function zerar(elegiveis: readonly Elegivel[]): Record<ColaboradorId, number> {
  const mapa: Record<ColaboradorId, number> = {}
  for (const elegivel of elegiveis) {
    mapa[elegivel.colaboradorId] = 0
  }
  return mapa
}

function garantirIdsUnicos(elegiveis: readonly Elegivel[]): void {
  const vistos = new Set<ColaboradorId>()
  for (const elegivel of elegiveis) {
    if (vistos.has(elegivel.colaboradorId)) {
      throw new ElegiveisInvalidosError(`colaborador "${elegivel.colaboradorId}" aparece duas vezes`)
    }
    vistos.add(elegivel.colaboradorId)
  }
}
