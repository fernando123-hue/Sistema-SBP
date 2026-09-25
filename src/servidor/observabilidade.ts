import { createHash, randomUUID } from 'node:crypto'

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

/**
 * Script que imprime saída para máquina (`ia:avaliar -- --json`) promete que o
 * stdout é só dele. Sem isto, um `aviso` do adapter no meio da rodada virava
 * linha extra no arquivo guardado (achado na máquina da IA local, 25/09/2026).
 * O servidor nunca chama: lá o coletor espera `info` e `aviso` no stdout.
 */
let todoLogNoStderr = false

export function mandarTodoLogAoStderr(): void {
  todoLogNoStderr = true
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

  if (nivel === 'erro' || todoLogNoStderr) process.stderr.write(`${linha}\n`)
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

/**
 * O tamanho de `EventoProcessamento.referencia` (VARCHAR(191)).
 *
 * A referência costuma ser um `messageId`, que vem de fora e pode ser maior
 * que a coluna (achado C-04). Gravar a falha não pode falhar: o erro do banco
 * subia e derrubava a sincronização inteira. O começo do identificador basta
 * para uma pessoa achar a mensagem.
 */
export const TAMANHO_MAXIMO_REFERENCIA = 191

/**
 * A referência que cabe na coluna, e o que mais o evento precisa guardar.
 *
 * Corte por CARACTERE (`Array.from`), como o MySQL conta: `slice` conta
 * unidades UTF-16 e partia um emoji ao meio, gravando `�` no lugar. Quando
 * corta, o evento guarda o SHA-256 da referência inteira em `detalhe`: sem
 * isso, várias mensagens forjadas com o mesmo começo pareceriam uma falha só
 * na trilha (revisão de segurança do PR #60).
 */
function referenciaQueCabe(referencia: string | null | undefined): {
  referencia: string | null
  resumo?: string
} {
  if (referencia === undefined || referencia === null) return { referencia: null }
  const caracteres = Array.from(referencia)
  if (caracteres.length <= TAMANHO_MAXIMO_REFERENCIA) return { referencia }
  return {
    referencia: caracteres.slice(0, TAMANHO_MAXIMO_REFERENCIA).join(''),
    resumo: createHash('sha256').update(referencia).digest('hex'),
  }
}

export async function registrarEvento(banco: Transacao, evento: EventoEntrada): Promise<void> {
  const { referencia, resumo } = referenciaQueCabe(evento.referencia)
  const detalhe =
    resumo === undefined
      ? evento.detalhe
      : {
          ...(evento.detalhe !== null && typeof evento.detalhe === 'object' && !Array.isArray(evento.detalhe)
            ? (evento.detalhe as Record<string, unknown>)
            : evento.detalhe === undefined
              ? {}
              : { valor: evento.detalhe }),
          referenciaSha256: resumo,
        }

  await banco.eventoProcessamento.create({
    data: {
      dominio: DOMINIO_ATUAL,
      correlacaoId: evento.correlacaoId,
      etapa: evento.etapa,
      situacao: evento.situacao,
      referencia,
      mensagem: evento.mensagem ?? null,
      // `detalhe` também passa por redação. Hoje só recebe contagens agregadas,
      // mas o campo é gravado no banco sem TTL: um chamador futuro que passasse
      // o payload de um item deixaria CPF e corpo de e-mail em texto puro.
      detalhe: detalhe === undefined ? null : serializar(redigir(detalhe)),
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
