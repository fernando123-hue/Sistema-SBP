import { detalharRodada } from '../../../../servicos/caixa'
import { exigirPapel } from '../../../../servidor/ator'
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
    const ator = await exigirAtor()
    // A rodada expõe o crédito e o volume recebido de CADA colega elegível.
    // Sem esta checagem, qualquer colaborador autenticado lia o livro-razão da
    // equipe inteira — bastava ter o id de uma rodada.
    exigirPapel(ator, 'ver auditoria de rodada', 'operador', 'gestor')

    const { id } = await contexto.params

    const rodada = await detalharRodada(obterPrisma(), id)
    if (!rodada) return responderErro('Rodada não encontrada.', 404)

    return responder(rodada)
  })
}
