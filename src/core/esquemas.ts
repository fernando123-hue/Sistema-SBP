import { z } from 'zod'

/**
 * Zod é a fonte da verdade dos domínios fechados.
 *
 * O banco guarda `String` (para o schema portar de SQLite para PostgreSQL sem
 * mudar um model sequer), mas nada entra sem passar por aqui. Toda borda do
 * sistema — IA, API, ingestão, formulário — valida contra estes esquemas.
 */

// ─── Domínios fechados ───────────────────────────────────────

export const PapelSchema = z.enum(['operador', 'colaborador', 'gestor'])
export type Papel = z.infer<typeof PapelSchema>

export const FrenteSchema = z.enum(['CADASTRO', 'TITULOS'])
export const GrupoSchema = z.enum(['ASSOCIADO', 'LIGA'])

export const CategoriaCodigoSchema = z.enum([
  'DOC_CADASTRO',
  'FICHA_CADASTRO',
  'EMAIL_CADASTRO',
  'LIGA',
  'LIGANTE',
  'EMAIL_LIGA',
  'INADIMP',
  'ISENTO',
])
export type CategoriaCodigo = z.infer<typeof CategoriaCodigoSchema>

/** Categorias que a IA pode atribuir. `INADIMP`/`ISENTO` são registro manual. */
export const CategoriaClassificavelSchema = z.enum([
  'DOC_CADASTRO',
  'FICHA_CADASTRO',
  'EMAIL_CADASTRO',
  'LIGA',
  'LIGANTE',
  'EMAIL_LIGA',
])

export const StatusItemSchema = z.enum([
  'novo',
  'aguardando_revisao',
  'aprovado',
  'distribuido',
  'em_andamento',
  'concluido',
  'devolvido',
  'cancelado',
])
export type StatusItem = z.infer<typeof StatusItemSchema>

export const MotivoAtribuicaoSchema = z.enum([
  'algoritmo',
  'manual',
  'transferencia',
  'devolucao',
])
export type MotivoAtribuicao = z.infer<typeof MotivoAtribuicaoSchema>

export const MotivoRevisaoSchema = z.enum([
  'baixa_confianca',
  'campo_ausente',
  'duplicata_suspeita',
  'anomalia',
  'conteudo_suspeito',
])
export type MotivoRevisao = z.infer<typeof MotivoRevisaoSchema>

export const SituacaoEventoSchema = z.enum([
  'iniciado',
  'sucesso',
  'falha',
  'reprocessavel',
])

// ─── Limites de robustez ─────────────────────────────────────

/**
 * Teto de itens que um único e-mail pode gerar.
 *
 * Um e-mail de liga com 30 ligantes é legítimo. Um que "gera" 40.000 é
 * alucinação do modelo ou tentativa de exaustão de recursos. O teto transforma
 * os dois casos em erro visível em vez de 40.000 linhas no banco.
 */
export const LIMITE_ITENS_POR_EMAIL = 500

export const TAMANHO_MAXIMO_CORPO = 200_000
export const TAMANHO_MAXIMO_ANEXO_BYTES = 25 * 1024 * 1024

// ─── E-mail bruto (entrada da ingestão) ──────────────────────

export const AnexoSchema = z.object({
  nome: z.string().min(1).max(255),
  tipoDeclarado: z.string().max(200).default('application/octet-stream'),
  tamanho: z.number().int().nonnegative().max(TAMANHO_MAXIMO_ANEXO_BYTES),
  hash: z.string().max(128).nullable().default(null),
})
export type Anexo = z.infer<typeof AnexoSchema>

export const EmailBrutoSchema = z.object({
  /** Chave de idempotência. Reprocessar o mesmo e-mail nunca duplica trabalho. */
  messageId: z.string().min(1).max(500),
  remetente: z.string().min(1).max(320),
  assunto: z.string().max(1000).default(''),
  corpo: z.string().max(TAMANHO_MAXIMO_CORPO).default(''),
  anexos: z.array(AnexoSchema).max(50).default([]),
  recebidoEm: z.coerce.date(),
  origem: z.enum(['mock', 'imap', 'graph', 'gmail', 'manual']).default('mock'),
})
export type EmailBruto = z.infer<typeof EmailBrutoSchema>

// ─── Saída estruturada da IA ─────────────────────────────────

/**
 * Contrato de saída do `AiPort`.
 *
 * Nenhuma resposta textual livre aciona operação. O modelo devolve isto,
 * validado, ou a interpretação falha e o e-mail vai para revisão humana.
 */
export const ItemExtraidoSchema = z.object({
  categoriaCodigo: CategoriaClassificavelSchema,
  titulo: z.string().min(1).max(300),
  confianca: z.number().min(0).max(1),
  /** Campos extraídos. Chaves e valores limitados — a IA não define esquema. */
  campos: z.record(z.string().max(60), z.string().max(2000)).default({}),
  camposAusentes: z.array(z.string().max(60)).max(50).default([]),
  ligaMencionada: z.string().max(200).nullable().default(null),
  observacao: z.string().max(1000).nullable().default(null),
})
export type ItemExtraido = z.infer<typeof ItemExtraidoSchema>

export const InterpretacaoSchema = z.object({
  itens: z.array(ItemExtraidoSchema).max(LIMITE_ITENS_POR_EMAIL),
  /** `true` quando o conteúdo tenta dar instruções ao sistema. Força revisão. */
  conteudoSuspeito: z.boolean().default(false),
  padroesSuspeitos: z.array(z.string().max(200)).max(20).default([]),
  modelo: z.string().min(1).max(100),
  versaoPrompt: z.string().min(1).max(50),
})
export type Interpretacao = z.infer<typeof InterpretacaoSchema>

// ─── Escala e distribuição ───────────────────────────────────

export const DataIsoSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'data deve estar no formato YYYY-MM-DD')

export const EscalaEntradaSchema = z.object({
  data: DataIsoSchema,
  colaboradorId: z.string().min(1),
  disponivel: z.boolean(),
  capacidadeRelativa: z.number().positive().max(2).default(1),
  observacao: z.string().max(500).nullable().default(null),
})

export const PedidoDistribuicaoSchema = z.object({
  data: DataIsoSchema,
  /** Vazio = todas as categorias com itens aprovados no dia. */
  categorias: z.array(CategoriaCodigoSchema).default([]),
  executadoPor: z.string().min(1),
})
export type PedidoDistribuicao = z.infer<typeof PedidoDistribuicaoSchema>

export const ResolucaoRevisaoSchema = z.object({
  revisaoId: z.string().min(1),
  categoriaCodigo: CategoriaClassificavelSchema,
  titulo: z.string().min(1).max(300),
  campos: z.record(z.string().max(60), z.string().max(2000)).default({}),
  aprovar: z.boolean().default(true),
  resolvidoPor: z.string().min(1),
})

// ─── Utilitário de serialização ──────────────────────────────

/** O banco guarda JSON como texto. Isto é a única porta de entrada e saída. */
export function serializar(valor: unknown): string {
  return JSON.stringify(valor)
}

export function desserializar<T>(texto: string, esquema: z.ZodType<T>, padrao: T): T {
  try {
    return esquema.parse(JSON.parse(texto))
  } catch {
    return padrao
  }
}
