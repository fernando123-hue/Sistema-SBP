import { lerDadosDoItem } from '../../../../../servicos/fila'
import { limitar, responder, rota, semCache } from '../../../../../servidor/http'
import { obterPrisma } from '../../../../../servidor/prisma'
import { exigirAtor } from '../../../../../servidor/sessao'

/**
 * Os dados que a IA leu de um item da própria fila, para copiar (`A69`, 3B).
 *
 * Quem pode ler é conferido no serviço (`lerDadosDoItem`): só quem está com o
 * item. Assim o teste do serviço cobre a guarda, e apagar uma linha nesta rota
 * não reabre a leitura para todo mundo.
 *
 * ═══ O LIMITE ═══
 *
 * Por pessoa. Quem trabalha uma lista de ligantes abre os dados de um por
 * vez, e "Ver um por um" num e-mail de 34 pode pedir dezenas num minuto —
 * por isso o dobro do da Revisão. Um laço percorrendo ids esbarra no limite,
 * e cada recusa de item alheio já vira rastro de sondagem.
 */
const LEITURAS_POR_MINUTO = 60

export async function GET(
  _requisicao: Request,
  contexto: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Sem cache: a resposta tem CPF e matrícula.
  return semCache(
    await rota(async () => {
      const ator = await exigirAtor()

      const recusa = limitar(`dados-do-item:${ator.colaboradorId}`, LEITURAS_POR_MINUTO, 60)
      if (recusa) return recusa

      const { id } = await contexto.params
      return responder(await lerDadosDoItem(obterPrisma(), id, ator))
    }),
  )
}
