/**
 * A linha que fica depois de "Confirmar" na Distribuição (`A69`, 5B).
 *
 * Na planilha, a divisão levava 30 a 45 minutos e cada número era digitado; a
 * conservação falhava em 29% dos dias. Aqui o trabalho pesado acontecia sem
 * ninguém ver. Esta linha só torna visível o que já é verdade quando a
 * confirmação volta sem erro:
 *
 * - **nenhum número digitado**: as quantidades saem da contagem dos itens, e
 *   não existe campo de quantidade em tela nenhuma (invariante 4);
 * - **conservação conferida**: `confirmar` confere, dentro da transação,
 *   atribuições gravadas == itens de entrada em cada rodada, e aborta tudo se
 *   não fechar (invariante 3). Se a resposta chegou, a conta fechou.
 *
 * Não fala de pessoa nenhuma (`A71`): é o registro da rodada, não de quem
 * recebeu quanto.
 */
export function registroDaGravacao(
  totalDistribuido: number,
  rodadasGravadas: number,
  hora: string,
  /**
   * Havia item que ficou fora: `confirmar` replaneja dentro da transação, e
   * um plantão mudado depois da prévia pode deixar toda categoria sem
   * ninguém elegível. "Não havia item" seria falso (revisão técnica do #171).
   */
  ficouItemDeFora: boolean,
): string {
  if (rodadasGravadas <= 0) {
    return ficouItemDeFora
      ? `Nada gravado às ${hora}: nenhuma categoria pôde ser distribuída. Os itens continuam esperando; o motivo está abaixo.`
      : `Nada gravado às ${hora}: não havia item a distribuir nesta data.`
  }
  const itens = totalDistribuido === 1 ? '1 item' : `${totalDistribuido} itens`
  const rodadas =
    rodadasGravadas === 1 ? '1 rodada registrada, auditável' : `${rodadasGravadas} rodadas registradas, cada uma auditável`
  return `Gravada às ${hora} · ${itens} · nenhum número digitado · conservação conferida. ${rodadas}.`
}
