import { conteudoVenceu, exigirPrazoValido, type ItemNoRelogio } from '../core/retencao'
import { hojeIso, paraDataIso } from '../core/util/datas'
import { FalhaDeArmazenamento, type ArmazenamentoPort } from '../ports/armazenamento'
import { mensagemDoErro, novaCorrelacao, registrarLog } from '../servidor/observabilidade'
import type { Banco } from '../servidor/prisma'
import { auditar } from './auditoria'

export interface ResultadoDoExpurgoDeConteudo {
  /** E-mails que ainda guardavam conteúdo. */
  avaliados: number
  /** Desses, os que venceram. */
  vencidos: number
  /** Dos vencidos, os que tiveram o conteúdo apagado nesta execução. */
  apagados: number
  /** Arquivos de anexo removidos do armazenamento. */
  anexosRemovidos: number
}

export interface OpcoesDoExpurgoDeConteudo {
  diasDeRetencao: number
  /** `null` quando o armazenamento não pôde ser criado: e-mail com anexo não é marcado. */
  armazenamento: ArmazenamentoPort | null
  hoje?: string
  atorId?: string
  correlacaoId?: string
}

/**
 * Apaga o conteúdo dos e-mails cujo prazo venceu — `DECISOES.md § A20`.
 *
 * ═══ O QUE SAI ═══
 *
 * `EmailConteudo` inteiro (remetente, assunto, corpo) e os BYTES de cada anexo
 * guardado. O sistema guarda o contexto e o processo, não o dado bruto.
 *
 * ═══ O QUE FICA ═══
 *
 * A linha do e-mail com data e hora de chegada, os itens, as atribuições, as
 * execuções, a carga, a trilha e os METADADOS do anexo (nome, tipo, tamanho) —
 * invariante 11. É com a data e a hora de chegada que a pessoa acha o original
 * no Outlook.
 *
 * ═══ O ARQUIVO SAI ANTES DA MARCA NO BANCO ═══
 *
 * Marcar primeiro e apagar o arquivo depois deixaria, a cada falha de disco, um
 * documento de associado no armazenamento com o banco dizendo que ele não
 * existe mais — um órfão que nenhuma limpeza futura alcança, porque a limpeza
 * caminha pelas linhas marcadas como pendentes. Na ordem inversa, a falha deixa
 * o e-mail pendente, e a execução seguinte tenta de novo: `remover` é
 * idempotente.
 *
 * ═══ UMA FALHA NÃO SEGURA OS OUTROS, E NÃO PASSA CALADA ═══
 *
 * Cada e-mail é uma transação. O que falhou fica pendente e registrado; os
 * demais seguem; e no fim a execução falha alto, para a rotina diária ficar
 * `falha` e a gestora ver no aviso do dia.
 */
export async function expurgarConteudoDosEmails(
  banco: Banco,
  opcoes: OpcoesDoExpurgoDeConteudo,
): Promise<ResultadoDoExpurgoDeConteudo> {
  exigirPrazoValido(opcoes.diasDeRetencao)

  const dias = opcoes.diasDeRetencao
  const hoje = opcoes.hoje ?? hojeIso()
  const usuario = opcoes.atorId ?? 'sistema'
  const correlacaoId = opcoes.correlacaoId ?? novaCorrelacao()

  // O carimbo tira da lista quem já passou; o que sobra são os e-mails com
  // trabalho recente ou aberto, e não cresce com o histórico.
  const candidatos = await banco.email.findMany({
    where: { conteudoExpurgadoEm: null },
    select: {
      id: true,
      recebidoEm: true,
      conteudoSuspeito: true,
      itens: {
        select: {
          status: true,
          canceladoEm: true,
          execucoes: { where: { resultado: 'concluido' }, select: { concluidoEm: true } },
        },
      },
      anexos: {
        where: { chaveArmazenamento: { not: null } },
        select: { id: true, chaveArmazenamento: true },
      },
    },
  })

  const vencidos = candidatos.filter((email) =>
    conteudoVenceu(
      {
        recebidoNoDia: paraDataIso(email.recebidoEm),
        conteudoSuspeito: email.conteudoSuspeito,
        itens: email.itens.map(situacaoNoRelogio),
      },
      hoje,
      dias,
    ),
  )

  let apagados = 0
  let anexosRemovidos = 0
  const falhas: string[] = []

  for (const email of vencidos) {
    const chaves = email.anexos
      .map((anexo) => anexo.chaveArmazenamento)
      .filter((chave): chave is string => chave !== null)

    try {
      if (chaves.length > 0 && opcoes.armazenamento === null) {
        throw new FalhaDeArmazenamento('remover', 'armazenamento indisponível nesta execução')
      }
      for (const chave of chaves) await opcoes.armazenamento!.remover(chave)

      const agora = new Date()
      await banco.$transaction(async (tx) => {
        // `deleteMany`, não `delete`: uma linha de conteúdo que já não existe
        // (apagada à mão) não pode impedir o carimbo que tira o e-mail da lista.
        await tx.emailConteudo.deleteMany({ where: { emailId: email.id } })
        await tx.anexo.updateMany({
          where: { emailId: email.id, chaveArmazenamento: { not: null } },
          data: { chaveArmazenamento: null, bytesExpurgadosEm: agora },
        })
        await tx.email.update({ where: { id: email.id }, data: { conteudoExpurgadoEm: agora } })
        await auditar(tx, {
          entidade: 'Email',
          entidadeId: email.id,
          acao: 'conteudo_do_email_expurgado',
          // Só o fato e as contagens. Remetente, assunto e nome de anexo nunca
          // entram na trilha, que nenhuma retenção alcança.
          depois: { anexosRemovidos: chaves.length, prazoEmDias: dias },
          usuario,
          correlacaoId,
        })
      })

      apagados += 1
      anexosRemovidos += chaves.length
    } catch (erro) {
      falhas.push(email.id)
      registrarLog('erro', 'conteúdo de e-mail vencido não pôde ser apagado; continua guardado', {
        correlacaoId,
        emailId: email.id,
        erro: mensagemDoErro(erro),
      })
    }
  }

  if (falhas.length > 0) {
    throw new FalhaDeArmazenamento(
      'remover',
      `${falhas.length} e-mail(s) vencido(s) continuam com o conteúdo guardado — ${apagados} apagado(s) nesta execução`,
    )
  }

  return { avaliados: candidatos.length, vencidos: vencidos.length, apagados, anexosRemovidos }
}

/**
 * O item visto pelo relógio.
 *
 * Concluído sem registro de conclusão, ou cancelado sem carimbo, conta como
 * ABERTO: é linha inconsistente, e na dúvida o conteúdo fica. Apagar a partir de
 * uma data inventada é o erro que não tem volta.
 */
function situacaoNoRelogio(item: {
  status: string
  canceladoEm: Date | null
  execucoes: { concluidoEm: Date | null }[]
}): ItemNoRelogio {
  if (item.status === 'cancelado') {
    return item.canceladoEm === null ? { aberto: true } : { aberto: false, terminouNoDia: paraDataIso(item.canceladoEm) }
  }

  if (item.status === 'concluido') {
    const conclusoes = item.execucoes
      .map((execucao) => execucao.concluidoEm)
      .filter((quando): quando is Date => quando !== null)
    if (conclusoes.length === 0) return { aberto: true }
    const ultima = new Date(Math.max(...conclusoes.map((quando) => quando.getTime())))
    return { aberto: false, terminouNoDia: paraDataIso(ultima) }
  }

  return { aberto: true }
}
