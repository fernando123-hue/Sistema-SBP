import { ErroDeNegocio } from './erros'
import {
  PRAZO_MAXIMO_EM_DIAS,
  PRAZO_MINIMO_EM_DIAS,
  type ChaveDePrazo,
  type TipoDeAfastamentoGravado,
} from './esquemas'
import { deslocarDias } from './util/datas'

/**
 * Retenção — quanto tempo o dado pessoal fica, e quando o relógio corre.
 *
 * Decisões do dono em 11/09/2026 (`DECISOES.md § A17`). Este arquivo é a regra;
 * quem apaga é `servicos/expurgo-lgpd.ts`, e quem guarda o prazo editado é
 * `servicos/retencao.ts`. A fronteira do dia vive AQUI, e só aqui, para que a
 * rotina que apaga e o aviso que diz "expira em tal dia" nunca discordem.
 */

/**
 * O prazo quando o gestor ainda não mudou nada.
 *
 * É decisão, não hipótese: `A17` fixou 7 dias. Por isso a ausência de linha em
 * `PrazoDeRetencao` significa este número — e não um erro.
 */
export const PRAZO_PADRAO_EM_DIAS: Readonly<Record<ChaveDePrazo, number>> = {
  motivo_de_afastamento: 7,
}

/** Um prazo como a tela do gestor o vê. */
export interface PrazoEmVigor {
  chave: ChaveDePrazo
  dias: number
  padrao: number
  /** `null` enquanto ninguém mudou — vale o padrão. */
  alteradoEm: Date | null
  alteradoPorNome: string | null
}

/**
 * Recusa prazo que não é um número inteiro de dias dentro da faixa.
 *
 * O Zod da rota já confere, e isto confere DE NOVO: a rotina que apaga recebe
 * o prazo de quem a chamar, e um `NaN` ou `-30` produziria data de corte no
 * futuro — apagando o motivo de quem voltou ontem. A falha tem de vir antes de
 * qualquer linha ser tocada.
 */
export function exigirPrazoValido(dias: number): void {
  if (!Number.isInteger(dias) || dias < PRAZO_MINIMO_EM_DIAS || dias > PRAZO_MAXIMO_EM_DIAS) {
    throw new ErroDeNegocio(
      `Prazo de retenção inválido: "${dias}". Precisa ser um número inteiro de dias, ` +
        `de ${PRAZO_MINIMO_EM_DIAS} a ${PRAZO_MAXIMO_EM_DIAS}.`,
      'RETENCAO_INVALIDA',
    )
  }
}

/**
 * O que sobra do tipo quando o motivo expira.
 *
 * Férias continua férias porque é agenda, não saúde (a mesma razão de `A13`).
 * Todo o resto vira o MESMO `ausente` — se atestado virasse um rótulo e falta
 * outro, o rótulo que sobrou ainda contaria o motivo.
 */
export function tipoDepoisDoPrazo(tipo: TipoDeAfastamentoGravado): 'ferias' | 'ausente' {
  return tipo === 'ferias' ? 'ferias' : 'ausente'
}

export interface AfastamentoNoRelogio {
  /** Último dia fora, inclusivo. `null` = ainda sem data de volta. */
  fim: string | null
  /** Dia do cancelamento, no fuso da operação. `null` = não cancelado. */
  canceladoNoDia: string | null
}

/**
 * O dia em que o motivo deixa de poder ficar guardado, ou `null` se o relógio
 * ainda não começou.
 *
 * - **Voltou:** o relógio começa no dia da VOLTA, que é o dia seguinte ao `fim`.
 *   Férias de 01 a 10/09, prazo de 7 dias: volta em 11/09, motivo sai em 18/09.
 * - **Sem data de volta:** o relógio não corre — `A17`: "o prazo só começa
 *   quando ela for". Apagar o motivo de quem está fora AGORA tiraria da
 *   gestora justamente a informação de que ela precisa hoje.
 * - **Cancelado:** conta do cancelamento, mesmo que o `fim` registrado esteja
 *   no futuro. Ausência que não aconteceu não tem volta para esperar, e férias
 *   adiadas para dezembro não podem guardar um atestado até lá. Hipótese em
 *   `DECISOES.md § C` — `A17` não fala do cancelado; `A20` decide assim para o
 *   item.
 */
export function diaEmQueOMotivoVence(afastamento: AfastamentoNoRelogio, dias: number): string | null {
  exigirPrazoValido(dias)

  if (afastamento.canceladoNoDia !== null) return deslocarDias(afastamento.canceladoNoDia, dias)
  if (afastamento.fim === null) return null

  const diaDaVolta = deslocarDias(afastamento.fim, 1)
  return deslocarDias(diaDaVolta, dias)
}

/** `true` quando, em `hoje`, o motivo já não pode estar guardado. */
export function motivoVenceu(afastamento: AfastamentoNoRelogio, hoje: string, dias: number): boolean {
  const vence = diaEmQueOMotivoVence(afastamento, dias)
  // Chave ISO é ordenável como texto.
  return vence !== null && hoje >= vence
}
