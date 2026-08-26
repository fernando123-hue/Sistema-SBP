import { criarAiPort, criarIngestaoPort } from '../../../adapters/fabrica'
import { hojeIso, sequenciaDeDatas } from '../../../core/util/datas'
import { sincronizar } from '../../../servicos/ingestao'
import { exigirPapel } from '../../../servidor/ator'
import { limitar, responder, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { exigirAtor } from '../../../servidor/sessao'

/**
 * Dispara a ingestão.
 *
 * Qual adapter roda vem do ambiente, pela fábrica — não de um `new` fixo aqui.
 * Pedir um adapter não implementado falha em vez de rodar o mock em silêncio.
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

    const hoje = hojeIso()

    const resumo = await sincronizar(
      {
        banco: obterPrisma(),
        // Idempotente por message-id: chamar de novo não duplica nada.
        ingestao: criarIngestaoPort({
          datas: sequenciaDeDatas(hoje, 1),
          semente: Number(hoje.replaceAll('-', '')),
        }),
        ia: criarAiPort(),
      },
      ator,
    )

    return responder(resumo)
  })
}
