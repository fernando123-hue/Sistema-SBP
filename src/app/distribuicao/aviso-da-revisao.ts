/**
 * O aviso da Distribuição depois da busca (`A69`, 4A): quantos itens esperam
 * conferência na Revisão. `null` quando não há o que dizer.
 *
 * - Zero, ou contagem que falhou (`null`): nada. A busca já tem o seu aviso.
 * - "desta busca" só quando cabe no total. A fila é contada depois da busca;
 *   se alguém aprovou itens no meio, "1 item espera (3 desta busca)" seria a
 *   parte maior que o todo (revisão técnica do #170).
 */
export function avisoDaRevisao(
  pendentes: number | null,
  destaBusca: number,
): { titulo: string; complemento: string } | null {
  if (pendentes === null || pendentes <= 0) return null
  return {
    titulo:
      pendentes === 1 ? '1 item espera conferência na Revisão' : `${pendentes} itens esperam conferência na Revisão`,
    complemento: destaBusca > 0 && destaBusca <= pendentes ? ` (${destaBusca} desta busca)` : '',
  }
}
