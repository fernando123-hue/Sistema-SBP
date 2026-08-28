import { destravarConta } from '../../../../servicos/autenticacao'
import { corpoJson, responder, rota } from '../../../../servidor/http'
import { obterPrisma } from '../../../../servidor/prisma'
import { exigirAtor } from '../../../../servidor/sessao'

/** Gestor libera uma conta travada por tentativas, sem esperar o tempo passar. */
export async function POST(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    return responder(await destravarConta(obterPrisma(), await corpoJson(requisicao), ator))
  })
}
