import { ambiente } from '../servidor/ambiente'
import type { Banco } from '../servidor/prisma'

/**
 * O domínio de todo e-mail do seed, da demo e do dublê de ingestão. É reservado
 * (RFC 2606): nenhuma caixa de verdade termina assim.
 */
export const DOMINIO_SINTETICO = '@exemplo.test'

/**
 * Recusa gravar dado sintético numa base que já tem dado da operação.
 *
 * Existe porque a demo, além de criar e-mails falsos, chama
 * `aprovarTodosPendentes`: aprova TODAS as revisões rotineiras pendentes da
 * base apontada, as reais junto, e depois distribui. A trilha é append-only,
 * então nada disso se desfaz. E o seed põe na base gente que não existe, com
 * senha impressa no terminal. Os dois rodavam em qualquer base; só a limpeza
 * tinha trava (auditoria de 01/10/2026).
 *
 * `NODE_ENV` sozinho não basta: no servidor, quem roda `npm run demo` num
 * terminal herda o ambiente do terminal, não o do serviço, e pode não ter
 * `NODE_ENV` nenhum. Por isso a trava olha também a própria base: e-mail
 * que não veio do dublê, ou pessoa fora do domínio sintético, é operação.
 */
export async function exigirBaseSintetica(banco: Banco, rotina: string): Promise<void> {
  if (ambiente().NODE_ENV === 'production') {
    throw new Error(`Recusado: ${rotina} grava dado sintético e não roda com NODE_ENV=production.`)
  }

  const [emailDeFora, pessoaDeFora] = await Promise.all([
    banco.email.findFirst({ where: { origem: { not: 'mock' } }, select: { id: true } }),
    banco.colaborador.findFirst({
      where: { NOT: { email: { endsWith: DOMINIO_SINTETICO } } },
      select: { id: true },
    }),
  ])

  // Nenhum valor da linha achada entra na mensagem: o e-mail de uma pessoa
  // real iria parar no terminal e no log de quem rodou.
  if (emailDeFora !== null) {
    throw new Error(
      `Recusado: ${rotina} não roda nesta base, que já tem e-mail lido de uma caixa de verdade. ` +
        'Aponte DATABASE_URL para uma base de desenvolvimento.',
    )
  }
  if (pessoaDeFora !== null) {
    throw new Error(
      `Recusado: ${rotina} não roda nesta base, que já tem colaborador fora do domínio sintético ` +
        `(${DOMINIO_SINTETICO}). Aponte DATABASE_URL para uma base de desenvolvimento.`,
    )
  }
}
