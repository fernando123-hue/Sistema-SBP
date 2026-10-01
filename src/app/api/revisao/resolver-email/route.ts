import { resolverEmailDaRevisao } from '../../../../servicos/revisao'
import { corpoJson, limitar, responder, rota } from '../../../../servidor/http'
import { obterPrisma } from '../../../../servidor/prisma'
import { exigirAtor } from '../../../../servidor/sessao'

/**
 * Por pessoa, como `concluir-junto`. Quem revisa decide alguns e-mails por
 * minuto; um laço mandando 500 revisões por vez, cada uma travando linhas,
 * não passa daqui.
 */
const DECISOES_POR_MINUTO = 20

/**
 * "Aprovar os N" de um e-mail na Revisão (`A69`, 1A).
 *
 * O corpo é validado pelo serviço (`ResolucaoDoEmailSchema`, estrito): sem
 * "quem decidiu" — a identidade vem do `Ator` da sessão (invariante 5).
 */
export async function POST(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    const recusa = limitar(`resolver-email:${ator.colaboradorId}`, DECISOES_POR_MINUTO, 60)
    if (recusa) return recusa

    return responder(await resolverEmailDaRevisao(obterPrisma(), await corpoJson(requisicao), ator))
  })
}
