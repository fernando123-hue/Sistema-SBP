import { z } from 'zod'

import { devolver } from '../../../../../servicos/fila'
import { corpoJson, responder, rota } from '../../../../../servidor/http'
import { obterPrisma } from '../../../../../servidor/prisma'
import { exigirAtor } from '../../../../../servidor/sessao'

const CorpoSchema = z.object({ justificativa: z.string().min(5).max(1000) })

/**
 * Devolve o item ao pool.
 *
 * Diferente de transferir: ninguém escolhe quem recebe. O item volta a não ter
 * dono e o motor decide de novo na próxima rodada, com o crédito atualizado.
 */
export async function POST(
  requisicao: Request,
  contexto: { params: Promise<{ id: string }> },
): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    const { id } = await contexto.params
    const corpo = CorpoSchema.parse(await corpoJson(requisicao))

    await devolver(obterPrisma(), { itemId: id, justificativa: corpo.justificativa }, ator)

    return responder({ itemId: id, status: 'devolvido' })
  })
}
