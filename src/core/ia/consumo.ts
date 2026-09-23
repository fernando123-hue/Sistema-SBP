/**
 * Consumo da IA: teto diário e disjuntor — domínio puro.
 *
 * ═══ O PROBLEMA QUE ISTO RESOLVE (achado C-06, decisão `A54`) ═══
 *
 * Até aqui, o único freio da IA era o limite de taxa por pessoa. Medido na
 * auditoria de 17/09/2026: quando o fornecedor cai (429, 503, 529) ou o
 * crédito acaba no meio de uma sincronização de 200 e-mails, o laço não para —
 * ele erra os 200, um a um, e cada um pode gerar até três requisições e
 * esperar dois minutos. Uma queda passageira vira horas de espera e uma conta
 * paga por nada. E não havia nenhum lugar que soubesse dizer *quanto* a IA foi
 * usada hoje.
 *
 * Duas travas, com papéis diferentes e propositalmente separadas:
 *
 *   **teto diário** — quanto se aceita gastar por dia. Dura o dia inteiro, é
 *   contado no banco (sobrevive a reinício) e protege a conta.
 *
 *   **disjuntor** — o fornecedor está fora do ar AGORA. Dura minutos, mora na
 *   memória do processo e protege o tempo da equipe: depois de N falhas
 *   seguidas, parar de tentar é a resposta certa, e tentar de novo daqui a
 *   pouco também.
 *
 * ═══ POR QUE NADA AQUI SABE O QUE É UM E-MAIL ═══
 *
 * É aritmética de estado, sem banco, sem relógio próprio e sem fornecedor: o
 * `agora` entra por parâmetro. É o que permite testar um disjuntor de cinco
 * minutos sem esperar cinco minutos, e o que mantém a regra legível quando
 * alguém precisar explicar por que o sistema parou de chamar o modelo.
 */

export interface LimitesDeConsumo {
  /** Chamadas por dia, por fornecedor. **Zero significa sem teto.** */
  tetoDiarioDeChamadas: number
  /** Falhas de transporte SEGUIDAS que abrem o disjuntor. */
  falhasParaAbrir: number
  /** Quanto tempo ele fica aberto antes de deixar uma chamada de prova passar. */
  minutosAberto: number
}

/**
 * Os números padrão, e de onde eles vêm.
 *
 * `500` chamadas por dia: a operação real da secretaria é da ordem de dezenas
 * de e-mails por dia (`CONTEXTO.md`), e uma sincronização vai a 200 (`AT-35`).
 * Quinhentas dão folga para reprocessamento e para o assistente, e ainda assim
 * transformam um laço enlouquecido em um dia caro, não num mês caro.
 *
 * `5` falhas seguidas: menos que isso confundiria um e-mail difícil com
 * fornecedor fora do ar; muito mais e o lote inteiro já teria fracassado.
 *
 * `10` minutos: tempo típico de um incidente passageiro de fornecedor. Quem
 * estiver esperando clica sincronizar de novo e a chamada de prova sai.
 */
export const LIMITES_PADRAO: LimitesDeConsumo = {
  tetoDiarioDeChamadas: 500,
  falhasParaAbrir: 5,
  minutosAberto: 10,
}

export interface EstadoDoDisjuntor {
  falhasSeguidas: number
  /** Enquanto `agora` for menor que isto, ninguém chama o fornecedor. */
  abertoAte: Date | null
}

export const DISJUNTOR_FECHADO: EstadoDoDisjuntor = { falhasSeguidas: 0, abertoAte: null }

export type MotivoDeImpedimento = 'teto_diario' | 'disjuntor_aberto'

export interface ImpedimentoDeChamada {
  motivo: MotivoDeImpedimento
  /** Texto para quem estiver na tela. Nunca carrega conteúdo de e-mail. */
  mensagem: string
}

