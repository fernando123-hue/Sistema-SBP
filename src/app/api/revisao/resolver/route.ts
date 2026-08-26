import { resolver } from '../../../../servicos/revisao'
import { corpoJson, responder, rota } from '../../../../servidor/http'
import { obterPrisma } from '../../../../servidor/prisma'
import { exigirAtor } from '../../../../servidor/sessao'

/**
 * Resolve um item da fila de revisão.
 *
 * O corpo NÃO carrega quem resolveu — a identidade vem do `Ator` da sessão.
 * É o que impede que a trilha de auditoria seja preenchida pelo cliente.
 */
export async function POST(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    const resultado = await resolver(obterPrisma(), await corpoJson(requisicao), ator)
    return responder(resultado)
  })
}
