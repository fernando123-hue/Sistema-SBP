import { definirEscala, obterEscala } from '../../../servicos/escala'
import { corpoJson, responder, responderErro, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { exigirAtor } from '../../../servidor/sessao'

export async function GET(requisicao: Request): Promise<Response> {
  return rota(async () => {
    // O papel decide o que a resposta pode dizer sobre a ausência de cada um:
    // gestor vê o motivo, o resto vê "de férias" ou "indisponível". A redação
    // acontece no serviço, antes de a resposta existir.
    const ator = await exigirAtor()

    const data = new URL(requisicao.url).searchParams.get('data')
    if (!data) return responderErro('Parâmetro "data" é obrigatório (YYYY-MM-DD).', 400)

    return responder(await obterEscala(obterPrisma(), data, ator.papel))
  })
}

export async function PUT(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    return responder(await definirEscala(obterPrisma(), await corpoJson(requisicao), ator))
  })
}
