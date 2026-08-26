import { listarPendentes } from '../../../servicos/revisao'
import { responder, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { exigirAtor } from '../../../servidor/sessao'
import { exigirPapel } from '../../../servidor/ator'

export async function GET(): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    exigirPapel(ator, 'ver fila de revisão', 'operador', 'gestor')

    return responder(await listarPendentes(obterPrisma(), 200))
  })
}
