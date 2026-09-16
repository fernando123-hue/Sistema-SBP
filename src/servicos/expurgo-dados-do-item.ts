import { ErroDeNegocio } from '../core/erros'
import { PayloadDoItemSchema, desserializar, serializar } from '../core/esquemas'
import {
  reduzirPayloadDoItem,
  reduzirSugestaoIa,
  reduzirValorFinal,
  tituloNeutro,
} from '../core/expurgo-do-item'
import { nomeDeCampoGravavel } from '../core/nome-de-campo'
import { conteudoVenceu, exigirPrazoValido } from '../core/retencao'
import { hojeIso, paraDataIso } from '../core/util/datas'
import { mensagemDoErro, novaCorrelacao, registrarLog } from '../servidor/observabilidade'
import type { Banco } from '../servidor/prisma'
import { auditar } from './auditoria'
import { situacaoNoRelogio } from './expurgo-conteudo'
import { lerPar } from './qualidade'
import { acertoDaRevisao } from './revisao'

export interface ResultadoDoExpurgoDosDadosDoItem {
  /** Itens que ainda guardavam dados e podiam estar vencidos. */
  avaliados: number
  /** Desses, os que venceram. */
  vencidos: number
  /** Dos vencidos, os que tiveram os dados apagados nesta execução. */
  apagados: number
  /** Dos apagados, os que vieram de e-mail e os registrados à mão. */
  deEmail: number
  registradosAMao: number
  /** Revisões resolvidas antes do `A23(c)` que ganharam o acerto antes de perder os valores. */
  acertosGravados: number
}

export interface OpcoesDoExpurgoDosDadosDoItem {
  diasDeRetencao: number
  hoje?: string
  atorId?: string
  correlacaoId?: string
}

const PAYLOAD_ILEGIVEL = {
  campos: {},
  camposAusentes: [],
  ligaMencionada: null,
  observacao: null,
  revisadoPorHumano: false,
}

/**
 * Apaga o que a IA extraiu, o título e os valores da revisão dos itens vencidos
 * — `DECISOES.md § A23(a)`.
 *
 * ═══ QUAIS ITENS ═══
 *
 * - **De e-mail:** os do e-mail cujo texto já saiu (`A20`). É o mesmo relógio,
 *   sem um segundo cálculo: a limpeza do conteúdo roda antes, na mesma rotina,
 *   então o item de um e-mail apagado hoje sai hoje. Pega também os itens de
 *   e-mail apagado ANTES de esta limpeza existir, que nenhum outro caminho
 *   alcançaria.
 * - **Registrados à mão:** contam da própria conclusão ou cancelamento (`A40`,
 *   resposta 23), pelo mesmo `conteudoVenceu`, com um item só.
 *
 * ═══ O QUE SAI E O QUE FICA ═══
 *
 * Sai: título (vira neutro, `A41`), campos extraídos, liga mencionada,
 * observação digitada no registro, título e campos da sugestão e da decisão da
 * revisão, e o texto das justificativas de transferência e devolução (`A40`,
 * resposta 25). Fica: a chave de busca (`A23(b)`), categoria, liga, carga,
 * atribuições, a trilha e a observação escrita ao concluir (`A41`, resposta 27).
 *
 * ═══ O ACERTO É GRAVADO ANTES ═══
 *
 * Revisão resolvida antes de o acerto passar a ser gravado na hora não tem
 * `desfecho`. Apagar os valores sem gravá-lo faria a comparação de depois ver
 * vazio contra vazio e contar ACERTO — uma taxa que melhora sozinha.
 *
 * ═══ UMA TRANSAÇÃO POR ITEM, E FALHA ALTO ═══
 *
 * Cada item é uma transação: o que falhou fica com os dados e é tentado de novo
 * na execução seguinte; os demais seguem; e no fim a execução falha, para a
 * rotina diária ficar `falha` e a gestora ver no aviso do dia.
 */
