import { DOMINIO_SINTETICO } from '../servidor/acesso-local'
import { ambiente } from '../servidor/ambiente'
import type { Banco } from '../servidor/prisma'

// Um domínio só para "conta de teste": o acesso local de desenvolvimento, esta
// trava e a preparação do servidor perguntam a mesma coisa.
export { DOMINIO_SINTETICO }

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
 * Item de registro manual (sem e-mail) não é olhado: ele só existe se uma
 * pessoa real o criou, e essa pessoa já recusa pela segunda consulta.
 *
 * LIMITE CONHECIDO (revisões do #175): **base vazia passa.** Uma base da
 * operação recém-migrada, ainda sem ninguém, é indistinguível de uma base de
 * desenvolvimento nova, e um seed rodado nela sem `NODE_ENV=production` cria
 * a equipe fictícia com senhas no terminal. O que fecha isso não é esta
 * trava: é o servidor ter um caminho próprio para o primeiro gestor real, e o
 * roteiro de instalação nunca mandar rodar o seed (`DECISOES.md § AT-60`).
 *
 * Mora em `servicos/` e não em `scripts/`, ao lado da limpeza, porque o
 * seed vive em `prisma/` e importaria de `scripts/` só por isto.
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
