import { definirEscala, obterEscala } from '../../../servicos/escala'
import { corpoJson, responder, responderErro, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { exigirAtor } from '../../../servidor/sessao'

export async function GET(requisicao: Request): Promise<Response> {
  return rota(async () => {
    await exigirAtor()

    const data = new URL(requisicao.url).searchParams.get('data')
    if (!data) return responderErro('Parâmetro "data" é obrigatório (YYYY-MM-DD).', 400)

    return responder(await obterEscala(obterPrisma(), data))
  })
}

export async function PUT(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    return responder(await definirEscala(obterPrisma(), await corpoJson(requisicao), ator))
  })
}
