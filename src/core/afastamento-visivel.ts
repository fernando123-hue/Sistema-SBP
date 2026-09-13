import type { Papel } from './esquemas'

/**
 * O que cada papel pode saber sobre a ausência de um colega.
 *
 * Decisão do dono do negócio em 06/09/2026, respondendo a pergunta que o `A10`
 * deixou aberta (§ H.4, item 9). A operação precisa saber **quem não vai
 * receber trabalho hoje** — sem isso a tela promete uma equipe que não existe.
 * O que ela **não** precisa saber é o motivo médico.
 *
 *   colaborador / operador → "de férias" ou "indisponível"
 *   gestor                 → o motivo real, na ficha
 *
 * `ferias` atravessa porque não é informação de saúde: é agenda, e esconder
 * agenda só produziria a pergunta "por que fulano está indisponível?" — que é
 * exatamente a conversa que a redação existe para evitar. `atestado`,
 * `licenca`, `falta` e `outro` viram todos o MESMO rótulo, de propósito: se
 * `atestado` virasse um rótulo próprio e os outros não, a ausência do rótulo
 * já denunciaria o motivo.
 */
export type RotuloDeAfastamento =
  | 'ferias'
  | 'indisponivel'
  | 'atestado'
  | 'licenca'
  | 'falta'
  | 'outro'
  /** Motivo já apagado pelo prazo de `A17`. Só o gestor chega a vê-lo com este nome. */
  | 'ausente'

/**
 * Traduz o tipo real no que este papel pode ver.
 *
 * A REDAÇÃO ACONTECE NO SERVIDOR, e é por isso que esta função é chamada antes
 * de montar a resposta — nunca na tela. Mandar o tipo real e esconder no
 * componente deixaria o dado numa resposta HTTP que qualquer pessoa autenticada
 * consegue ler; a tela é vitrine, não fechadura.
 */
export function rotuloDeAfastamento(
  tipo: string | null,
  papel: Papel,
): RotuloDeAfastamento | null {
  if (tipo === null) return null
  if (papel === 'gestor') return tipo as RotuloDeAfastamento
  return tipo === 'ferias' ? 'ferias' : 'indisponivel'
}
