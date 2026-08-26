import { PedidoDistribuicaoSchema } from '../../../../core/esquemas'
import { confirmar } from '../../../../servicos/distribuicao'
import { corpoJson, limitar, responder, rota } from '../../../../servidor/http'
import { obterPrisma } from '../../../../servidor/prisma'
import { exigirAtor } from '../../../../servidor/sessao'
import { resumirPlanos } from '../resumo'

/**
 * Grava a distribuição em transação.
 *
 * Limite de taxa por pessoa e por dia: um clique repetido de operador impaciente
 * não pode virar rodadas duplicadas. A operação já é naturalmente idempotente
 * (a segunda execução não encontra item aprovado), mas o limite evita o gasto.
 */
export async function POST(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    const pedido = PedidoDistribuicaoSchema.parse(await corpoJson(requisicao))

    const recusa = limitar(`distribuir:${ator.colaboradorId}:${pedido.data}`, 10, 60)
    if (recusa) return recusa

    const relatorio = await confirmar(obterPrisma(), pedido, ator)
    return responder(resumirPlanos(relatorio))
  })
}
