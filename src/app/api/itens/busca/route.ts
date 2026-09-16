import { buscarPorChave } from '../../../../servicos/caixa'
import { corpoJson, limitar, responder, rota } from '../../../../servidor/http'
import { obterPrisma } from '../../../../servidor/prisma'
import { exigirAtor } from '../../../../servidor/sessao'

/**
 * Busca por CPF ou matrícula (`A23(b)`, `A40` resposta 24).
 *
 * ═══ POR QUE POST, E NÃO GET ═══
 *
 * O CPF digitado vai no CORPO. Num GET ele iria no endereço: fica no histórico
 * do navegador, e o servidor de desenvolvimento imprime o caminho com a query
 * em cada linha de registro. Por isso não existe `GET` aqui — e um teste confere.
 *
 * ═══ QUEM PODE ═══
 *
 * Todos os cargos, por decisão do dono: exige sessão e nada mais, como a Caixa.
 * O que cada cargo enxerga é decidido na leitura da Caixa (`A24`, fase 2).
 *
 * ═══ O LIMITE ═══
 *
 * Por pessoa, como o do assistente: a rota já sabe quem chama. Quem procura um
 * associado faz poucas buscas por minuto; um laço tentando CPFs faria centenas.
 */
const BUSCAS_POR_MINUTO = 20

export async function POST(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()

    const recusa = limitar(`busca:${ator.colaboradorId}`, BUSCAS_POR_MINUTO, 60)
    if (recusa) return recusa

    // O ator vai junto: a busca é a mesma leitura da Caixa, então ela herda o
    // recorte de `A24` em vez de virar porta lateral para o item de um colega.
    const itens = await buscarPorChave(obterPrisma(), await corpoJson(requisicao), ator)
    return responder({ itens })
  })
}
