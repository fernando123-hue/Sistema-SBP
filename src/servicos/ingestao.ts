import {
  EmailBrutoSchema,
  TAMANHO_MAXIMO_ANEXO_BYTES,
  serializar,
  type EmailBruto,
  type Interpretacao,
  type MotivoRevisao,
} from '../core/esquemas'
import { validarAnexo } from '../core/seguranca/conteudo-nao-confiavel'
import { paraDataIso } from '../core/util/datas'
import type { AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { ATOR_SISTEMA, exigirPapel, type Ator } from '../servidor/ator'
import type { Banco, Transacao } from '../servidor/prisma'
import {
  mensagemDoErro,
  novaCorrelacao,
  registrarEvento,
  registrarLog,
} from '../servidor/observabilidade'
import { auditar } from './auditoria'

/**
 * Ingestão e interpretação.
 *
 * IDEMPOTÊNCIA é o requisito central: o mesmo e-mail pode chegar duas vezes —
 * reprocessamento manual, retry do adapter, reconexão do IMAP. `Email.messageId`
 * é único no banco, e um e-mail já processado é pulado, não reinterpretado.
 * Sem isso, um retry duplicaria carga de trabalho e envenenaria o balanceamento.
 */

export interface DependenciasIngestao {
  banco: Banco
  ingestao: IngestaoPort
  ia: AiPort
}

export interface ResumoIngestao {
  correlacaoId: string
  recebidos: number
  novos: number
  duplicados: number
  itensCriados: number
  itensAprovados: number
  itensParaRevisao: number
  falhas: number
  anexosRejeitados: number
}

export async function sincronizar(
  deps: DependenciasIngestao,
  ator: Ator = ATOR_SISTEMA,
): Promise<ResumoIngestao> {
  exigirPapel(ator, 'sincronizar ingestão', 'operador', 'gestor')
  const usuario = ator.colaboradorId
  const correlacaoId = novaCorrelacao()
  const inicio = Date.now()

  const resumo: ResumoIngestao = {
    correlacaoId,
    recebidos: 0,
    novos: 0,
    duplicados: 0,
    itensCriados: 0,
    itensAprovados: 0,
    itensParaRevisao: 0,
    falhas: 0,
    anexosRejeitados: 0,
  }

  const brutos = await deps.ingestao.buscarNovos()
  resumo.recebidos = brutos.length

  await registrarEvento(deps.banco, {
    correlacaoId,
    etapa: 'ingestao',
    situacao: 'iniciado',
    mensagem: `${brutos.length} e-mails recebidos do adapter "${deps.ingestao.nome}"`,
  })

  for (const candidato of brutos) {
    try {
      const email = EmailBrutoSchema.parse(candidato)

      const jaExiste = await deps.banco.email.findUnique({
        where: { messageId: email.messageId },
        select: { id: true, processadoEm: true },
      })

      if (jaExiste?.processadoEm) {
        resumo.duplicados += 1
        continue
      }

      const resultado = await processarUm(deps, email, correlacaoId, usuario)

      // A checagem de existência acima é só economia de chamada de IA. Duas
      // sincronizações concorrentes podem passar por ela antes de qualquer uma
      // gravar; quem chega depois descobre dentro da transação e conta como
      // duplicado — não como falha.
      if (resultado === null) {
        resumo.duplicados += 1
        continue
      }

      resumo.novos += 1
      resumo.itensCriados += resultado.criados
      resumo.itensAprovados += resultado.aprovados
      resumo.itensParaRevisao += resultado.paraRevisao
      resumo.anexosRejeitados += resultado.anexosRejeitados
    } catch (erro) {
      // Violação de unicidade é corrida perdida, não defeito: o outro processo
      // já gravou o mesmo e-mail. Contar como falha produziria alerta enganoso.
      if (ehViolacaoDeUnicidade(erro)) {
        resumo.duplicados += 1
        continue
      }

      resumo.falhas += 1
      registrarLog('erro', 'falha ao processar e-mail', {
        correlacaoId,
        messageId: candidato.messageId,
        erro: mensagemDoErro(erro),
      })
      await registrarEvento(deps.banco, {
        correlacaoId,
        etapa: 'ingestao',
        // `reprocessavel`: o e-mail não foi marcado como processado, então uma
        // nova sincronização tenta de novo sem duplicar o que já entrou.
        situacao: 'reprocessavel',
        referencia: candidato.messageId,
        mensagem: mensagemDoErro(erro),
      })
    }
  }

  await registrarEvento(deps.banco, {
    correlacaoId,
    etapa: 'ingestao',
    situacao: resumo.falhas > 0 ? 'falha' : 'sucesso',
    mensagem: `${resumo.novos} novos · ${resumo.duplicados} duplicados · ${resumo.itensCriados} itens`,
    detalhe: resumo,
    duracaoMs: Date.now() - inicio,
  })

  return resumo
}

interface ResultadoDeUm {
  criados: number
  aprovados: number
  paraRevisao: number
  anexosRejeitados: number
}

/** `P2002` é o código do Prisma para violação de constraint única. */
function ehViolacaoDeUnicidade(erro: unknown): boolean {
  return (
    typeof erro === 'object' &&
    erro !== null &&
    'code' in erro &&
    (erro as { code?: unknown }).code === 'P2002'
  )
}

/** Devolve `null` quando o e-mail já havia sido processado por outra execução. */
async function processarUm(
  deps: DependenciasIngestao,
  email: EmailBruto,
  correlacaoId: string,
  usuario: string,
): Promise<ResultadoDeUm | null> {
  // A interpretação roda FORA da transação: chamada de modelo é lenta e não
  // deve segurar lock de banco. Se falhar, nada foi gravado.
  const interpretacao = await deps.ia.interpretar(email)

  const anexosAvaliados = email.anexos.map((anexo) => ({
    ...anexo,
    veredicto: validarAnexo(anexo.nome, anexo.tamanho, TAMANHO_MAXIMO_ANEXO_BYTES),
  }))
  const anexosRejeitados = anexosAvaliados.filter((anexo) => !anexo.veredicto.aceito).length

  return deps.banco.$transaction(async (tx) => {
    // Segunda checagem, agora DENTRO da transação: fecha a janela entre a
    // verificação de existência e a gravação.
    const jaProcessado = await tx.email.findUnique({
      where: { messageId: email.messageId },
      select: { processadoEm: true },
    })
    if (jaProcessado?.processadoEm) return null

    const registro = await tx.email.upsert({
      where: { messageId: email.messageId },
      create: {
        messageId: email.messageId,
        remetente: email.remetente,
        assunto: email.assunto,
        corpo: email.corpo,
        anexos: serializar(
          anexosAvaliados.map((anexo) => ({
            nome: anexo.veredicto.nomeSeguro,
            tipoDeclarado: anexo.tipoDeclarado,
            tamanho: anexo.tamanho,
            aceito: anexo.veredicto.aceito,
            motivo: anexo.veredicto.motivo ?? null,
          })),
        ),
        origem: email.origem,
        recebidoEm: email.recebidoEm,
        modeloIa: interpretacao.modelo,
        versaoPrompt: interpretacao.versaoPrompt,
        processadoEm: new Date(),
      },
      update: { processadoEm: new Date() },
    })

    const resultado = await criarItens(tx, {
      emailId: registro.id,
      interpretacao,
      anexosRejeitados,
      correlacaoId,
      usuario,
    })

    await auditar(tx, {
      entidade: 'Email',
      entidadeId: registro.id,
      acao: 'ingerido',
      depois: {
        messageId: email.messageId,
        itens: resultado.criados,
        conteudoSuspeito: interpretacao.conteudoSuspeito,
      },
      usuario,
      correlacaoId,
    })

    return { ...resultado, anexosRejeitados }
  })
}

async function criarItens(
  tx: Transacao,
  contexto: {
    emailId: string
    interpretacao: Interpretacao
    anexosRejeitados: number
    correlacaoId: string
    usuario: string
  },
): Promise<Omit<ResultadoDeUm, 'anexosRejeitados'>> {
  const { interpretacao } = contexto
  let criados = 0
  let aprovados = 0
  let paraRevisao = 0

  for (const [posicao, extraido] of interpretacao.itens.entries()) {
    const categoria = await tx.categoria.findUnique({
      where: { codigo: extraido.categoriaCodigo },
      select: { id: true, limiarConfianca: true },
    })
    if (!categoria) continue

    const motivo = decidirRevisao(
      extraido.confianca,
      categoria.limiarConfianca,
      extraido.camposAusentes.length > 0,
      interpretacao.conteudoSuspeito,
      contexto.anexosRejeitados > 0,
    )

    const item = await tx.item.create({
      data: {
        emailId: contexto.emailId,
        categoriaId: categoria.id,
        sequencia: posicao + 1,
        titulo: extraido.titulo,
        payload: serializar({
          campos: extraido.campos,
          camposAusentes: extraido.camposAusentes,
          ligaMencionada: extraido.ligaMencionada,
          observacao: extraido.observacao,
        }),
        confianca: extraido.confianca,
        status: motivo ? 'aguardando_revisao' : 'aprovado',
        modeloIa: interpretacao.modelo,
        versaoPrompt: interpretacao.versaoPrompt,
      },
    })

    criados += 1

    if (motivo) {
      paraRevisao += 1
      await tx.revisao.create({
        data: {
          itemId: item.id,
          motivo,
          campoIncerto: extraido.camposAusentes[0] ?? null,
          sugestaoIa: serializar(extraido),
          confianca: extraido.confianca,
        },
      })
    } else {
      aprovados += 1
    }
  }

  return { criados, aprovados, paraRevisao }
}

/**
 * Decide se o item precisa de olho humano.
 *
 * Conservador de propósito: começa exigindo muita revisão e afrouxa conforme a
 * taxa de acerto MEDIDA, nunca conforme impressão. Qualquer um dos gatilhos
 * basta — eles não se anulam.
 */
function decidirRevisao(
  confianca: number,
  limiar: number,
  temCampoAusente: boolean,
  conteudoSuspeito: boolean,
  anexoRejeitado: boolean,
): MotivoRevisao | null {
  if (conteudoSuspeito) return 'conteudo_suspeito'
  if (anexoRejeitado) return 'anomalia'
  if (confianca < limiar) return 'baixa_confianca'
  if (temCampoAusente) return 'campo_ausente'
  return null
}

/** Data ISO de um e-mail, para agrupar a fila do dia. */
export function dataDoEmail(recebidoEm: Date): string {
  return paraDataIso(recebidoEm)
}
