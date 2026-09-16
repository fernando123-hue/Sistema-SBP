import { alterarPrazo, listarPrazos } from '../../../servicos/retencao'
import { corpoJson, responder, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { exigirAtor } from '../../../servidor/sessao'

/**
 * Prazos de retenção (`A17`). Só gestor — a guarda mora no serviço.
 *
 * `PUT` e não `POST`: grava o valor em vigor de um prazo que sempre existe
 * (com o padrão, enquanto ninguém mudou). Repetir o pedido não muda nada nem
 * escreve na trilha.
 */

export async function GET(): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    return responder(await listarPrazos(obterPrisma(), ator))
  })
}

export async function PUT(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    return responder(await alterarPrazo(obterPrisma(), await corpoJson(requisicao), ator))
  })
}
