import { definirSenhaProvisoria } from '../../../../servicos/autenticacao'
import { corpoJson, responder, rota } from '../../../../servidor/http'
import { obterPrisma } from '../../../../servidor/prisma'
import { exigirAtor } from '../../../../servidor/sessao'

/** Gestor define ou redefine a senha provisória de alguém. O papel é conferido no serviço. */
export async function POST(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    const resultado = await definirSenhaProvisoria(obterPrisma(), await corpoJson(requisicao), ator)
    return responder(resultado)
  })
}
