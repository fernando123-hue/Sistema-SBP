import {
  EmailBrutoSchema,
  TAMANHO_MAXIMO_ANEXO_BYTES,
  TAMANHO_MAXIMO_CORPO,
  serializar,
  type EmailBruto,
  type Interpretacao,
  type MotivoRevisao,
} from '../core/esquemas'
import { CategoriaDesconhecidaError, ErroOperacional } from '../core/erros'
import { chaveDaLiga } from '../core/ligas'
import { conferirAssinatura } from '../core/seguranca/assinatura-de-arquivo'
import { prepararConteudoExterno, validarAnexo } from '../core/seguranca/conteudo-nao-confiavel'
import type { ResumoIngestao } from '../core/tipos'
import type { ArmazenamentoPort } from '../ports/armazenamento'
import { FalhaDeInterpretacao, InterpretacaoIndisponivelError, type AiPort } from '../ports/ia'
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
 * Quantas ligas NOVAS um único e-mail pode criar (achado N-12).
 *
 * `Liga` nasce de conteúdo externo — o nome vem do corpo da mensagem. Três é
 * folgado para o caso real: um e-mail de liga menciona uma, e uma lista com
 * ligantes de instituições diferentes chega a duas ou três. Acima disso, a
 * hipótese mais provável deixa de ser "o setor recebeu muitas ligas novas de
 * uma vez" e passa a ser "a interpretação se perdeu" — e o item vai para a
 * revisão, com a menção preservada, em vez de plantar linha na tabela.
 *
 * Exportado para o teste afirmar o comportamento sem repetir o número.
 */
export const TETO_DE_LIGAS_NOVAS_POR_EMAIL = 3

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

/**
 * Quantas vezes tentar interpretar o mesmo e-mail antes de desistir (achado
 * C-11/N-13).
 *
 * A janela acima já garantia que a falha fosse tentada de novo — mas sem teto
 * por e-mail, cada sincronização dentro da janela pagava a MESMA chamada de
 * IA pela mesma mensagem, e depois da janela ela desaparecia da leitura sem
 * que ninguém tivesse visto: nem a cobrança parava, nem uma pessoa chegava a
 * saber. `ia-estruturada.ts` já tenta corrigir o formato uma vez sozinha
 * (`FalhaDeInterpretacao` só sai depois disso); três sincronizações são três
 * chances além dessa, e desistir cedo é o que impede a planilha de continuar
 * cobrando por um e-mail que ela nunca vai conseguir ler.
 *
 * Hipótese provisória, não confirmada pelo dono — `DECISOES.md § C` e a
 * pergunta em `§ H.4`.
 */
export const TENTATIVAS_MAXIMAS_DE_INTERPRETACAO = 3

/**
 * Marca, em `EventoProcessamento.detalhe`, que um `reprocessavel` foi causado
 * por `FalhaDeInterpretacao` — a IA respondeu, mas nunca num formato válido.
 *
 * SEM esta marca, `contarTentativasAnteriores` contaria QUALQUER motivo de
 * reprocessamento (categoria ainda não cadastrada, e-mail fora do esquema,
 * uma colisão de infraestrutura qualquer) para o mesmo teto — e cadastrar a
 * categoria que faltava não devolveria o e-mail, porque ele já teria sido
 * marcado como tratado por um motivo que nada tinha a ver com a IA. É
 * exatamente o "trabalho perdido para sempre" que `CategoriaDesconhecidaError`
 * existe para impedir, reaberto por um caminho novo (achado crítico da
 * revisão técnica do PR que introduziu este arquivo).
 *
 * Vive no `detalhe` (texto livre) e não em `situacao` (enum fechado,
 * `core/esquemas.ts`) de propósito: adicionar um valor ao enum classificaria
 * este arquivo como nível 3 (`scripts/processo/nivel-de-risco.ts`) por tocar
 * `esquemas.ts`, para uma mudança que é só de UM adapter de IA.
 */
const CAUSA_FALHA_DE_INTERPRETACAO = 'falha_de_interpretacao'

