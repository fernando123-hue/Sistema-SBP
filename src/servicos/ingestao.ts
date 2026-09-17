import {
  EmailBrutoSchema,
  TAMANHO_MAXIMO_ANEXO_BYTES,
  serializar,
  type EmailBruto,
  type Interpretacao,
  type MotivoRevisao,
} from '../core/esquemas'
import { CategoriaDesconhecidaError, ErroOperacional } from '../core/erros'
import { chaveDaLiga } from '../core/ligas'
import { conferirAssinatura } from '../core/seguranca/assinatura-de-arquivo'
import { validarAnexo } from '../core/seguranca/conteudo-nao-confiavel'
import type { ResumoIngestao } from '../core/tipos'
import type { ArmazenamentoPort } from '../ports/armazenamento'
import { InterpretacaoIndisponivelError, type AiPort } from '../ports/ia'
import type { AvisoDaBusca, IngestaoPort } from '../ports/ingestao'
import { ATOR_SISTEMA, exigirPapel, type Ator } from '../servidor/ator'
import { chaveDeBusca } from '../servidor/cpf-protegido'
import type { Banco, Transacao } from '../servidor/prisma'
import {
  mensagemDoErro,
  mensagemPersistivel,
  novaCorrelacao,
  registrarEvento,
  registrarLog,
} from '../servidor/observabilidade'
import { auditar } from './auditoria'

export type { ResumoIngestao }

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

/**
 * Quantos dias para trás cada sincronização relê (achado C-03, `AT-35`).
 *
 * Antes não havia janela: a caixa inteira era lida a cada vez, e como ela só
 * cresce (`A5`), a leitura acabava derrubada pelo teto. A janela não é um
 * cursor "desde o último e-mail" de propósito: um e-mail que FALHOU não é
 * gravado (a transação aborta), e um cursor passaria por cima dele — o
 * `reprocessavel` deixaria de ser verdade sem ninguém ver. Com a janela, a
 * falha é tentada de novo por uma semana; depois disso fica só o evento, para
 * uma pessoa tratar na caixa. O que já virou trabalho é descartado pelo
 * adapter antes do teto, via `jaProcessados`.
 */
export const JANELA_DE_RELEITURA_DIAS = 7

/** `IN` com milhares de valores pesa no MySQL; a janela cabe folgada em lotes. */
const LOTE_DE_CONSULTA = 500

function consultaDeProcessados(banco: Banco) {
  return async (messageIds: string[]): Promise<ReadonlyMap<string, Date>> => {
    const achados: (readonly [string, Date])[] = []
    for (let inicio = 0; inicio < messageIds.length; inicio += LOTE_DE_CONSULTA) {
      const linhas = await banco.email.findMany({
        where: {
          messageId: { in: messageIds.slice(inicio, inicio + LOTE_DE_CONSULTA) },
          processadoEm: { not: null },
        },
        select: { messageId: true, recebidoEm: true },
      })
      achados.push(...linhas.map((linha) => [linha.messageId, linha.recebidoEm] as const))
    }
    return new Map(achados)
  }
}

/**
 * O que o adapter avisou vira memória operacional.
 *
 * Recusa é FALHA com o identificador e a data de chegada — o bastante para uma
 * pessoa achar a mensagem na caixa, sem copiar conteúdo nenhum para a trilha,
 * que não tem retenção (invariante 11). Adiamento é `reprocessavel`: nada se
 * perdeu, a próxima leitura continua.
 */