export async function expurgarDadosDosItens(
  banco: Banco,
  opcoes: OpcoesDoExpurgoDosDadosDoItem,
): Promise<ResultadoDoExpurgoDosDadosDoItem> {
  exigirPrazoValido(opcoes.diasDeRetencao)

  const dias = opcoes.diasDeRetencao
  const hoje = opcoes.hoje ?? hojeIso()
  const usuario = opcoes.atorId ?? 'sistema'
  const correlacaoId = opcoes.correlacaoId ?? novaCorrelacao()

  // O carimbo tira da lista quem já passou. Item à mão concluído entra na lista
  // até vencer — no máximo o prazo em dias —, então ela não cresce com o tempo.
  const candidatos = await banco.item.findMany({
    where: {
      dadosExtraidosExpurgadosEm: null,
      OR: [
        { email: { conteudoExpurgadoEm: { not: null } } },
        { emailId: null, status: { in: ['concluido', 'cancelado'] } },
      ],
    },
    select: {
      id: true,
      emailId: true,
      payload: true,
      sequencia: true,
      status: true,
      canceladoEm: true,
      criadoEm: true,
      categoria: { select: { rotulo: true } },
      liga: { select: { nome: true } },
      email: { select: { _count: { select: { itens: true } } } },
      execucoes: { where: { resultado: 'concluido' }, select: { concluidoEm: true } },
      revisoes: {
        select: {
          id: true,
          sugestaoIa: true,
          valorFinal: true,
          desfecho: true,
          campoIncerto: true,
          resolvidoEm: true,
        },
      },
    },
  })

  const vencidos = candidatos.filter((item) => {
    const situacao = situacaoNoRelogio(item)

    // Duas travas que valem para TODO item, inclusive o de e-mail já apagado:
    // item aberto e revisão por resolver seguram os dados. O carimbo do e-mail
    // sozinho é garantia de outro serviço, e um cancelamento ou reenvio futuro
    // poderia quebrá-la sem ninguém ver (`§ AT-27`).
    if (situacao.aberto) return false
    if (item.revisoes.some((revisao) => revisao.resolvidoEm === null)) return false

    if (item.emailId !== null) return true
    return conteudoVenceu(
      { recebidoNoDia: paraDataIso(item.criadoEm), conteudoSuspeito: false, itens: [situacao] },
      hoje,
      dias,
    )
  })

  let apagados = 0
  let deEmail = 0
  let registradosAMao = 0
  let acertosGravados = 0
  const falhas: string[] = []

  for (const item of vencidos) {
    try {
      const agora = new Date()
      const gravadosNesteItem = await banco.$transaction(async (tx) => {
        let gravados = 0

        for (const revisao of item.revisoes) {
          let acerto = {}
          if (revisao.resolvidoEm !== null && revisao.desfecho === null) {
            const par = lerPar(revisao.sugestaoIa, revisao.valorFinal)
            if (par !== null) {
              acerto = acertoDaRevisao(revisao.id, revisao.sugestaoIa, par.decisao)
              gravados += 1
            }
          }

          await tx.revisao.update({
            where: { id: revisao.id },
            data: {
              ...acerto,
              sugestaoIa: reduzirSugestaoIa(revisao.sugestaoIa),
              valorFinal: reduzirValorFinal(revisao.valorFinal),
              campoIncerto: revisao.campoIncerto === null ? null : nomeDeCampoGravavel(revisao.campoIncerto),
            },
          })
        }

        const justificativas = await tx.justificativaDeAtribuicao.deleteMany({
          where: { atribuicao: { itemId: item.id } },
        })

        await tx.item.update({
          where: { id: item.id },
          data: {
            titulo: tituloNeutro({
              categoriaRotulo: item.categoria.rotulo,
              ligaNome: item.liga?.nome ?? null,
              sequencia: item.sequencia,
              itensNoEmail: item.email?._count.itens ?? null,
            }),
            // Payload ilegível também sai: guardar por não conseguir ler seria o
            // dado pessoal ficando por defeito.
            payload: serializar(
              reduzirPayloadDoItem(desserializar(item.payload, PayloadDoItemSchema, PAYLOAD_ILEGIVEL)),
            ),
            dadosExtraidosExpurgadosEm: agora,
          },
        })

        await auditar(tx, {
          entidade: 'Item',
          entidadeId: item.id,
          acao: 'dados_do_item_expurgados',
          // Só o fato e as contagens. Título, campos e justificativas nunca entram
          // na trilha, que nenhuma retenção alcança.
          depois: {
            origem: item.emailId === null ? 'registro_manual' : 'email',
            revisoes: item.revisoes.length,
            acertosGravados: gravados,
            justificativasApagadas: justificativas.count,
            prazoEmDias: dias,
          },
          usuario,
          correlacaoId,
        })

        return gravados
      })

      apagados += 1
      acertosGravados += gravadosNesteItem
      if (item.emailId === null) registradosAMao += 1
      else deEmail += 1
    } catch (erro) {
      falhas.push(item.id)
      registrarLog('erro', 'dados de item vencido não puderam ser apagados; continuam guardados', {
        correlacaoId,
        itemId: item.id,
        erro: mensagemDoErro(erro),
      })
    }
  }

  if (falhas.length > 0) {
    // `ErroDeNegocio`, e não um `Error` qualquer: a rotina grava a mensagem de
    // erro de domínio, e só o nome da classe dos outros — a gestora precisa ver
    // quantos itens ficaram.
    throw new ErroDeNegocio(
      `${falhas.length} item(ns) vencido(s) continuam com os dados guardados — ${apagados} apagado(s) nesta execução`,
    )
  }

  return { avaliados: candidatos.length, vencidos: vencidos.length, apagados, deEmail, registradosAMao, acertosGravados }
}
