import { ErroDeNegocio } from './erros'
import {
  PRAZO_MAXIMO_EM_DIAS,
  PRAZO_MINIMO_EM_DIAS,
  type ChaveDePrazo,
  type TipoDeAfastamentoGravado,
} from './esquemas'
import { deslocarDias, horaLocal, paraDataIso } from './util/datas'

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
  /** `A20`: 7 dias depois da conclusão do último item do e-mail. */
  conteudo_do_email: 7,
  /** `A48`: 90 dias dão para medir, calibrar os limites de `A44` e investigar um caso. */
  contagem_de_buscas: 90,
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

// ─── Conteúdo do e-mail e bytes dos anexos (`A20`) ────────────────────────────

/** Um item do e-mail, do ponto de vista do relógio do conteúdo. */
export type ItemNoRelogio =
  | { aberto: true }
  /** Concluído ou cancelado, no dia em que isso aconteceu (fuso da operação). */
  | { aberto: false; terminouNoDia: string }

export interface EmailNoRelogio {
  recebidoNoDia: string
  conteudoSuspeito: boolean
  itens: readonly ItemNoRelogio[]
}

/**
 * O dia em que o conteúdo do e-mail deixa de poder ficar guardado, ou `null`
 * se o relógio ainda não corre.
 *
 * - **Tem item aberto:** não corre. Enquanto alguém trabalha num pedido, o
 *   texto e os anexos dele têm de estar ali.
 * - **Todos concluídos ou cancelados:** conta do dia em que o ÚLTIMO terminou.
 *   Concluído em 12/09, prazo de 7 dias: sai em 19/09. Diferente do motivo de
 *   afastamento, que conta do dia seguinte ao fim (o dia da volta): aqui o
 *   evento que dispara é a própria conclusão, e o dono falou em "7 dias depois
 *   da conclusão".
 * - **Nenhum item:** conta da chegada — resposta automática, aviso de entrega.
 * - **Nenhum item E conteúdo suspeito:** não corre. `A34` manda uma pessoa
 *   decidir antes, e essa lista ainda não existe (fase 4); apagar agora seria
 *   deixar a manipulação bem-sucedida sumir sozinha. Hipótese em `DECISOES.md § C`.
 */
export function diaEmQueOConteudoVence(email: EmailNoRelogio, dias: number): string | null {
  exigirPrazoValido(dias)

  if (email.itens.length === 0) {
    return email.conteudoSuspeito ? null : deslocarDias(email.recebidoNoDia, dias)
  }

  let ultimoDia: string | null = null
  for (const item of email.itens) {
    if (item.aberto) return null
    if (ultimoDia === null || item.terminouNoDia > ultimoDia) ultimoDia = item.terminouNoDia
  }

  // Não nulo: a lista não está vazia e nenhum item estava aberto.
  return deslocarDias(ultimoDia!, dias)
}

export function conteudoVenceu(email: EmailNoRelogio, hoje: string, dias: number): boolean {
  const vence = diaEmQueOConteudoVence(email, dias)
  return vence !== null && hoje >= vence
}

function diaEMes(momento: Date): string {
  const [, mes, dia] = paraDataIso(momento).split('-')
  return `${dia}/${mes}`
}

/**
 * O que a tela mostra onde o texto do e-mail aparecia. Texto aprovado pelo dono
 * em 12/09/2026 (`A39(b)`), em linguagem simples: a data e a hora de chegada
 * são o que a pessoa precisa para achar o original no Outlook.
 */
export function textoDoConteudoRemovido(removidoEm: Date, recebidoEm: Date | null): string {
  const inicio = `O texto deste e-mail já foi apagado do sistema no dia ${diaEMes(removidoEm)}.`
  if (recebidoEm === null) return `${inicio} O e-mail original continua no Outlook.`
  return (
    `${inicio} Para ver o e-mail completo, procure no Outlook: ` +
    `ele chegou no dia ${diaEMes(recebidoEm)}, às ${horaLocal(recebidoEm)}.`
  )
}