/** `IN` com milhares de valores pesa no MySQL; a janela cabe folgada em lotes. */
const LOTE_DE_CONSULTA = 500

/**
 * Quantas vezes cada e-mail já falhou em sincronizações anteriores POR CAUSA
 * DA IA — nunca por outro motivo de reprocessamento (ver `CAUSA_FALHA_DE_INTERPRETACAO`).
 *
 * Uma consulta agrupada para o lote inteiro, não uma por e-mail — mesma razão
 * de `consultaDeProcessados` logo abaixo: um `IN` por mensagem seguraria a
 * leitura em centenas de idas ao banco à toa.
 */
async function contarTentativasAnteriores(
  banco: Banco,
  messageIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  if (messageIds.length === 0) return new Map()

  const achados: (readonly [string, number])[] = []
  for (let inicio = 0; inicio < messageIds.length; inicio += LOTE_DE_CONSULTA) {
    const linhas = await banco.eventoProcessamento.groupBy({
      by: ['referencia'],
      where: {
        etapa: 'ingestao',
        situacao: 'reprocessavel',
        referencia: { in: messageIds.slice(inicio, inicio + LOTE_DE_CONSULTA) as string[] },
        // Casamento por substring no texto serializado, não leitura de JSON:
        // `detalhe` é `String @db.Text`, sem suporte a caminho JSON no MySQL
        // via Prisma sem SQL cru. `serializar()` é `JSON.stringify` simples, e
        // a chave nasce sempre primeiro no objeto (`registrarEvento` só
        // acrescenta campos depois dela) — a substring é estável.
        detalhe: { contains: `"causa":"${CAUSA_FALHA_DE_INTERPRETACAO}"` },
      },
      _count: { _all: true },
    })

    for (const linha of linhas) {
      if (linha.referencia !== null) achados.push([linha.referencia, linha._count._all])
    }
  }
  return new Map(achados)
}

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
    naoInterpretados: 0,
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
  const tentativas = await contarTentativasAnteriores(
    deps.banco,
    brutos
      .map((candidato) => (candidato as { messageId?: unknown }).messageId)
      .filter((messageId): messageId is string => typeof messageId === 'string'),
  )

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

      const tentativasDoEmail = tentativas.get(email.messageId) ?? 0
      const resultado = await processarUm(deps, email, correlacaoId, usuario, tentativasDoEmail)

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

      // Desistiu depois de `TENTATIVAS_MAXIMAS_DE_INTERPRETACAO` falhas — a IA
      // nem foi chamada nesta execução (achado C-11/N-13). O e-mail já está
      // marcado como processado: daqui em diante `jaExiste?.processadoEm`
      // barra qualquer nova tentativa, e é isto que zera a cobrança. Vem ANTES
      // do `emailsSemItem` de propósito: são desfechos diferentes por motivos
      // diferentes, e a tela precisa dizer qual é qual.
      if (resultado.naoInterpretado) {
        resumo.naoInterpretados += 1
        registrarLog('erro', 'e-mail não interpretado depois de tentativas repetidas — marcado como tratado', {
          correlacaoId,
          messageId: email.messageId,
          tentativas: tentativasDoEmail,
        })
        await registrarEvento(deps.banco, {
          correlacaoId,
          etapa: 'ingestao',
          situacao: 'falha',
          referencia: email.messageId,
          mensagem:
            `depois de ${TENTATIVAS_MAXIMAS_DE_INTERPRETACAO} tentativas a IA não conseguiu estruturar este ` +
            `e-mail — marcado como tratado, sem cobrar de novo; abra-o direto no Outlook`,
          detalhe: { conteudoSuspeito: resultado.conteudoSuspeito },
        })
        continue
      }

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
        // operação AINDA. O dono já decidiu a fila para estes casos
        // (`DECISOES.md § A34`: lista na Revisão, só operador e gestor, e o
        // relógio da limpeza só corre depois da decisão); ela é da fase 4 e não
        // existe. Até lá, o e-mail suspeito sem item fica fora da limpeza
        // (`§ AT-24`), para a manipulação não sumir sozinha (achado C-27).
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
          // A camada estava fora do ar — o e-mail em si está bem. Não é o que
          // `TENTATIVAS_MAXIMAS_DE_INTERPRETACAO` existe para contar (achado
          // crítico da revisão do PR: ver `CAUSA_FALHA_DE_INTERPRETACAO`).
          detalhe: { causa: 'interpretacao_indisponivel' },
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
        // A CAUSA vai no `detalhe`, não só a mensagem — é o que
        // `contarTentativasAnteriores` usa para separar "a IA nunca consegue
        // estruturar este e-mail" (achado C-11/N-13) de qualquer outro motivo
        // de reprocessamento (categoria ainda não cadastrada, e-mail fora do
        // esquema, etc.). Achado crítico da revisão técnica do PR: antes,
        // QUALQUER `reprocessavel` contava para o teto de desistência —
        // cadastrar a categoria que faltava não devolvia o e-mail, porque ele
        // já tinha sido marcado como tratado por um motivo que nada tinha a
        // ver com a IA.
        detalhe: { causa: erro instanceof FalhaDeInterpretacao ? CAUSA_FALHA_DE_INTERPRETACAO : 'outra' },
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
  /**
   * Desistiu de interpretar este e-mail sem chamar a IA nesta execução —
   * achado C-11/N-13. `criados` vem sempre zero junto, mas o motivo é outro:
   * não é "a IA leu e não achou trabalho", é "depois de
   * `TENTATIVAS_MAXIMAS_DE_INTERPRETACAO` falhas, paramos de tentar".
   */
  naoInterpretado: boolean
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
  tentativasAnteriores: number,
): Promise<ResultadoDeUm | null> {
  // Depois do teto, a IA nem é chamada: é exatamente o que zera a cobrança do
  // achado C-11/N-13. A análise LOCAL (sem rede, sem custo) ainda roda — ela
  // não decide nada sozinha, só ajuda quem for abrir o e-mail no Outlook a
  // saber se vale desconfiar antes de ler.
  const desistir = tentativasAnteriores >= TENTATIVAS_MAXIMAS_DE_INTERPRETACAO

  // A interpretação roda FORA da transação: chamada de modelo é lenta e não
  // deve segurar lock de banco. Se falhar, nada foi gravado.
  const interpretacao: Interpretacao | null = desistir ? null : await deps.ia.interpretar(email)
  const suspeitoLocal = desistir
    ? prepararConteudoExterno(`${email.assunto}\n${email.corpo}`, TAMANHO_MAXIMO_CORPO).analise.suspeito
    : false

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

      // Sem interpretação (desistiu), o suspeito vem só da análise local; com
      // interpretação, o sinal duplo de sempre (regex OU modelo).
      const conteudoSuspeito = interpretacao ? interpretacao.conteudoSuspeito : suspeitoLocal

      // Metadado e conteúdo nascem juntos, mas em linhas separadas: é o que
      // permite, depois, expurgar o conteúdo pela retenção sem levar junto o
      // histórico operacional que sustenta métrica, auditoria e conservação.
      const registro = await tx.email.upsert({
        where: { messageId: email.messageId },
        create: {
          messageId: email.messageId,
          origem: email.origem,
          recebidoEm: email.recebidoEm,
          modeloIa: interpretacao?.modelo ?? null,
          versaoPrompt: interpretacao?.versaoPrompt ?? null,
          processadoEm: new Date(),
          conteudoSuspeito,
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
        update: { processadoEm: new Date(), conteudoSuspeito },
      })

      // Sem interpretação não há `itens` para gravar — a desistência não
      // inventa estrutura que a IA nunca produziu.
      const resultado = interpretacao
        ? await criarItens(tx, {
            emailId: registro.id,
            messageId: email.messageId,
            interpretacao,
            anexosRejeitados,
            correlacaoId,
            usuario,
          })
        : { criados: 0, aprovados: 0, paraRevisao: 0 }

      await auditar(tx, {
        entidade: 'Email',
        entidadeId: registro.id,
        acao: 'ingerido',
        depois: {
          messageId: email.messageId,
          itens: resultado.criados,
          conteudoSuspeito,
          naoInterpretado: desistir,
        },
        usuario,
        correlacaoId,
      })

      return { ...resultado, anexosRejeitados, conteudoSuspeito, naoInterpretado: desistir }
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
    messageId: string
    interpretacao: Interpretacao
    anexosRejeitados: number
    correlacaoId: string
    usuario: string
  },
): Promise<Omit<ResultadoDeUm, 'anexosRejeitados' | 'conteudoSuspeito' | 'naoInterpretado'>> {
  const { interpretacao } = contexto
  // Uma leitura de `Liga` por LOTE, não por item — ver `indiceDeLigas`.
  const ligas = await indiceDeLigas(tx)
  // Quantas ligas NOVAS este e-mail ainda pode criar (achado N-12). Por e-mail,
  // e não global: um teto global pararia a operação no dia em que a associação
  // realmente cadastrasse muitas ligas, e a pergunta que separa o legítimo do
  // absurdo é "este e-mail sozinho deveria inventar tantas?".
  const orcamentoDeLigas = { novas: 0, barradas: 0 }
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
    // Passou do teto, a liga fica nula e o item vai para a revisão mesmo assim:
    // barrar exige mais de um item no e-mail, e desdobramento sempre passa
    // por humano (acima). A menção continua no payload — quem revisa vê o
    // nome. `teto-de-ligas-novas.test.ts` trava isso: se um dia o
    // desdobramento deixar de ir para a revisão, o item sem liga passaria
    // aprovado sem ninguém ver, e o teste fica vermelho.
    const ligaId = await resolverLiga(tx, ligas, extraido.ligaMencionada, orcamentoDeLigas)

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

  // O teto batido vira registro: sem isto, a diferença entre "este e-mail não
  // mencionava mais ligas" e "o sistema parou de criar" some, e ninguém teria
  // como investigar depois por que uma liga esperada não apareceu.
  //
  // Só quando alguma menção foi BARRADA, e não quando o teto foi alcançado:
  // três ligas novas é o caso legítimo, e um evento dizendo que menções
  // ficaram sem liga quando nenhuma ficou seria memória falsa.
  if (orcamentoDeLigas.barradas > 0) {
    await registrarEvento(tx, {
      correlacaoId: contexto.correlacaoId,
      etapa: 'ingestao',
      situacao: 'reprocessavel',
      referencia: contexto.messageId,
      mensagem:
        `o e-mail passou do teto de ${TETO_DE_LIGAS_NOVAS_POR_EMAIL} ligas novas; ` +
        `${orcamentoDeLigas.barradas} menção(ões) ficaram sem liga e foram para a revisão`,
    })
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
  orcamento: { novas: number; barradas: number },
): Promise<string | null> {
  const chave = chaveDaLiga(mencionada)
  if (chave === null) return null

  const achada = indice.get(chave)
  if (achada) return achada

  // ═══ TETO DE LIGAS NOVAS POR E-MAIL (achado N-12) ═══
  //
  // `Liga` nasce de conteúdo externo: o nome vem do corpo do e-mail e vira
  // linha sempre que a grafia normalizada ainda não existe. Sem teto, um
  // e-mail com trinta nomes inventados criava trinta ligas — e como
  // `indiceDeLigas` lê a tabela INTEIRA a cada lote, cada linha plantada
  // encarece toda sincronização seguinte, para sempre. Não precisa de má
  // intenção: basta uma lista com assinaturas variadas e uma interpretação
  // ruim.
  //
  // Passando do teto, o item NÃO é descartado: ele fica sem liga e cai na
  // revisão humana, que é onde a menção pode virar liga de verdade. Descartar
  // seria perder trabalho em silêncio, que é a doença que este sistema existe
  // para curar.
  if (orcamento.novas >= TETO_DE_LIGAS_NOVAS_POR_EMAIL) {
    orcamento.barradas += 1
    return null
  }

  orcamento.novas += 1
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
