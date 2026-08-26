import { PedidoDistribuicaoSchema } from '../../../../core/esquemas'
import { previa } from '../../../../servicos/distribuicao'
import { corpoJson, responder, rota } from '../../../../servidor/http'
import { obterPrisma } from '../../../../servidor/prisma'
import { exigirAtor } from '../../../../servidor/sessao'
import { resumirPlanos } from '../resumo'

/** Roda o motor SEM gravar. Mesma função que a confirmação usa. */
export async function POST(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    const pedido = PedidoDistribuicaoSchema.parse(await corpoJson(requisicao))
    const relatorio = await previa(obterPrisma(), pedido, ator)

    return responder(resumirPlanos(relatorio))
  })
}
