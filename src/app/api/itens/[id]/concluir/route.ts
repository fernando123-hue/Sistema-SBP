import { z } from 'zod'

import { concluir } from '../../../../../servicos/fila'
import { corpoJson, responder, rota } from '../../../../../servidor/http'
import { obterPrisma } from '../../../../../servidor/prisma'
import { exigirAtor } from '../../../../../servidor/sessao'

const CorpoSchema = z.object({ observacao: z.string().max(1000).optional() })

/**
 * Conclui um item.
 *
 * Quem conclui é sempre o ator da sessão — não há como declarar ter concluído
 * o trabalho de outra pessoa. O serviço recusa se o item não for seu.
 */
export async function POST(
  requisicao: Request,
  contexto: { params: Promise<{ id: string }> },
): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    const { id } = await contexto.params
    const corpo = CorpoSchema.parse(await corpoJson(requisicao))

    await concluir(
      obterPrisma(),
      { itemId: id, ...(corpo.observacao ? { observacao: corpo.observacao } : {}) },
      ator,
    )

    return responder({ itemId: id, status: 'concluido' })
  })
}
