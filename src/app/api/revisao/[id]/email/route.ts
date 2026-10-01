import { lerEmailDaRevisao } from '../../../../../servicos/revisao'
import { limitar, responder, rota } from '../../../../../servidor/http'
import { obterPrisma } from '../../../../../servidor/prisma'
import { exigirAtor } from '../../../../../servidor/sessao'

/**
 * O e-mail de uma revisão, para ler ao lado do que a IA extraiu (`A69`, 2A).
 *
 * O papel é conferido no serviço (`lerEmailDaRevisao`), e não só aqui: assim
 * o teste do serviço cobre a guarda, e apagar uma linha nesta rota não reabre
 * a leitura para todo mundo.
 *
 * ═══ O LIMITE ═══
 *
 * Por pessoa. Quem revisa abre um e-mail por vez, algumas dezenas por hora;
 * um laço percorrendo ids leria a caixa do setor inteira, com nome e CPF de
 * associado, em minutos.
 */
const LEITURAS_POR_MINUTO = 30

export async function GET(
  _requisicao: Request,
  contexto: { params: Promise<{ id: string }> },
): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()

    const recusa = limitar(`email-da-revisao:${ator.colaboradorId}`, LEITURAS_POR_MINUTO, 60)
    if (recusa) return recusa

    const { id } = await contexto.params
    return responder(await lerEmailDaRevisao(obterPrisma(), id, ator))
  })
}