export function impedimentoParaChamar(entrada: {
  estado: EstadoDoDisjuntor
  /**
   * Quantas chamadas hoje — ou `null` quando **não foi possível contar**.
   *
   * `null` não é zero, e a distinção é o ponto. A contagem mora no banco; se
   * ele estiver fora, passar `0` mentiria dizendo "nenhuma chamada hoje" e o
   * teto nasceria zerado em silêncio, que é o defeito que `IA_TETO_DIARIO`
   * vazio já causou uma vez (`AT-38`). Dizer "não sei" deixa a decisão
   * explícita aqui embaixo, onde ela pode ser lida.
   */
  chamadasHoje: number | null
  agora: Date
  limites: LimitesDeConsumo
}): ImpedimentoDeChamada | null {
  const { estado, chamadasHoje, agora, limites } = entrada

  // O teto vem primeiro porque dura o dia inteiro: dizer "o fornecedor caiu"
  // a quem estourou a conta mandaria a pessoa esperar por uma coisa que não
  // vai acontecer.
  //
  // CONTAGEM DESCONHECIDA NÃO IMPEDE (decisão do dono, 23/09/2026 — `AT-42`):
  // o teto protege a conta do mês; o banco fora protege nada e pararia o
  // trabalho inteiro.
  //
  // ENQUANTO A CONTAGEM NÃO VOLTA, NADA LIMITA O GASTO — e é preciso dizer
  // isso aqui, onde alguém lê. O disjuntor abaixo NÃO cobre este caso: ele só
  // conta falha de TRANSPORTE, e `aposChamada` zera a contagem a cada
  // sucesso. Fornecedor saudável respondendo normalmente com a contagem
  // ilegível = chamadas sem teto, e o disjuntor nunca abre. O que limita nesse
  // intervalo é o orçamento do próprio fornecedor (achado MÉDIO da revisão
  // técnica do PR #86; risco aceito e escrito em `AT-42`).
  //
  // ═══ ESTA GUARDA É CLAREZA, NÃO COMPORTAMENTO — e é honesto dizer ═══
  //
  // `null >= 500` já é `false` em JavaScript (o `null` é coagido a zero), e
  // `undefined >= 500` também. Ou seja: sem guarda nenhuma, o resultado seria
  // o mesmo. O que ela compra é impedir que uma edição futura — um `?? 0`, um
  // `Number(...)` — transforme "não sei" em "nenhuma chamada hoje" sem que
  // ninguém perceba, que é exatamente a armadilha do `IA_TETO_DIARIO` vazio do
  // `AT-38`. `typeof === 'number'` em vez de `!== null` pela mesma razão: pega
  // `undefined` junto. A correção de COMPORTAMENTO deste PR está no adapter,
  // não aqui (achado MÉDIO da revisão técnica do PR #86: o "teste visto
  // vermelho" original alegava o contrário para estes dois casos).
  if (
    typeof chamadasHoje === 'number' &&
    limites.tetoDiarioDeChamadas > 0 &&
    chamadasHoje >= limites.tetoDiarioDeChamadas
  ) {
    return {
      motivo: 'teto_diario',
      mensagem:
        `o teto diário de ${limites.tetoDiarioDeChamadas} chamadas à IA foi atingido ` +
        `(${chamadasHoje} hoje). A contagem zera amanhã; para mudar o teto, IA_TETO_DIARIO.`,
    }
  }

  if (estado.abertoAte && agora < estado.abertoAte) {
    return {
      motivo: 'disjuntor_aberto',
      mensagem:
        `a IA falhou ${estado.falhasSeguidas} vezes seguidas e as chamadas estão suspensas até ` +
        `${estado.abertoAte.toISOString()}. Tente de novo depois desse horário.`,
    }
  }

  return null
}

/**
 * O estado do disjuntor depois de uma chamada.
 *
 * Sucesso fecha de vez — inclusive a chamada de prova de um disjuntor que
 * acabou de vencer. Falha soma; ao chegar em `falhasParaAbrir`, abre. Como a
 * contagem NÃO zera ao vencer o prazo, a chamada de prova que falha reabre na
 * hora, sem gastar outras N tentativas: é o que diferencia meia-abertura de
 * "reinício a cada dez minutos".
 */
export function aposChamada(
  estado: EstadoDoDisjuntor,
  resultado: 'ok' | 'falha',
  agora: Date,
  limites: LimitesDeConsumo,
): EstadoDoDisjuntor {
  if (resultado === 'ok') return DISJUNTOR_FECHADO

  const falhasSeguidas = estado.falhasSeguidas + 1
  const abre = falhasSeguidas >= limites.falhasParaAbrir
  return {
    falhasSeguidas,
    abertoAte: abre ? new Date(agora.getTime() + limites.minutosAberto * 60_000) : null,
  }
}
