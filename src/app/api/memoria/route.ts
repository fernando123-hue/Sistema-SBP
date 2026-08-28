import { porCorrelacao, porEntidade } from '../../../servicos/memoria'
import { responder, responderErro, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { exigirAtor } from '../../../servidor/sessao'

/**
 * Consulta da memória operacional.
 *
 * A primeira e única leitura da trilha de auditoria em produção. Antes dela,
 * `LogAuditoria` e `EventoProcessamento` eram gravados em 27 pontos do código
 * e lidos em zero — a trilha de um sistema cuja razão de existir é acabar com
 * erro silencioso só era alcançável por `prisma studio`.
 *
 * Duas perguntas, e nada além delas:
 *
 *   ?correlacao=<id>              o que aconteceu neste ciclo
 *   ?entidade=Item&id=<itemId>    a história deste registro
 *
 * A primeira é a que resolve o identificador que uma falha 500 entrega ao
 * usuário — uma promessa que a mensagem de erro fazia e o sistema não cumpria.
 *
 * NÃO existe listagem geral, e a ausência é deliberada: a trilha carrega quem
 * fez o quê sobre a operação inteira, e uma rota que a despeja em página
 * transforma auditoria em vigilância. Memória se consulta por um caso.
 */
export async function GET(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    const url = new URL(requisicao.url)
    const banco = obterPrisma()

    const correlacao = url.searchParams.get('correlacao')
    if (correlacao) {
      return responder(await porCorrelacao(banco, correlacao, ator))
    }

    const entidade = url.searchParams.get('entidade')
    const id = url.searchParams.get('id')
    if (entidade && id) {
      return responder(await porEntidade(banco, entidade, id, ator))
    }

    return responderErro(
      'Informe "correlacao=<id>" para ver um ciclo inteiro, ou "entidade=<nome>&id=<id>" ' +
        'para ver a história de um registro.',
      400,
    )
  })
}
