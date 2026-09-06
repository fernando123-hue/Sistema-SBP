import { cancelar } from '../../../../servicos/afastamentos'
import { responder, rota } from '../../../../servidor/http'
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
