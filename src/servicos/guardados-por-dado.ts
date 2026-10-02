import type { Banco } from '../servidor/prisma'

/**
 * Quantos e-mails estão guardados agora por "sem item, mas com CPF, CRM ou
 * anexo" (`AT-73`, `A76`).
 *
 * Do BANCO, não do resumo da última busca: o resumo vive em memória e some na
 * busca seguinte ou num reinício, e o e-mail fica 30 dias. O aviso que o dono
 * pediu tem de durar o mesmo que a guarda (revisões do #191). Sai da conta
 * quando o conteúdo sai pela limpeza (`conteudoExpurgadoEm`).
 *
 * Só o número: nada de remetente, assunto ou motivo por e-mail — quem confere
 * abre o Outlook.
 */
export async function contarGuardadosPorDado(banco: Banco): Promise<number> {
  return banco.email.count({ where: { dadoSemItem: { not: null }, conteudoExpurgadoEm: null } })
}
