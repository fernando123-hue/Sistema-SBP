import { definirHabilitacoes } from '../../../../servicos/colaboradores'
import { corpoJson, responder, rota } from '../../../../servidor/http'
import { obterPrisma } from '../../../../servidor/prisma'
import { exigirAtor } from '../../../../servidor/sessao'

/**
 * Gestor define o que alguém pode receber.
 *
 * A lista enviada é o estado final: categoria que não estiver nela é desligada.
 * Desligar nunca apaga a linha — o histórico de carga se apoia no registro de
 * que aquela pessoa esteve habilitada.
 */
export async function POST(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    return responder(await definirHabilitacoes(obterPrisma(), await corpoJson(requisicao), ator))
  })
}
