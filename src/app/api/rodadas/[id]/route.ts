import { detalharRodada } from '../../../../servicos/caixa'
import { responder, responderErro, rota } from '../../../../servidor/http'
import { obterPrisma } from '../../../../servidor/prisma'
import { exigirAtor } from '../../../../servidor/sessao'

/**
 * Auditoria de uma rodada.
 *
 * Responde, sem interpretação: o que entrou, quem estava elegível e com qual
 * crédito, qual foi a ordem, quanto cada um recebeu, o crédito antes e depois,
 * a versão do algoritmo, quem disparou e quando.
 */
export async function GET(
  _requisicao: Request,
  contexto: { params: Promise<{ id: string }> },
): Promise<Response> {
  return rota(async () => {
    await exigirAtor()
    const { id } = await contexto.params

    const rodada = await detalharRodada(obterPrisma(), id)
    if (!rodada) return responderErro('Rodada não encontrada.', 404)

    return responder(rodada)
  })
}
