import { ErroOperacional } from '../core/erros'
import { exigirPrazoValido } from '../core/retencao'
import { FalhaDeArmazenamento, type ArmazenamentoPort, type ArquivoGuardado } from '../ports/armazenamento'
import { mensagemDoErro, novaCorrelacao, registrarLog } from '../servidor/observabilidade'
import type { Banco } from '../servidor/prisma'
import { auditar } from './auditoria'

const DIA_EM_MS = 24 * 60 * 60 * 1000

/**
 * Mais órfãos vencidos que isto numa execução não é queda de processo: é o
 * banco errado. Ver `LimpezaDeOrfaosRecusadaError` e `DECISOES.md § C` (`AT-74`).
 */
export const LIMITE_DE_ORFAOS_POR_EXECUCAO = 50

/**
 * Remover um arquivo leva milissegundos no disco local; o padrão de 5 s do
 * Prisma é curto para um compartilhamento de rede lento, e estourá-lo depois
 * de o arquivo sair deixaria a remoção sem trilha.
 */
const PRAZO_DA_TRANSACAO_EM_MS = 30_000

export interface ResultadoDoExpurgoDeOrfaos {
  /** Arquivos no armazenamento. */
  avaliados: number
  /** Desses, os que nenhuma linha de `Anexo` aponta — vencidos ou não. */
  semRegistro: number
  /** Dos sem registro, os que passaram do prazo e saíram nesta execução. */
  removidos: number
}

export interface OpcoesDoLevantamento {
  diasDeRetencao: number
  /** `null` quando o armazenamento não pôde ser criado: a execução falha. */
  armazenamento: ArmazenamentoPort | null
  agora?: Date
}

export interface OpcoesDoExpurgoDeOrfaos extends OpcoesDoLevantamento {
  atorId?: string
  correlacaoId?: string
  /**
   * Uma pessoa viu a lista (`--listar-orfaos`) e aceita apagar EXATAMENTE este
   * número de órfãos vencidos, passando por cima das travas. Só a linha de
   * comando passa isto; a rotina diária, nunca. Número diferente do
   * encontrado: nada sai. O nome declarado vai para a trilha.
   */
  aceite?: { quantidade: number; por: string }
}

export interface LevantamentoDeOrfaos {
  avaliados: number
  semRegistro: number
  /** Os órfãos que passaram do prazo — os que a limpeza apagaria. */
  vencidos: ArquivoGuardado[]
  /** `null` quando a limpeza pode apagar sozinha; senão, o porquê da recusa. */
  recusa: string | null
}

const CONFIRA_O_BANCO =
  'Nada foi apagado. Confira se a aplicação está ligada ao banco certo antes de qualquer outra coisa. ' +
  'Veja quais são com npm run db:expurgar -- --listar-orfaos; se forem mesmo órfãos, ' +
  'npm run db:expurgar -- --aceitar-orfaos=<o número> --por=<seu nome>.'

/**
 * A limpeza dos órfãos se recusou a apagar.
 *
 * Cada queda entre gravar os bytes e gravar a linha deixa os anexos de UM
 * e-mail. Dois retratos são de outra coisa — a aplicação ligada a um banco
 * vazio ou a outro banco, com a pasta de anexos certa: dezenas de órfãos de uma
 * vez, ou NENHUM arquivo do disco com dono. Aí todo documento parece órfão, e
 * apagar seria a perda que não tem volta. Nada sai; a rotina fica `falha` até
 * uma pessoa olhar.
 */
export class LimpezaDeOrfaosRecusadaError extends ErroOperacional {
  readonly codigo = 'LIMPEZA_DE_ORFAOS_RECUSADA'
  readonly statusHttp = 503
}

/**
 * `null` quando pode apagar; senão, o porquê da recusa. Três retratos de banco
 * errado, e nenhum depende dos outros: muitos órfãos; nenhum arquivo com dono
 * (banco vazio ou outro banco, revisão técnica do #211, M1); órfão mais novo
 * que o último anexo registrado (banco restaurado de um backup antigo, revisão
 * de segurança do #211, S3).
 */
