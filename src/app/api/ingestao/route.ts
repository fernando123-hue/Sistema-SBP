import { IaMock } from '../../../adapters/ia-mock'
import { IngestaoMock } from '../../../adapters/ingestao-mock'
import { hojeIso, sequenciaDeDatas } from '../../../core/util/datas'
import { sincronizar } from '../../../servicos/ingestao'
import { ambiente } from '../../../servidor/ambiente'
import { exigirPapel } from '../../../servidor/ator'
import { limitar, responder, responderErro, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { exigirAtor } from '../../../servidor/sessao'

/**
 * Dispara a ingestão.
 *
 * Na V1 o adapter é mock (DECISOES.md § D, questão 7: onde os e-mails moram
 * ainda não foi decidido). Trocar o adapter aqui é a única mudança necessária
 * quando a resposta chegar.
 *
 * Limite de taxa apertado: cada sincronização chama o modelo de IA uma vez por
 * e-mail novo. Com o adapter real, isso custa dinheiro.
 */
export async function POST(): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    exigirPapel(ator, 'sincronizar ingestão', 'operador', 'gestor')

    const recusa = limitar(`ingestao:${ator.colaboradorId}`, 5, 60)
    if (recusa) return recusa

    const config = ambiente()
    if (config.INGESTAO_ADAPTER !== 'mock') {
      return responderErro(
        `Adapter de ingestão "${config.INGESTAO_ADAPTER}" ainda não implementado.`,
        501,
      )
    }

    const resumo = await sincronizar(
      {
        banco: obterPrisma(),
        // Gera os últimos 5 dias, incluindo hoje. Idempotente por message-id:
        // chamar de novo não duplica nada.
        ingestao: new IngestaoMock({
          datas: sequenciaDeDatas(hojeIso(), 1),
          semente: Number(new Date().toISOString().slice(0, 10).replaceAll('-', '')),
        }),
        ia: new IaMock(),
      },
      ator,
    )

    return responder(resumo)
  })
}
