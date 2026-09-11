import { z } from 'zod'

import { cancelar, encerrar } from '../../../../servicos/afastamentos'
import { corpoJson, responder, rota } from '../../../../servidor/http'
import { obterPrisma } from '../../../../servidor/prisma'
import { exigirAtor } from '../../../../servidor/sessao'

/**
 * Cancela um afastamento.
 *
 * `DELETE` na rota, CARIMBO no banco: a linha não é apagada. Ausência que não
 * aconteceu precisa parar de tirar a pessoa do rateio, mas a trilha continua
 * respondendo por que alguém ficou fora na terça-feira passada.
 */
export async function DELETE(
  _requisicao: Request,
  contexto: { params: Promise<{ id: string }> },
): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    const { id } = await contexto.params

    await cancelar(obterPrisma(), id, ator)
    return responder({ cancelado: true })
  })
}

const EncerramentoSchema = z.object({ fim: z.string() })

/**
 * Encerra uma ausência em aberto: a pessoa voltou.
 *
 * `PATCH` e não `DELETE`: encerrar não é cancelar. Cancelar afirma que a
 * ausência NÃO aconteceu; encerrar afirma que ela acabou. Enquanto só existia o
 * `DELETE`, o gestor que precisava trazer alguém de volta ao rateio era
 * empurrado a gravar a primeira afirmação para conseguir a segunda.
 */
export async function PATCH(
  requisicao: Request,
  contexto: { params: Promise<{ id: string }> },
): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    const { id } = await contexto.params
    const corpo = EncerramentoSchema.parse(await corpoJson(requisicao))

    return responder(await encerrar(obterPrisma(), { afastamentoId: id, fim: corpo.fim }, ator))
  })
}
