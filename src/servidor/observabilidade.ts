import { randomUUID } from 'node:crypto'

import { ErroDominio } from '../core/erros'
import { DOMINIO_ATUAL, serializar, type SituacaoEvento } from '../core/esquemas'
import type { Transacao } from './prisma'

/**
 * Logs estruturados e trilha de processamento.
 *
 * Responde as cinco perguntas do requisito de observabilidade: o que falhou,
 * onde, quando, qual operação estava em curso, e se pode ser reprocessada.
 *
 * Todo fluxo carrega um `correlacaoId` do início ao fim — ingestão, IA, revisão
 * e distribuição de um mesmo ciclo compartilham o mesmo id, e a
 * `RodadaDistribuicao` o persiste. Dado um número errado no painel, é possível
 * puxar a linha inteira.
 */

export type Nivel = 'debug' | 'info' | 'aviso' | 'erro'

/** Chaves cujo valor nunca aparece em log, mesmo que alguém as passe por engano. */
const CHAVES_SENSIVEIS = new Set([
  'senha',
  'senhahash',
  'token',
  'authorization',
  'apikey',
  'api_key',
  'anthropic_api_key',
  'sessao_secret',
  'secret',
  'cpf',
  'crm',
  'corpo',
])

const PROFUNDIDADE_MAXIMA = 6

/**
 * Redação recursiva.
 *
 * A primeira versão só olhava o nível superior do objeto: `{ corpo }` era
 * redigido, mas `{ email: { corpo } }` passava direto para o stdout. Como esta
 * função é o único portão entre PII e o log, ela tem de descer na estrutura.
 */
function redigir(valor: unknown, profundidade = 0): unknown {
  if (profundidade > PROFUNDIDADE_MAXIMA) return '[profundo demais]'
  if (valor === null || typeof valor !== 'object') return valor
  if (valor instanceof Date) return valor.toISOString()
  if (Array.isArray(valor)) return valor.map((item) => redigir(item, profundidade + 1))

  const saida: Record<string, unknown> = {}
  for (const [chave, conteudo] of Object.entries(valor as Record<string, unknown>)) {
    saida[chave] = CHAVES_SENSIVEIS.has(chave.toLowerCase())
      ? '[redigido]'
      : redigir(conteudo, profundidade + 1)
  }
  return saida
}

export function novaCorrelacao(): string {
  return randomUUID()
}

export function registrarLog(
  nivel: Nivel,
  mensagem: string,
  contexto: Record<string, unknown> = {},
): void {
  const linha = serializar({
    nivel,
    mensagem,
    instante: new Date().toISOString(),
    ...(redigir(contexto) as Record<string, unknown>),
  })

  if (nivel === 'erro') process.stderr.write(`${linha}\n`)
  else process.stdout.write(`${linha}\n`)
}

export interface EventoEntrada {
  correlacaoId: string
  etapa: string
  situacao: SituacaoEvento
  referencia?: string | null
  mensagem?: string | null
  detalhe?: unknown
  duracaoMs?: number | null
}

export async function registrarEvento(banco: Transacao, evento: EventoEntrada): Promise<void> {
  await banco.eventoProcessamento.create({
    data: {
      dominio: DOMINIO_ATUAL,
      correlacaoId: evento.correlacaoId,
      etapa: evento.etapa,
      situacao: evento.situacao,
      referencia: evento.referencia ?? null,
      mensagem: evento.mensagem ?? null,
      // `detalhe` também passa por redação. Hoje só recebe contagens agregadas,
      // mas o campo é gravado no banco sem TTL: um chamador futuro que passasse
      // o payload de um item deixaria CPF e corpo de e-mail em texto puro.
      detalhe: evento.detalhe === undefined ? null : serializar(redigir(evento.detalhe)),
      duracaoMs: evento.duracaoMs ?? null,
    },
  })
}

/**
 * Texto de erro que pode ser GRAVADO e depois lido pela API.
 *
 * `mensagemDoErro` devolve a mensagem crua, e ela nem sempre pode sair daqui.
 * `ConservacaoVioladaError` carrega a alocação inteira — o id de cada colega
 * da rodada; um erro do SDK de IA carrega o que o fornecedor resolveu dizer;
 * um erro do SQLite carrega o caminho do arquivo do banco. Enquanto
 * `EventoProcessamento` era gravado e nunca lido, isso era teórico. Com a
 * consulta de memória deixou de ser.
 *
 * A regra é a MESMA que `http.ts` já usava para decidir o que cruza para o
 * cliente, e não uma invenção nova: erro de DOMÍNIO tem mensagem escrita para
 * humano e vai inteiro; qualquer outro vira só o nome da classe, e o detalhe
 * fica no log do servidor. `ConservacaoVioladaError` é a exceção explícita —
 * é erro de domínio e mesmo assim não sai, exatamente como lá.
 */
export function mensagemPersistivel(erro: unknown): string {
  if (erro instanceof ErroDominio && erro.codigo !== 'CONSERVACAO_VIOLADA') {
    return erro.message
  }
  return erro instanceof Error ? erro.name : 'Erro inesperado'
}

export function mensagemDoErro(erro: unknown): string {
  if (erro instanceof Error) return erro.message
  return 'Erro inesperado'
}
