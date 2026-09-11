import { ErroDeNegocio } from '../core/erros'
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
 * Redige a observação de afastamentos antigos — dado de saúde, art. 11 da LGPD.
 *
 * ═══ O PRAZO AINDA NÃO FOI DECIDIDO ═══
 *
 * `DECISOES.md § H.4`, item 12, é a pergunta aberta mais urgente da lista, e é
 * da chefia do setor, não da engenharia. Os 90 dias daqui são HIPÓTESE — estão
 * registrados em `DECISOES.md § C` — e existem para que a capacidade exista
 * antes da resposta, não para responder no lugar dela.
 *
 * Por isso esta rotina **não roda sozinha**: não há agendador, nem gatilho, nem
 * chamada a partir de rota nenhuma. Só `npm run db:expurgar`, por decisão de
 * quem executa. Ligá-la a um agendador sem a resposta da chefia seria
 * transformar hipótese em regra em silêncio, que é o que o `CLAUDE.md` proíbe.
 *
 * ═══ O QUE FICA ═══
 *
 * O afastamento, o tipo e as datas sobrevivem: são eles que respondem por que
 * alguém ficou fora do rateio numa terça-feira de março, e o invariante 11 diz
 * que histórico operacional não se apaga. Some só o texto livre, que é onde o
 * dado sensível de verdade mora.
 *
 * ═══ O QUE ESTA ROTINA NÃO ALCANÇA ═══
 *
 * Nada de `EmailConteudo`, bytes de anexo, `Item.payload` ou `Revisao` — os
 * itens 10 e 11 do `§ H.4`, também sem resposta. O nome do arquivo fala de
 * LGPD; o alcance é um campo só, e é melhor que isso esteja escrito aqui do que
 * alguém suponha cobertura que não existe.
 */
export const DIAS_DE_RETENCAO_HIPOTETICOS = 90

export async function expurgarObservacoesAfastamento(
  banco: Banco,
  diasRetencao = DIAS_DE_RETENCAO_HIPOTETICOS,
  dataReferencia = hojeIso(),
  atorId = 'sistema',
): Promise<ResultadoExpurgo> {
  // A redação é `UPDATE` destrutivo: o texto não volta. Uma retenção negativa
  // — `DIAS_RETENCAO_AFAS=-30` num agendador, ou `Number('abc')` virando `NaN` —
  // produziria uma data de corte no FUTURO e redigiria a observação de todos os
  // afastamentos encerrados, inclusive o de ontem. Falha antes de tocar em
  // qualquer linha.
  if (!Number.isInteger(diasRetencao) || diasRetencao < 1) {
    throw new ErroDeNegocio(
      `Retenção inválida para o expurgo: "${diasRetencao}". Precisa ser um número inteiro de dias, maior ou igual a 1.`,
      'RETENCAO_INVALIDA',
    )
  }

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