function motivoDaRecusa(
  vencidos: readonly ArquivoGuardado[],
  algumComDono: boolean,
  ultimoArmazenadoEm: Date | null,
): string | null {
  if (vencidos.length === 0) return null
  if (vencidos.length > LIMITE_DE_ORFAOS_POR_EXECUCAO) {
    return (
      `${vencidos.length} arquivo(s) de anexo vencido(s) sem registro no banco — mais que o limite de ` +
      `${LIMITE_DE_ORFAOS_POR_EXECUCAO} por execução. ${CONFIRA_O_BANCO}`
    )
  }
  if (!algumComDono) {
    return (
      `${vencidos.length} arquivo(s) de anexo vencido(s) sem registro, e nenhum arquivo do armazenamento ` +
      `tem registro no banco. ${CONFIRA_O_BANCO}`
    )
  }
  const limite = ultimoArmazenadoEm?.getTime() ?? Number.NEGATIVE_INFINITY
  const maisNovos = vencidos.filter((arquivo) => arquivo.gravadoEm.getTime() > limite).length
  if (maisNovos > 0) {
    return (
      `${maisNovos} arquivo(s) de anexo sem registro é(são) mais novo(s) que o último anexo registrado no ` +
      `banco — o retrato de um banco restaurado de backup. ${CONFIRA_O_BANCO}`
    )
  }
  return null
}

/**
 * A chave como o banco a guarda pode ter `\` (gravada antes do achado N-25); o
 * armazenamento lista com `/`. Comparar o texto cru faria de todo anexo antigo
 * um órfão.
 */
function normalizada(chave: string): string {
  return chave.replace(/\\/g, '/')
}

/**
 * Apaga o arquivo de anexo que nenhuma linha de `Anexo` aponta — `DECISOES.md § A78`.
 *
 * ═══ DE ONDE VEM O ÓRFÃO ═══
 *
 * A ingestão grava os bytes ANTES da transação do banco, e o desfazer só roda
 * quando a transação aborta dentro do processo. Uma queda no meio — energia,
 * `kill`, o vigia do modo SQL encerrando — deixa o documento no disco sem
 * linha. O expurgo de conteúdo nunca o alcança, porque caminha a partir do
 * banco (invariante 11), e nada registra que ele está lá (invariante 7).
 *
 * ═══ O PRAZO PROTEGE QUEM AINDA ESTÁ GRAVANDO ═══
 *
 * Só sai o arquivo gravado há mais que o prazo do conteúdo (`A20`). Um arquivo
 * de minutos atrás pode ser de uma ingestão que ainda vai gravar a linha.
 *
 * ═══ A TRILHA ANTES DO ARQUIVO, NA MESMA TRANSAÇÃO ═══
 *
 * A linha da trilha é escrita e o arquivo removido dentro da transação: se a
 * remoção falhar, a linha volta atrás, e a trilha não afirma uma remoção que
 * não houve. A única janela restante é o commit falhar depois da remoção — e
 * aí o log de erro diz que o arquivo saiu sem trilha, com a chave.
 */
export async function expurgarAnexosOrfaos(
  banco: Banco,
  opcoes: OpcoesDoExpurgoDeOrfaos,
): Promise<ResultadoDoExpurgoDeOrfaos> {
  const armazenamento = exigirArmazenamento(opcoes.armazenamento)
  const { avaliados, semRegistro, vencidos, recusa } = await levantarAnexosOrfaos(banco, opcoes)

  const aceite = opcoes.aceite
  if (aceite !== undefined && aceite.quantidade !== vencidos.length) {
    throw new LimpezaDeOrfaosRecusadaError(
      `Aceitos ${aceite.quantidade} órfão(s), mas há ${vencidos.length} vencido(s) agora. ` +
        'Nada foi apagado; liste de novo antes de aceitar.',
    )
  }
  if (aceite === undefined && recusa !== null) throw new LimpezaDeOrfaosRecusadaError(recusa)

  let removidos = 0
  const falhas: string[] = []
  const contexto = {
    dias: opcoes.diasDeRetencao,
    usuario: opcoes.atorId ?? 'sistema',
    correlacaoId: opcoes.correlacaoId ?? novaCorrelacao(),
    aceite,
  }
  const { correlacaoId } = contexto

  for (const arquivo of vencidos) {
    const tentativa = { removido: false }
    try {
      await removerComTrilha(banco, armazenamento, arquivo, contexto, tentativa)
      removidos += 1
    } catch (erro) {
      falhas.push(arquivo.chave)
      // O disco não volta atrás com a transação. Se o arquivo já saiu, dizer
      // "continua guardado" seria o log mentindo no único caso em que a trilha
      // também não tem a linha (revisão técnica do #211, M3).
      registrarLog(
        'erro',
        tentativa.removido
          ? 'arquivo de anexo sem registro foi apagado sem linha na trilha: a transação abortou depois da remoção'
          : 'arquivo de anexo sem registro não pôde ser apagado; continua no armazenamento',
        { correlacaoId, chave: arquivo.chave, erro: mensagemDoErro(erro) },
      )
    }
  }

  if (falhas.length > 0) {
    throw new FalhaDeArmazenamento(
      'remover',
      `${falhas.length} arquivo(s) de anexo sem registro falharam — ${removidos} apagado(s) nesta execução; o log de erro diz o que houve com cada um`,
    )
  }

  return { avaliados, semRegistro, removidos }
}

