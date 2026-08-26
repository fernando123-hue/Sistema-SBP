import { minhaFila } from '../../../servicos/fila'
import { responder, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { exigirAtor } from '../../../servidor/sessao'

/**
 * Fila individual.
 *
 * Sem `colaborador` na query, devolve a fila de quem está pedindo. Passar o
 * parâmetro exige papel de operador ou gestor — a checagem está no serviço.
 */
export async function GET(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    const alvo = new URL(requisicao.url).searchParams.get('colaborador') ?? ator.colaboradorId

    return responder(await minhaFila(obterPrisma(), alvo, ator))
  })
}
