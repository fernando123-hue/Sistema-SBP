import { z } from 'zod'

import { LIMITE_ITENS_POR_EMAIL } from '../../../../core/esquemas'
import { concluirDoMesmoEmail } from '../../../../servicos/fila'
import { corpoJson, limitar, responder, rota } from '../../../../servidor/http'
import { obterPrisma } from '../../../../servidor/prisma'
import { exigirAtor } from '../../../../servidor/sessao'

/** Os ids que a tela mostrou no grupo. Sem "quem": quem conclui é o ator da sessão. */
const CorpoSchema = z
  .object({
    itemIds: z.array(z.string().min(1).max(60)).min(1).max(LIMITE_ITENS_POR_EMAIL),
  })
  // Estrito: um "colaboradorId" no corpo é recusado, não ignorado em silêncio
  // (invariante 5).
  .strict()

/**
 * Por pessoa (revisão de segurança do #165). Quem trabalha conclui alguns
 * e-mails por minuto; um laço mandando 500 ids por vez não passa daqui.
 */
const LOTES_POR_MINUTO = 20

/**
 * "Concluir os N" de um e-mail na Minha fila (`A69`, 3A).
 *
 * Os ids vão explícitos, e não "tudo deste e-mail": um item do mesmo e-mail
 * que chegou à fila depois de a tela abrir não pode ser concluído sem a pessoa
 * tê-lo visto. O serviço confere que são todos dela e do mesmo e-mail.
 */
export async function POST(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    const recusa = limitar(`concluir-junto:${ator.colaboradorId}`, LOTES_POR_MINUTO, 60)
    if (recusa) return recusa

    const corpo = CorpoSchema.parse(await corpoJson(requisicao))

    return responder(await concluirDoMesmoEmail(obterPrisma(), corpo, ator))
  })
}
