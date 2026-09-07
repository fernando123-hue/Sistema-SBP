import { arquivar } from '../../../../servicos/notas'
import { corpoJson, responder, rota } from '../../../../servidor/http'
import { obterPrisma } from '../../../../servidor/prisma'
import { exigirAtor } from '../../../../servidor/sessao'

/**
 * Arquiva uma nota do setor.
 *
 * `DELETE` na rota, CARIMBO no banco — mesma escolha de `afastamentos/[id]`. A
 * linha sobrevive porque "por que a equipe conferia esse documento em março?"
 * é pergunta legítima, e um `DELETE` real a deixaria sem resposta para sempre.
 *
 * Quem arquiva: o autor, ou o gestor. A checagem mora no serviço, junto da
 * transação — não aqui.
 */
export async function DELETE(
  requisicao: Request,
  contexto: { params: Promise<{ id: string }> },
): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    const { id } = await contexto.params

    // O motivo é opcional, então o corpo também é: `DELETE` sem corpo é uma
    // requisição legítima aqui, e tratá-la como erro obrigaria toda tela a
    // enviar `{}` só para satisfazer o analisador.
    const corpo = await corpoJson(requisicao).catch(() => ({}))

    return responder(await arquivar(obterPrisma(), id, corpo, ator))
  })
}
