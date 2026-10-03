import { ErroOperacional } from '../core/erros'
import { exigirPrazoValido } from '../core/retencao'
import { FalhaDeArmazenamento, type ArmazenamentoPort, type ArquivoGuardado } from '../ports/armazenamento'
import { mensagemDoErro, novaCorrelacao, registrarLog } from '../servidor/observabilidade'
import type { Banco } from '../servidor/prisma'
import { auditar } from './auditoria'

const DIA_EM_MS = 24 * 60 * 60 * 1000

/**
 * Mais órfãos vencidos que isto numa execução não é queda de processo: é o
 * banco errado. Ver `OrfaosAlemDoLimiteError` e `DECISOES.md § C`.
 */
export const LIMITE_DE_ORFAOS_POR_EXECUCAO = 50

export interface ResultadoDoExpurgoDeOrfaos {
  /** Arquivos no armazenamento. */
  avaliados: number
  /** Desses, os que nenhuma linha de `Anexo` aponta — vencidos ou não. */
  semRegistro: number
  /** Dos sem registro, os que passaram do prazo e saíram nesta execução. */
  removidos: number
}

export interface OpcoesDoExpurgoDeOrfaos {
  diasDeRetencao: number
  /** `null` quando o armazenamento não pôde ser criado: a execução falha. */
  armazenamento: ArmazenamentoPort | null
  agora?: Date
  atorId?: string
  correlacaoId?: string
}

/**
 * Órfãos vencidos demais para serem obra de uma queda de processo.
 *
 * Cada queda entre gravar os bytes e gravar a linha deixa os anexos de UM
 * e-mail. Dezenas de uma vez é o retrato de outra coisa: a aplicação ligada a
 * um banco vazio ou a outro banco, com a pasta de anexos certa. Aí TODO
 * documento parece órfão, e apagar seria a perda que não tem volta. Nada sai;
 * a rotina fica `falha` até alguém olhar.
 */
export class OrfaosAlemDoLimiteError extends ErroOperacional {
  readonly codigo = 'ORFAOS_ALEM_DO_LIMITE'
  readonly statusHttp = 503

  constructor(quantidade: number) {
    super(
      `${quantidade} arquivo(s) de anexo vencido(s) sem registro no banco — mais que o limite de ` +
        `${LIMITE_DE_ORFAOS_POR_EXECUCAO} por execução. Nada foi apagado. Confira se a aplicação ` +
        `está ligada ao banco certo antes de qualquer outra coisa.`,
    )
  }
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
 * aí a chave vai para o log de erro.
 */
export async function expurgarAnexosOrfaos(
  banco: Banco,
  opcoes: OpcoesDoExpurgoDeOrfaos,
): Promise<ResultadoDoExpurgoDeOrfaos> {
  exigirPrazoValido(opcoes.diasDeRetencao)

  const armazenamento = opcoes.armazenamento
  if (armazenamento === null) {
    throw new FalhaDeArmazenamento('listar', 'armazenamento indisponível nesta execução')
  }

  const dias = opcoes.diasDeRetencao
  const agora = opcoes.agora ?? new Date()
  const usuario = opcoes.atorId ?? 'sistema'
  const correlacaoId = opcoes.correlacaoId ?? novaCorrelacao()

  // O disco ANTES do banco: um arquivo gravado depois da listagem nem entra na
  // conta, e um gravado antes e cuja linha nasceu depois da consulta é recente
  // demais para sair.
  const arquivos = await armazenamento.listar()
  const comDono = new Set(
    (
      await banco.anexo.findMany({
        where: { chaveArmazenamento: { not: null } },
        select: { chaveArmazenamento: true },
      })
    ).map((anexo) => normalizada(anexo.chaveArmazenamento!)),
  )

  const semRegistro = arquivos.filter((arquivo) => !comDono.has(normalizada(arquivo.chave)))
  const limite = agora.getTime() - dias * DIA_EM_MS
  const vencidos = semRegistro.filter((arquivo) => arquivo.gravadoEm.getTime() < limite)

  if (vencidos.length > LIMITE_DE_ORFAOS_POR_EXECUCAO) {
    throw new OrfaosAlemDoLimiteError(vencidos.length)
  }

  let removidos = 0
  const falhas: string[] = []

  for (const arquivo of vencidos) {
    try {
      await removerComTrilha(banco, armazenamento, arquivo, { dias, usuario, correlacaoId })
      removidos += 1
    } catch (erro) {
      falhas.push(arquivo.chave)
      registrarLog('erro', 'arquivo de anexo sem registro não pôde ser apagado; continua no armazenamento', {
        correlacaoId,
        chave: arquivo.chave,
        erro: mensagemDoErro(erro),
      })
    }
  }

  if (falhas.length > 0) {
    throw new FalhaDeArmazenamento(
      'remover',
      `${falhas.length} arquivo(s) de anexo sem registro continuam guardados — ${removidos} apagado(s) nesta execução`,
    )
  }

  return { avaliados: arquivos.length, semRegistro: semRegistro.length, removidos }
}

async function removerComTrilha(
  banco: Banco,
  armazenamento: ArmazenamentoPort,
  arquivo: ArquivoGuardado,
  contexto: { dias: number; usuario: string; correlacaoId: string },
): Promise<void> {
  await banco.$transaction(async (tx) => {
    await auditar(tx, {
      entidade: 'Armazenamento',
      entidadeId: arquivo.chave,
      acao: 'anexo_orfao_removido',
      // A chave e a data, nunca o conteúdo: a trilha não tem retenção, e o
      // arquivo é documento de associado.
      depois: { gravadoEm: arquivo.gravadoEm.toISOString(), prazoEmDias: contexto.dias },
      usuario: contexto.usuario,
      correlacaoId: contexto.correlacaoId,
    })
    await armazenamento.remover(arquivo.chave)
  })
}
