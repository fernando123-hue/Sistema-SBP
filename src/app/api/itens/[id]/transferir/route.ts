import { z } from 'zod'

import { transferir } from '../../../../../servicos/fila'
import { corpoJson, responder, rota } from '../../../../../servidor/http'
import { obterPrisma } from '../../../../../servidor/prisma'
import { exigirAtor } from '../../../../../servidor/sessao'

const CorpoSchema = z.object({
  paraColaboradorId: z.string().min(1),
  justificativa: z.string().min(5).max(1000),
})

/**
 * Transfere o item para uma pessoa específica.
 *
 * Para devolver ao pool sem escolher destinatário, use `/devolver`.
 *
 * NÃO altera a rodada original: cria uma atribuição nova com motivo e
 * justificativa. É o que separa as três intenções que na planilha moram todas
 * na coluna `Mov. Extra` (RN-06).
 */
export async function POST(
  requisicao: Request,
  contexto: { params: Promise<{ id: string }> },
): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    const { id } = await contexto.params
    const corpo = CorpoSchema.parse(await corpoJson(requisicao))

    await transferir(obterPrisma(), { itemId: id, ...corpo }, ator)

    return responder({ itemId: id, para: corpo.paraColaboradorId, motivo: 'transferencia' })
  })
}
