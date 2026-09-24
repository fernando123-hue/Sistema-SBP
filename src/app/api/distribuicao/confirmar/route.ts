import { PedidoDistribuicaoSchema } from '../../../../core/esquemas'
import { CONFIRMACOES_POR_MINUTO, confirmar } from '../../../../servicos/distribuicao'
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

    // Dois baldes. Este, sem a data, é o que contém volume: a data vem do
    // corpo, e com ela na chave cada data nova abria um balde novo (C-26).
    //
    // Prefixo PRÓPRIO, e não `distribuir:`: o limitador separa por prefixo, e
    // no mesmo compartimento das chaves por data este balde seria despejado
    // quando outras contas enchessem o compartimento — o contador recomeçaria
    // do zero antes do minuto (revisão de segurança do #99).
    const porPessoa = limitar(`confirmar-por-pessoa:${ator.colaboradorId}`, CONFIRMACOES_POR_MINUTO, 60)
    if (porPessoa) return porPessoa

    const recusa = limitar(`distribuir:${ator.colaboradorId}:${pedido.data}`, 10, 60)
    if (recusa) return recusa

    const relatorio = await confirmar(obterPrisma(), pedido, ator)
    return responder(resumirPlanos(relatorio))
  })
}
