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
  /** A IA desdobrou um e-mail em vários itens. Quantidade de carga é decisão humana. */
  'desdobramento',
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

/**
 * Teto de itens que o operador pode criar ao dividir uma revisão em mais de
 * uma unidade de carga (AT-06: "a IA propõe N; o operador ajusta").
 *
 * Bem mais baixo que `LIMITE_ITENS_POR_EMAIL` porque aqui é digitação humana,
 * item a item — o mesmo raciocínio do teto de ingestão (erro visível em vez
 * de silencioso), só que a ameaça é erro de clique, não alucinação de IA.
 */
export const LIMITE_ITENS_POR_DIVISAO_MANUAL = 20

export const TAMANHO_MAXIMO_CORPO = 200_000
export const TAMANHO_MAXIMO_ANEXO_BYTES = 25 * 1024 * 1024

// ─── E-mail bruto (entrada da ingestão) ──────────────────────

export const AnexoSchema = z.object({
  nome: z.string().min(1).max(255),
  /** O que o REMETENTE alegou. Registrado para auditoria, nunca usado para decidir. */
  tipoDeclarado: z.string().max(200).default('application/octet-stream'),
  tamanho: z.number().int().nonnegative().max(TAMANHO_MAXIMO_ANEXO_BYTES),
  hash: z.string().max(128).nullable().default(null),
  /**
   * Bytes do arquivo, quando o adapter de ingestão os entrega.
   *
   * Opcional porque nem toda origem baixa o anexo junto do e-mail — IMAP pode
   * listar antes de buscar. Sem bytes, o sistema guarda o metadado e registra
   * que o arquivo não foi armazenado; nunca finge que guardou.
   */
  conteudo: z.instanceof(Uint8Array).optional(),
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
  /**
   * TRAVADO EM 1 até o motor de fato usar este campo.
   *
   * O campo atravessava o sistema inteiro — schema aceitava 0..2, o serviço
   * gravava, a auditoria registrava — e o motor NUNCA o lia. Alguém marcaria
   * meio período com `0.5`, veria o valor na tela, e a pessoa receberia a cota
   * cheia. É exatamente o defeito do `Mov. Extra` da planilha: um número que se
   * digita e o sistema descarta.
   *
   * Melhor recusar do que aceitar em silêncio. Quando o motor passar a ponderar
   * por capacidade, este limite sai junto com a implementação.
   */
  capacidadeRelativa: z
    .literal(1)
    .default(1)
    .describe('Capacidade parcial ainda não é aplicada pelo motor de distribuição.'),
  observacao: z.string().max(500).nullable().default(null),
})

/**
 * NENHUM esquema de entrada carrega "quem fez".
 *
 * A identidade do autor vem de `Ator`, resolvido da sessão autenticada, nunca
 * do corpo da requisição. Se `executadoPor` ou `resolvidoPor` estivessem aqui,
 * uma rota HTTP poderia repassar o valor enviado pelo cliente direto para o
 * `LogAuditoria` — e a trilha que deveria provar "quem fez o quê" viraria
 * campo livre preenchido por quem chamou.
 */
export const PedidoDistribuicaoSchema = z.object({
  data: DataIsoSchema,
  /** Vazio = todas as categorias com itens aprovados no dia. */
  categorias: z.array(CategoriaCodigoSchema).default([]),
})
export type PedidoDistribuicao = z.infer<typeof PedidoDistribuicaoSchema>

/** Item extra que o operador cria ao dividir uma revisão em mais de uma unidade de carga. */
export const ItemDivididoSchema = z.object({
  titulo: z.string().min(1).max(300),
  campos: z.record(z.string().max(60), z.string().max(2000)).default({}),
})
export type ItemDividido = z.infer<typeof ItemDivididoSchema>

export const ResolucaoRevisaoSchema = z.object({
  revisaoId: z.string().min(1),
  categoriaCodigo: CategoriaClassificavelSchema,
  titulo: z.string().min(1).max(300),
  campos: z.record(z.string().max(60), z.string().max(2000)).default({}),
  aprovar: z.boolean().default(true),
  /**
   * Itens além do original, quando a IA subestimou o N do desdobramento.
   * Ignorado se `aprovar` for falso — não faz sentido criar carga nova a
   * partir de uma revisão que está sendo recusada.
   */
  itensExtras: z.array(ItemDivididoSchema).max(LIMITE_ITENS_POR_DIVISAO_MANUAL).default([]),
})

// ─── Credenciais ─────────────────────────────────────────────

/**
 * Regra de senha.
 *
 * Comprimento mínimo em vez de exigência de símbolo/maiúscula/dígito: é o que
 * o NIST recomenda desde 2017, porque regras de composição empurram a pessoa
 * para `Senha@2026` — previsível — enquanto uma frase longa é forte e
 * memorizável. O teto existe só para limitar o custo do hash por requisição.
 */
export const SenhaSchema = z
  .string()
  .min(10, 'a senha precisa de pelo menos 10 caracteres')
  .max(200, 'a senha passa de 200 caracteres')

export const CredenciaisSchema = z.object({
  email: z.string().min(1).max(320).toLowerCase().trim(),
  senha: z.string().min(1).max(200),
})

export const TrocaDeSenhaSchema = z.object({
  senhaAtual: z.string().min(1).max(200),
  senhaNova: SenhaSchema,
})

/**
 * Gestor definindo a senha provisória de alguém.
 *
 * Não carrega quem definiu — isso vem do `Ator`. A senha é OPCIONAL de
 * propósito: omitida, o servidor sorteia uma forte e a devolve uma única vez.
 * A tela nunca envia este campo; ele existe para script e teste, onde um valor
 * fixo é o que torna o resultado verificável.
 */
export const DefinicaoDeSenhaSchema = z.object({
  colaboradorId: z.string().min(1),
  senhaProvisoria: SenhaSchema.optional(),
})

/** Gestor tirando alguém do bloqueio por tentativas, sem esperar o tempo passar. */
export const DestravamentoSchema = z.object({
  colaboradorId: z.string().min(1),
})

/** Gestor ligando ou desligando o acesso de alguém. Desligar encerra a sessão em aberto. */
export const AtivacaoSchema = z.object({
  colaboradorId: z.string().min(1),
  ativo: z.boolean(),
})

/** Forma do `Item.payload`. Usada ao reler o que a IA extraiu. */
export const PayloadDoItemSchema = z.object({
  campos: z.record(z.string().max(60), z.string().max(2000)).default({}),
  camposAusentes: z.array(z.string().max(60)).default([]),
  ligaMencionada: z.string().max(200).nullable().default(null),
  observacao: z.string().max(1000).nullable().default(null),
  revisadoPorHumano: z.boolean().default(false),
})
export type PayloadDoItem = z.infer<typeof PayloadDoItemSchema>

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
