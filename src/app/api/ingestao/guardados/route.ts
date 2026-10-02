import { contarGuardadosPorDado } from '../../../../servicos/guardados-por-dado'
import { exigirPapel } from '../../../../servidor/ator'
import { limitar, responder, rota, semCache } from '../../../../servidor/http'
import { obterPrisma } from '../../../../servidor/prisma'
import { exigirAtor } from '../../../../servidor/sessao'

/**
 * Quantos e-mails estão guardados por "sem item, mas com CPF, CRM ou anexo"
 * (`AT-73`, `A76`): o aviso da Distribuição, lido do banco para durar os 30
 * dias da guarda. Só o número, para quem distribui.
 */
export async function GET(): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    exigirPapel(ator, 'acompanhar a busca de e-mails', 'operador', 'gestor')

    const recusa = limitar(`ingestao-guardados:${ator.colaboradorId}`, 60, 60)
    if (recusa) return recusa

    return semCache(responder({ guardados: await contarGuardadosPorDado(obterPrisma()) }))
  })
}
