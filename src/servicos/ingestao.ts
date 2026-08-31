import {
  EmailBrutoSchema,
  TAMANHO_MAXIMO_ANEXO_BYTES,
  serializar,
  type EmailBruto,
  type Interpretacao,
  type MotivoRevisao,
} from '../core/esquemas'
import { CategoriaDesconhecidaError } from '../core/erros'
import { conferirAssinatura } from '../core/seguranca/assinatura-de-arquivo'
import { validarAnexo } from '../core/seguranca/conteudo-nao-confiavel'
import { paraDataIso } from '../core/util/datas'
import type { ArmazenamentoPort } from '../ports/armazenamento'
import { InterpretacaoIndisponivelError, type AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { ATOR_SISTEMA, exigirPapel, type Ator } from '../servidor/ator'
import type { Banco, Transacao } from '../servidor/prisma'
import {
  mensagemDoErro,
  mensagemPersistivel,
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
  /**
   * Onde os bytes dos anexos são guardados.
   *
   * Opcional: sem ele, o sistema grava o metadado do anexo e NÃO guarda o
   * arquivo — o que é registrado, nunca fingido. Um `chaveArmazenamento` nulo
   * significa exatamente "os bytes não estão aqui".
   */
  armazenamento?: ArmazenamentoPort | undefined
}

export interface ResumoIngestao {
  correlacaoId: string
  recebidos: number
  novos: number
  duplicados: number
  itensCriados: number
  /**
   * E-mails interpretados que não geraram item nenhum.
   *
   * Zero item é resultado legítimo — resposta automática, aviso de entrega,
   * boletim. Mas é indistinguível de "a IA não entendeu e a carga sumiu", e o
   * e-mail fica marcado como processado, então nunca mais volta. Sem este
   * contador na tela, a diferença entre os dois casos não existiria para
   * ninguém: seria exatamente a perda silenciosa que a planilha comete.
   */
  emailsSemItem: number
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
    emailsSemItem: 0,
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

      // E-mail que entrou e não virou trabalho nenhum.
      //
      // NÃO é falha do lote: marcar o dia inteiro de vermelho por causa de uma
      // resposta automática é o vermelho que ensina a equipe a ignorar
      // vermelho. Mas o evento fica gravado como `falha` para aparecer em
      // qualquer busca por problema, e o contador sobe para aparecer na tela.
      // Silenciar isto era perder carga sem que ninguém pudesse notar.
      if (resultado.criados === 0) {
        resumo.emailsSemItem += 1
        registrarLog('aviso', 'e-mail interpretado sem nenhum item', {
          correlacaoId,
          messageId: email.messageId,
        })
        await registrarEvento(deps.banco, {
          correlacaoId,
          etapa: 'ingestao',
          situacao: 'falha',
          referencia: email.messageId,
          mensagem: 'e-mail interpretado sem nenhum item — confira se havia trabalho ali',
        })
      }
    } catch (erro) {
      // Violação de unicidade é corrida perdida, não defeito: o outro processo
      // já gravou o mesmo e-mail. Contar como falha produziria alerta enganoso.
      if (ehViolacaoDeUnicidade(erro)) {
        resumo.duplicados += 1
        continue
      }

      // A camada de IA está fora — chave recusada, permissão negada. Seguir o
      // laço produziria a MESMA falha em cada e-mail restante, uma chamada
      // condenada por mensagem, e a causa real ficaria diluída em centenas de
      // linhas idênticas. O lote para aqui, e quem lê sabe o que consertar.
      if (erro instanceof InterpretacaoIndisponivelError) {
        await registrarEvento(deps.banco, {
          correlacaoId,
          etapa: 'ingestao',
          situacao: 'reprocessavel',
          referencia: candidato.messageId,
          mensagem: mensagemPersistivel(erro),
        })
        throw erro
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
        mensagem: mensagemPersistivel(erro),
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

  const anexosAvaliados = await Promise.all(
    email.anexos.map(async (anexo) => {
      const veredicto = validarAnexo(anexo.nome, anexo.tamanho, TAMANHO_MAXIMO_ANEXO_BYTES)

      // A allowlist de extensão só olha o NOME, que quem escreveu foi o
      // remetente. Com os bytes em mãos, o tipo real é conferido — é o que
      // separa um PDF de um executável chamado `laudo.pdf`.
      if (veredicto.aceito && anexo.conteudo) {
        const assinatura = conferirAssinatura(veredicto.nomeSeguro, anexo.conteudo)
        if (assinatura.situacao === 'divergente') {
          return {
            ...anexo,
            veredicto: { aceito: false, motivo: assinatura.motivo, nomeSeguro: veredicto.nomeSeguro },
            chaveArmazenamento: null,
          }
        }
      }

      // Arquivo só é guardado depois de aceito. Rejeitado não entra no disco:
      // não se armazena o que já se sabe que não devia ter chegado.
      let chaveArmazenamento: string | null = null
      if (veredicto.aceito && anexo.conteudo && deps.armazenamento) {
        const ponto = veredicto.nomeSeguro.lastIndexOf('.')
        chaveArmazenamento = await deps.armazenamento.guardar(
          anexo.conteudo,
          ponto === -1 ? '' : veredicto.nomeSeguro.slice(ponto),
        )
      }

      return { ...anexo, veredicto, chaveArmazenamento }
    }),
  )
  const anexosRejeitados = anexosAvaliados.filter((anexo) => !anexo.veredicto.aceito).length

  return deps.banco.$transaction(async (tx) => {
    // Segunda checagem, agora DENTRO da transação: fecha a janela entre a
    // verificação de existência e a gravação.
    const jaProcessado = await tx.email.findUnique({
      where: { messageId: email.messageId },
      select: { processadoEm: true },
    })
    if (jaProcessado?.processadoEm) return null

    // Metadado e conteúdo nascem juntos, mas em linhas separadas: é o que
    // permite, depois, expurgar o conteúdo pela retenção sem levar junto o
    // histórico operacional que sustenta métrica, auditoria e conservação.
    const registro = await tx.email.upsert({
      where: { messageId: email.messageId },
      create: {
        messageId: email.messageId,
        origem: email.origem,
        recebidoEm: email.recebidoEm,
        modeloIa: interpretacao.modelo,
        versaoPrompt: interpretacao.versaoPrompt,
        processadoEm: new Date(),
        conteudo: {
          create: {
            remetente: email.remetente,
            assunto: email.assunto,
            corpo: email.corpo,
          },
        },
        anexos: {
          create: anexosAvaliados.map((anexo) => ({
            nomeSeguro: anexo.veredicto.nomeSeguro,
            tipoDeclarado: anexo.tipoDeclarado,
            tamanho: anexo.tamanho,
            hash: anexo.hash,
            aceito: anexo.veredicto.aceito,
            motivo: anexo.veredicto.motivo ?? null,
            chaveArmazenamento: anexo.chaveArmazenamento,
            armazenadoEm: anexo.chaveArmazenamento ? new Date() : null,
          })),
        },
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

  // Uma consulta para todas as categorias do lote, não uma por item. Um e-mail
  // de liga com 30 ligantes fazia 30 buscas da MESMA categoria, dentro da
  // transação, segurando lock de escrita à toa.
  const codigos = [...new Set(interpretacao.itens.map((item) => item.categoriaCodigo))]
  const categorias = new Map(
    (
      await tx.categoria.findMany({
        where: { codigo: { in: codigos } },
        select: { id: true, codigo: true, limiarConfianca: true },
      })
    ).map((categoria) => [categoria.codigo, categoria]),
  )

  for (const [posicao, extraido] of interpretacao.itens.entries()) {
    const categoria = categorias.get(extraido.categoriaCodigo)
    // `continue` aqui descartava o item em silêncio: nada gravado, nada
    // contado, nada registrado — e o e-mail marcado como processado do mesmo
    // jeito, o que somado à idempotência por `messageId` significa trabalho
    // perdido para sempre. É o defeito da planilha reconstruído aqui dentro.
    if (!categoria) throw new CategoriaDesconhecidaError(extraido.categoriaCodigo)

    const motivo = decidirRevisao(
      extraido.confianca,
      categoria.limiarConfianca,
      extraido.camposAusentes.length > 0,
      interpretacao.conteudoSuspeito,
      contexto.anexosRejeitados > 0,
      // Desdobramento SEMPRE passa por humano.
      //
      // A decisão A1 e o requisito RF-04 dizem que a IA PROPÕE o desdobramento
      // e ele é revisável. Na prática, um item de lista sempre tinha nome
      // preenchido, logo zero campo ausente, logo confiança acima do limiar —
      // e N unidades de carga entravam aprovadas sem ninguém olhar. Uma
      // assinatura numerada no rodapé viraria três itens de trabalho.
      interpretacao.itens.length > 1,
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
  houveDesdobramento: boolean,
): MotivoRevisao | null {
  if (conteudoSuspeito) return 'conteudo_suspeito'
  if (anexoRejeitado) return 'anomalia'
  if (houveDesdobramento) return 'desdobramento'
  if (confianca < limiar) return 'baixa_confianca'
  if (temCampoAusente) return 'campo_ausente'
  return null
}

/** Data ISO de um e-mail, para agrupar a fila do dia. */
export function dataDoEmail(recebidoEm: Date): string {
  return paraDataIso(recebidoEm)
}
