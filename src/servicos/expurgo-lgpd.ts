import { TipoDeAfastamentoGravadoSchema } from '../core/esquemas'
import { lerDoBanco } from '../core/lido-do-banco'
import { exigirPrazoValido, motivoVenceu, tipoDepoisDoPrazo } from '../core/retencao'
import { hojeIso, paraDataIso } from '../core/util/datas'
import { novaCorrelacao } from '../servidor/observabilidade'
import type { Banco } from '../servidor/prisma'
import { auditarLote, type EntradaAuditoria } from './auditoria'

export interface ResultadoDoExpurgoDeMotivos {
  /** Ausências cujo relógio já começou e que ainda não tinham passado pelo prazo. */
  avaliados: number
  /** Dessas, as que venceram e foram carimbadas. */
  vencidos: number
  /** Das vencidas, as que tinham algo a apagar: observação, ou tipo que não era férias. */
  apagados: number
}

export interface OpcoesDoExpurgoDeMotivos {
  diasDeRetencao: number
  hoje?: string
  atorId?: string
  /** A da rotina diária, para a trilha deste expurgo se ligar à execução que o fez. */
  correlacaoId?: string
}

/**
 * Apaga o motivo das ausências cujo prazo venceu — `DECISOES.md § A17`.
 *
 * ═══ O QUE SAI ═══
 *
 * A observação livre, inteira, e o tipo reduzido a `ferias` ou `ausente`. É o
 * motivo que é dado de saúde; o fato de a pessoa ter estado fora não é.
 *
 * ═══ O QUE FICA ═══
 *
 * A linha, as datas e o carimbo de cancelamento: são eles que respondem por que
 * alguém ficou fora do rateio numa terça-feira de março, e o invariante 11 diz
 * que histórico operacional não se apaga.
 *
 * ═══ QUANDO ═══
 *
 * A fronteira do dia mora em `core/retencao.ts`, não aqui. Esta função só
 * busca as candidatas e pergunta a ela — a mesma função responde ao aviso que
 * diz à gestora que motivos vão sair. Duas cópias da conta seriam dois
 * relógios, e o aviso poderia prometer um dia que a limpeza não cumpre.
 *
 * ═══ A TRILHA NÃO GUARDA O QUE FOI APAGADO ═══
 *
 * A linha de auditoria diz qual ausência, o tipo que ficou e se havia
 * observação — nunca o tipo antigo nem o texto. A trilha é append-only: copiar
 * "atestado" para ela seria guardar para sempre, num lugar que nenhuma
 * retenção alcança, exatamente o que este expurgo existe para tirar.
 */
export async function expurgarMotivosDeAfastamento(
  banco: Banco,
  opcoes: OpcoesDoExpurgoDeMotivos,
): Promise<ResultadoDoExpurgoDeMotivos> {
  // Antes de abrir a transação: um `NaN` aqui viraria data de corte no futuro
  // e apagaria o motivo de quem voltou ontem.
  exigirPrazoValido(opcoes.diasDeRetencao)

  const dias = opcoes.diasDeRetencao
  const hoje = opcoes.hoje ?? hojeIso()
  const usuario = opcoes.atorId ?? 'sistema'
  const correlacaoId = opcoes.correlacaoId ?? novaCorrelacao()

  return banco.$transaction(async (tx) => {
    // Só as que ainda guardam o motivo e cujo relógio já pode ter começado:
    // ausência em aberto e não cancelada nem entra na conta. O carimbo tira da
    // lista quem já passou, então o conjunto não cresce com o histórico.
    const candidatas = await tx.afastamento.findMany({
      where: {
        motivoExpurgadoEm: null,
        OR: [{ fim: { not: null } }, { canceladoEm: { not: null } }],
      },
      select: { id: true, colaboradorId: true, tipo: true, fim: true, canceladoEm: true, observacao: true },
    })

    const vencidas = candidatas.filter((afastamento) =>
      motivoVenceu(
        {
          fim: afastamento.fim,
          // O dia do cancelamento no fuso da operação: um cancelamento às 22h
          // de Brasília já é o dia seguinte em UTC.
          canceladoNoDia: afastamento.canceladoEm === null ? null : paraDataIso(afastamento.canceladoEm),
        },
        hoje,
        dias,
      ),
    )

    const agora = new Date()
    const trilha: EntradaAuditoria[] = []

    for (const afastamento of vencidas) {
      // Tipo fora da lista falha ALTO e desfaz a transação inteira. Reduzir
      // qualquer texto desconhecido a `ausente` seria o lado seguro para a
      // privacidade — e esconderia uma linha corrompida que outras telas
      // também leem. A falha aparece na execução da rotina, não some.
      const tipo = lerDoBanco(TipoDeAfastamentoGravadoSchema, afastamento.tipo, 'Afastamento.tipo')
      const tipoQueFica = tipoDepoisDoPrazo(tipo)

      await tx.afastamento.update({
        where: { id: afastamento.id },
        data: { observacao: null, tipo: tipoQueFica, motivoExpurgadoEm: agora },
      })

      // Férias sem observação vence e é carimbada, mas não tinha nada a
      // apagar: uma linha na trilha por férias comum seria ruído que ensina a
      // não ler a trilha.
      const havia = afastamento.observacao !== null || tipo !== tipoQueFica
      if (havia) {
        trilha.push({
          entidade: 'Colaborador',
          entidadeId: afastamento.colaboradorId,
          acao: 'afastamento_motivo_expurgado',
          depois: {
            afastamentoId: afastamento.id,
            tipoQueFica,
            observacaoApagada: afastamento.observacao !== null,
            prazoEmDias: dias,
          },
          usuario,
          correlacaoId,
        })
      }
    }

    await auditarLote(tx, trilha)

    return { avaliados: candidatas.length, vencidos: vencidas.length, apagados: trilha.length }
  })
}