async function registrarAvisos(
  banco: Banco,
  correlacaoId: string,
  avisos: readonly AvisoDaBusca[],
  colisoes: Colisao[],
): Promise<number> {
  let recusados = 0
  for (const aviso of avisos) {
    if (aviso.tipo === 'colisao') {
      // Gravadas no fim, junto com as que o laço achar: um evento só.
      colisoes.push({ messageId: aviso.messageId, recebidoEm: aviso.recebidoEm })
      continue
    }
    if (aviso.tipo === 'recusado') {
      recusados += 1
      await registrarEvento(banco, {
        correlacaoId,
        etapa: 'ingestao',
        situacao: 'falha',
        referencia: aviso.messageId,
        mensagem:
          `mensagem da caixa recebida em ${aviso.recebidoEm ?? 'data desconhecida'} não pôde ser lida ` +
          `(${aviso.motivo}) — trate-a direto na caixa`,
      })
    } else {
      await registrarEvento(banco, {
        correlacaoId,
        etapa: 'ingestao',
        situacao: 'reprocessavel',
        mensagem: `${aviso.quantidade} mensagens novas ficaram para a próxima sincronização (teto por leitura)`,
      })
    }
  }
  return recusados
}

/** Exemplos guardados por evento de colisão. O resto é só contado. */
const EXEMPLOS_DE_COLISAO = 10

interface Colisao {
  messageId: string
  recebidoEm: string | null
}

/**
 * Identificador repetido com outra data: UM evento por sincronização.
 *
 * O identificador é escrito por quem manda o e-mail, então quem o copiar faz a
 * sua mensagem ser tratada como a já processada. Isso não pode sumir sem
 * rastro (pendência da revisão de segurança do PR #59). Mas também não conta
 * como falha do lote: uma cópia legítima — lista de e-mail, reentrega — cai no
 * mesmo caso, e marcar o dia de vermelho por ela ensinaria a ignorar vermelho.
 * Agregado porque o volume é escolhido por quem manda: um evento por cópia
 * seria uma trilha sem retenção crescendo à vontade de terceiros.
 */
