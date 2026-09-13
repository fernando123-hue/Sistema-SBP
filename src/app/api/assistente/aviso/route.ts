import { avisoDoGestor, marcarAvisoComoVisto } from '../../../../servicos/aviso-do-gestor'
import { corpoJson, responder, rota } from '../../../../servidor/http'
import { obterPrisma } from '../../../../servidor/prisma'
import { exigirAtor } from '../../../../servidor/sessao'

/**
 * O aviso do dia para a gestora (`A17`). Só gestor — a guarda mora no serviço.
 *
 * Mora sob `/assistente` porque aparece no painel dele, e é só isso que as duas
 * coisas têm em comum: este conteúdo nunca passa pelo modelo.
 */
export async function GET(): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    return responder(await avisoDoGestor(obterPrisma(), ator))
  })
}

/** A gestora viu o aviso (`A39(e)`). Quem viu vem da sessão, nunca do corpo. */
export async function POST(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    return responder(await marcarAvisoComoVisto(obterPrisma(), await corpoJson(requisicao), ator))
  })
}