function exigirArmazenamento(armazenamento: ArmazenamentoPort | null): ArmazenamentoPort {
  if (armazenamento === null) {
    throw new FalhaDeArmazenamento('listar', 'armazenamento indisponível nesta execução')
  }
  return armazenamento
}

/**
 * O que a limpeza apagaria, e se ela se recusaria — sem apagar nada. É o que
 * `npm run db:expurgar -- --listar-orfaos` mostra a quem vai decidir: autorizar
 * só por um número, sem ver quais arquivos, seria decidir no escuro (revisão de
 * segurança do #211, S2).
 */
export async function levantarAnexosOrfaos(
  banco: Banco,
  opcoes: OpcoesDoLevantamento,
): Promise<LevantamentoDeOrfaos> {
  exigirPrazoValido(opcoes.diasDeRetencao)
  const armazenamento = exigirArmazenamento(opcoes.armazenamento)
  const agora = opcoes.agora ?? new Date()

  // A pasta é desta instalação? A sentinela confere que a chave em uso é a que
  // cifrou estes anexos; pasta de outra instalação, com outra chave, não é
  // varrida (revisão de segurança do #211, S4).
  await armazenamento.conferirChave?.()

  // O disco ANTES do banco: um arquivo gravado depois da listagem nem entra na
  // conta, e um gravado antes e cuja linha nasceu depois da consulta é recente
  // demais para sair.
  const arquivos = await armazenamento.listar()
  const [linhas, ultimo] = await Promise.all([
    banco.anexo.findMany({
      where: { chaveArmazenamento: { not: null } },
      select: { chaveArmazenamento: true },
    }),
    banco.anexo.aggregate({ _max: { armazenadoEm: true } }),
  ])
  const comDono = new Set(linhas.map((anexo) => normalizada(anexo.chaveArmazenamento!)))

  const semRegistro = arquivos.filter((arquivo) => !comDono.has(normalizada(arquivo.chave)))
  const limite = agora.getTime() - opcoes.diasDeRetencao * DIA_EM_MS
  const vencidos = semRegistro.filter((arquivo) => arquivo.gravadoEm.getTime() < limite)

  return {
    avaliados: arquivos.length,
    semRegistro: semRegistro.length,
    vencidos,
    recusa: motivoDaRecusa(vencidos, semRegistro.length < arquivos.length, ultimo._max.armazenadoEm),
  }
}

async function removerComTrilha(
  banco: Banco,
  armazenamento: ArmazenamentoPort,
  arquivo: ArquivoGuardado,
  contexto: { dias: number; usuario: string; correlacaoId: string; aceite: { quantidade: number; por: string } | undefined },
  tentativa: { removido: boolean },
): Promise<void> {
  await banco.$transaction(
    async (tx) => {
      await auditar(tx, {
        entidade: 'Armazenamento',
        entidadeId: arquivo.chave,
        acao: 'anexo_orfao_removido',
        // A chave e a data, nunca o conteúdo: a trilha não tem retenção, e o
        // arquivo é documento de associado.
        depois: {
          gravadoEm: arquivo.gravadoEm.toISOString(),
          prazoEmDias: contexto.dias,
          ...(contexto.aceite === undefined
            ? {}
            : { aceitoNaLinhaDeComando: contexto.aceite.quantidade, aceitoPor: contexto.aceite.por }),
        },
        usuario: contexto.usuario,
        correlacaoId: contexto.correlacaoId,
      })
      await armazenamento.remover(arquivo.chave)
      tentativa.removido = true
    },
    { timeout: PRAZO_DA_TRANSACAO_EM_MS },
  )
}