async function registrarColisoes(banco: Banco, correlacaoId: string, colisoes: readonly Colisao[]): Promise<void> {
  registrarLog('aviso', 'mensagens com identificador de e-mail já processado, em outra data', {
    correlacaoId,
    quantidade: colisoes.length,
  })
  await registrarEvento(banco, {
    correlacaoId,
    etapa: 'ingestao',
    situacao: 'falha',
    ...(colisoes.length === 1 ? { referencia: colisoes[0]!.messageId } : {}),
    mensagem:
      `${colisoes.length} ${colisoes.length === 1 ? 'mensagem' : 'mensagens'} com o identificador de um e-mail já ` +
      `processado, recebida${colisoes.length === 1 ? '' : 's'} em outra data — pode ser cópia ou falsificação; ` +
      `confira na caixa`,
    detalhe: { quantidade: colisoes.length, exemplos: colisoes.slice(0, EXEMPLOS_DE_COLISAO) },
  })
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
    naoLidas: 0,
    repetidas: 0,
  }

  const avisos: AvisoDaBusca[] = []
  const colisoes: Colisao[] = []
  const brutos = await deps.ingestao.buscarNovos({
    desde: new Date(Date.now() - JANELA_DE_RELEITURA_DIAS * 24 * 60 * 60 * 1000),
    jaProcessados: consultaDeProcessados(deps.banco),
    avisar: (aviso) => avisos.push(aviso),
  })
  resumo.recebidos = brutos.length
  resumo.naoLidas = await registrarAvisos(deps.banco, correlacaoId, avisos, colisoes)

  await registrarEvento(deps.banco, {
    correlacaoId,
    etapa: 'ingestao',
    situacao: 'iniciado',
    mensagem: `${brutos.length} e-mails recebidos do adapter "${deps.ingestao.nome}"`,
  })

  // ═══ A CHAVE DOS ANEXOS É CONFERIDA ANTES DE QUALQUER CHAMADA DE IA ═══
  //
  // A sentinela já conferia a chave dentro de `guardar` — mas `guardar` roda
  // DEPOIS de `interpretar`. Com a chave errada, cada e-mail com anexo pagava a
  // chamada de IA e só então falhava, um por um; o laço seguia, e o evento
  // gravava só o nome da classe, sem o motivo. Nada era gravado com a chave
  // errada, mas a falha "alta e clara" que a sentinela promete não acontecia.
  // Revisão do PR #36.
  //
  // Mesmo tratamento da IA fora do ar logo abaixo: o lote para aqui, com a
  // causa que manda consertar, antes de gastar uma chamada sequer.
  if (deps.armazenamento?.conferirChave) {
    try {
      await deps.armazenamento.conferirChave()
    } catch (erro) {
      await registrarEvento(deps.banco, {
        correlacaoId,
        etapa: 'ingestao',
        situacao: 'reprocessavel',
        // `mensagemPublica`, não a crua: é o texto que a própria classe declara
        // seguro para sair — e o de chave trocada é justamente o que precisa
        // ficar legível na memória operacional.
        mensagem: erro instanceof ErroOperacional ? erro.mensagemPublica : mensagemPersistivel(erro),
      })
      throw erro
    }
  }

  for (const candidato of brutos) {
    try {
      const email = EmailBrutoSchema.parse(candidato)

      const jaExiste = await deps.banco.email.findUnique({
        where: { messageId: email.messageId },
        select: { id: true, processadoEm: true, recebidoEm: true },
      })

      if (jaExiste?.processadoEm) {
        resumo.duplicados += 1
        // Adapter que não usa `jaProcessados` entrega a cópia até aqui.
        if (jaExiste.recebidoEm.getTime() !== email.recebidoEm.getTime()) {
          colisoes.push({ messageId: email.messageId, recebidoEm: email.recebidoEm.toISOString() })
        }
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

        // ZERO ITENS + CONTEÚDO SUSPEITO NÃO É A MESMA COISA QUE ZERO ITENS.
        //
        // Sem item não existe `Revisao` para criar — a tabela exige `itemId` —,
        // então este e-mail nunca entra numa fila de trabalho e, pela
        // idempotência de `messageId`, também nunca volta. Para uma resposta
        // automática isso está certo: é o comportamento que evita encher a fila
        // de ruído.
        //
        // Para um e-mail que as defesas marcaram como suspeito, não está. É
        // exatamente a forma que um ataque bem-sucedido teria — o conteúdo
        // convence o modelo a não devolver item nenhum, e some com um aviso
        // igual ao de um "obrigado, recebido". Os dois casos precisavam ser
        // distinguíveis por quem investiga, e não eram.
        //
        // A separação é de VISIBILIDADE, não de fluxo: nada muda para a
        // operação, e a decisão de criar uma fila para estes casos é do dono do
        // processo (`DECISOES.md § C`).
        const suspeito = resultado.conteudoSuspeito
        registrarLog(suspeito ? 'erro' : 'aviso', 'e-mail interpretado sem nenhum item', {
          correlacaoId,
          messageId: email.messageId,
          conteudoSuspeito: suspeito,
        })
        await registrarEvento(deps.banco, {
          correlacaoId,
          etapa: 'ingestao',
          situacao: 'falha',
          referencia: email.messageId,
          mensagem: suspeito
            ? 'e-mail SUSPEITO interpretado sem nenhum item — pode ser tentativa de fazer o trabalho desaparecer'
            : 'e-mail interpretado sem nenhum item — confira se havia trabalho ali',
          detalhe: { conteudoSuspeito: suspeito },
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

  resumo.repetidas = colisoes.length
  if (colisoes.length > 0) await registrarColisoes(deps.banco, correlacaoId, colisoes)

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
  /**
   * Se as defesas contra injeção levantaram a mão sobre este e-mail.
   *
   * Sobe até o laço porque "não gerou item nenhum" tem duas causas muito
   * diferentes: resposta automática (rotina) e conteúdo suspeito que o modelo
   * não conseguiu — ou não quis — estruturar. As duas caíam no mesmo aviso
   * genérico, indistinguíveis para quem fosse investigar depois.
   */
  conteudoSuspeito: boolean
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
      // O tamanho que vale é o dos BYTES, quando eles vieram (achado N-27): o
      // declarado é da origem, e um adapter futuro (IMAP) o recebe de quem
      // mandou. Decidir pelo declarado guardaria bytes maiores que o teto.
      const tamanho = anexo.conteudo ? anexo.conteudo.byteLength : anexo.tamanho
      const avaliado = validarAnexo(anexo.nome, tamanho, TAMANHO_MAXIMO_ANEXO_BYTES)
      const veredicto = anexo.recusa
        ? { aceito: false, motivo: anexo.recusa, nomeSeguro: avaliado.nomeSeguro }
        : avaliado

      // A allowlist de extensão só olha o NOME, que quem escreveu foi o
      // remetente. Com os bytes em mãos, o tipo real é conferido — é o que
      // separa um PDF de um executável chamado `laudo.pdf`.
      if (veredicto.aceito && anexo.conteudo) {
        const assinatura = conferirAssinatura(veredicto.nomeSeguro, anexo.conteudo)
        if (assinatura.situacao === 'divergente') {
          return {
            ...anexo,
            tamanho,
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

      return { ...anexo, tamanho, veredicto, chaveArmazenamento }
    }),
  )
  const anexosRejeitados = anexosAvaliados.filter((anexo) => !anexo.veredicto.aceito).length

  // ═══ BYTES NO DISCO ANTES DA TRANSAÇÃO PRECISAM DE VOLTA ATRÁS ═══
  //
  // Os arquivos são gravados acima, fora da transação — e isso está certo:
  // escrever no armazenamento dentro dela seguraria lock de banco durante uma
  // operação de I/O que pode ser lenta ou remota.
  //
  // O que faltava era o desfazer. Se a transação abortar — categoria
  // desconhecida, corrida de unicidade, qualquer defeito —, o arquivo fica no
  // disco sem nenhuma linha de `Anexo` apontando para ele. E é um órfão que a
  // política de retenção NUNCA alcança: o expurgo caminha a partir das linhas
  // do banco, então bytes sem linha são invisíveis para ele — documento de
  // associado que fica no disco para sempre sem que nada saiba que existe
  // (invariante 11), e sem nada registrando que ele está lá (invariante 7).
  //
  // Pior no caso comum: e-mail que falha não é marcado como processado, então
  // a próxima sincronização o reprocessa e grava OUTRA cópia. Um defeito
  // repetido enche o disco de cópias do mesmo documento.
  //
  // `remover` é idempotente por contrato, então limpar o que talvez nem tenha
  // sido escrito é seguro.
  const chavesGravadas = anexosAvaliados
    .map((anexo) => anexo.chaveArmazenamento)
    .filter((chave): chave is string => chave !== null)

  /** Apaga o que esta tentativa escreveu. Nunca substitui o erro original. */
  async function desfazerArquivos(): Promise<void> {
    if (!deps.armazenamento) return
    for (const chave of chavesGravadas) {
      try {
        await deps.armazenamento.remover(chave)
      } catch (aoRemover) {
        // Falhou a limpeza: o arquivo continua órfão, e agora pelo menos
        // existe uma linha dizendo qual é.
        registrarLog('erro', 'anexo órfão no armazenamento após transação abortada', {
          correlacaoId,
          chave,
          erro: mensagemDoErro(aoRemover),
        })
      }
    }
  }

  try {
    return await deps.banco.$transaction(async (tx) => {
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
          conteudoSuspeito: interpretacao.conteudoSuspeito,
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
        update: { processadoEm: new Date(), conteudoSuspeito: interpretacao.conteudoSuspeito },
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

      return { ...resultado, anexosRejeitados, conteudoSuspeito: interpretacao.conteudoSuspeito }
    })
  } catch (erro) {
    await desfazerArquivos()
    throw erro
  }
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
): Promise<Omit<ResultadoDeUm, 'anexosRejeitados' | 'conteudoSuspeito'>> {
  const { interpretacao } = contexto
  // Uma leitura de `Liga` por LOTE, não por item — ver `indiceDeLigas`.
  const ligas = await indiceDeLigas(tx)
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

    // A liga vira IDENTIDADE aqui, e não no motor (`A4`).
    //
    // Sem isto, `Item.ligaId` continuaria nulo para sempre — as tabelas `Liga`
    // e `Ligante` existiam no schema desde a fundação e nunca tiveram um
    // escritor. O motor precisa saber QUAL liga é para não separar o lote
    // dela, e `ligaMencionada` sozinho é texto, não identidade.
    const ligaId = await resolverLiga(tx, ligas, extraido.ligaMencionada)

    const item = await tx.item.create({
      data: {
        emailId: contexto.emailId,
        categoriaId: categoria.id,
        ligaId,
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
        // A chave de busca nasce com o campo: é a única parte do que a IA leu
        // que fica depois do prazo do texto do e-mail (`A23(b)`). CPF com erro
        // não gera chave; a revisão pode corrigi-lo e aí ela nasce certa.
        ...chaveDeBusca(extraido.campos),
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
 * Encontra ou cria a liga que o nome menciona (`A4`, `AT-10`).
 *
 * A busca é EXATA sobre o nome normalizado (`chaveDaLiga`), nunca aproximada:
 * duas grafias diferentes viram duas ligas. Separar é um erro que o operador
 * vê e corrige; unir duas ligas diferentes entrega o trabalho de uma como se
 * fosse da outra, e ninguém descobre.
 *
 * O nome ORIGINAL é guardado como veio — é o que a tela mostra, e reescrevê-lo
 * para a forma normalizada faria a liga aparecer sem acento na interface.
 */
async function resolverLiga(
  tx: Transacao,
  indice: Map<string, string>,
  mencionada: string | null,
): Promise<string | null> {
  const chave = chaveDaLiga(mencionada)
  if (chave === null) return null

  const achada = indice.get(chave)
  if (achada) return achada

  const criada = await tx.liga.create({ data: { nome: mencionada!.trim() } })
  // A liga nova entra no índice: o mesmo e-mail pode mencioná-la de novo nos
  // itens seguintes, e sem isto cada menção criaria uma linha.
  indice.set(chave, criada.id)
  return criada.id
}

/**
 * Índice de ligas por chave normalizada, montado UMA vez por lote.
 *
 * A varredura em si é decisão (`AT-10`: a comparação é exata, sobre a chave, e
 * não aproximada) — o defeito era repeti-la por item. Um e-mail de liga com 30
 * ligantes fazia 30 leituras da tabela inteira DENTRO da transação de escrita,
 * mais 30 × N normalizações: com 300 ligas cadastradas, 9.000 chamadas de
 * `chaveDaLiga` medidas em 37,8 ms de CPU, tudo segurando a trava.
 *
 * É exatamente o defeito que `criarItens` já tinha corrigido para `Categoria`,
 * vinte linhas acima, com o comentário explicando por quê. A correção não tinha
 * sido aplicada a `Liga`.
 */
async function indiceDeLigas(tx: Transacao): Promise<Map<string, string>> {
  const existentes = await tx.liga.findMany({ select: { id: true, nome: true } })
  const indice = new Map<string, string>()
  for (const liga of existentes) {
    const chave = chaveDaLiga(liga.nome)
    // Primeira vencendo: se duas linhas normalizam para a mesma chave (dado
    // anterior à regra), o comportamento continua sendo o da varredura, que
    // parava no primeiro `find`.
    if (chave !== null && !indice.has(chave)) indice.set(chave, liga.id)
  }
  return indice
}

/**
 * Decide se o item precisa de olho humano.
 *
 * Conservador de propósito: começa exigindo muita revisão e afrouxa conforme a
 * taxa de acerto MEDIDA, nunca conforme impressão. Qualquer um dos gatilhos
 * basta — eles não se anulam.
 *
 * Função pura — sem I/O, sem relógio. Exportada para teste: é a regra que o
 * A12 move de lugar ao dar limiar próprio a documento e ficha, e sem alcançá-la
 * direto a única forma de provar o efeito seria pela ingestão inteira.
 *
 * (Pelo desenho de camadas, o lugar natural dela é `src/core/`. Mover é
 * refatoração própria, não algo para embutir numa entrega de decisão.)
 */
export function decidirRevisao(
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
