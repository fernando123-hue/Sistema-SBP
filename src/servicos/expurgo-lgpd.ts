import { hojeIso } from '../core/util/datas'
import { novaCorrelacao } from '../servidor/observabilidade'
import type { Banco } from '../servidor/prisma'
import { auditar } from './auditoria'

export interface ResultadoExpurgo {
  processados: number
  expurgados: number
  dataCorte: string
}

function calcularDataCorte(dataReferencia: string, diasRetencao: number): string {
  const d = new Date(`${dataReferencia}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - diasRetencao)
  return d.toISOString().slice(0, 10)
}

/**
 * Expurgo LGPD para dados de saúde (decisão H.4).
 *
 * Anonimiza/redige a propriedade `observacao` de registros de afastamento cuja
 * ausência já foi encerrada há mais de `diasRetencao` (padrão: 90 dias).
 *
 * Mantém o registro do afastamento, tipo e datas para assegurar a
 * auditabilidade histórica da escala e do rateio de carga, removendo apenas a
 * justificativa de saúde/texto livre sigiloso.
 */
export async function expurgarObservacoesAfastamento(
  banco: Banco,
  diasRetencao = 90,
  dataReferencia = hojeIso(),
  atorId = 'sistema',
): Promise<ResultadoExpurgo> {
  const dataCorte = calcularDataCorte(dataReferencia, diasRetencao)
  const correlacaoId = novaCorrelacao()

  return banco.$transaction(async (tx) => {
    const alvos = await tx.afastamento.findMany({
      where: {
        observacao: { not: null },
        NOT: { observacao: '[EXPURGADO LGPD]' },
        OR: [
          { fim: { lt: dataCorte } },
          { AND: [{ fim: null }, { canceladoEm: { not: null } }, { inicio: { lt: dataCorte } }] },
        ],
      },
      select: { id: true, colaboradorId: true, tipo: true, inicio: true, fim: true },
    })

    if (alvos.length === 0) {
      return { processados: 0, expurgados: 0, dataCorte }
    }

    for (const item of alvos) {
      await tx.afastamento.update({
        where: { id: item.id },
        data: { observacao: '[EXPURGADO LGPD]' },
      })

      await auditar(tx, {
        entidade: 'Colaborador',
        entidadeId: item.colaboradorId,
        acao: 'afastamento_observacao_expurgada',
        depois: {
          afastamentoId: item.id,
          dataCorte,
          diasRetencao,
        },
        usuario: atorId,
        correlacaoId,
      })
    }

    return {
      processados: alvos.length,
      expurgados: alvos.length,
      dataCorte,
    }
  })
}
