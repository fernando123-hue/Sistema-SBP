import { definirAtivacao } from '../../../../servicos/autenticacao'
import { corpoJson, responder, rota } from '../../../../servidor/http'
import { obterPrisma } from '../../../../servidor/prisma'
import { exigirAtor } from '../../../../servidor/sessao'

/**
 * Gestor liga ou desliga o acesso de alguém.
 *
 * Desativar NÃO apaga: o histórico de carga e a trilha de auditoria continuam
 * de pé, porque precisam responder quem recebeu o quê no ano passado.
 */
export async function POST(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    return responder(await definirAtivacao(obterPrisma(), await corpoJson(requisicao), ator))
  })
}
