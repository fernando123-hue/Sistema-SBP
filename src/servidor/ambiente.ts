import { z } from 'zod'

/**
 * Configuração de ambiente.
 *
 * Carregada uma única vez e validada na inicialização — o sistema falha rápido
 * e com mensagem clara, em vez de descobrir a variável faltando no meio de uma
 * transação. Nenhum segredo tem valor default: ausente é erro, não silêncio.
 */

let carregado = false

function carregarArquivoEnv(): void {
  if (carregado) return
  carregado = true
  try {
    process.loadEnvFile()
  } catch {
    // Sem `.env` no disco: usamos apenas o que já está exportado no ambiente.
  }
}

const AmbienteSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória — copie `.env.example` para `.env`'),
  IA_ADAPTER: z.enum(['mock', 'anthropic']).default('mock'),
  INGESTAO_ADAPTER: z.enum(['mock', 'imap', 'graph', 'gmail']).default('mock'),
  IA_MODELO: z.string().default('claude-sonnet-5'),
  ANTHROPIC_API_KEY: z.string().optional(),
  SESSAO_SECRET: z.string().optional(),
  /**
   * Onde os arquivos de anexo são guardados.
   *
   * Fora do repositório de propósito: são documentos de associado, não código.
   * Ao migrar para nuvem, troca-se o adapter de armazenamento e esta variável
   * deixa de ser usada.
   */
  ARMAZENAMENTO_DIR: z.string().default('./armazenamento'),
  /**
   * Quantos proxies confiáveis ficam na frente da aplicação.
   *
   * `0` (padrão) significa acesso direto — e nesse caso `x-forwarded-for` é
   * TEXTO LIVRE escrito por quem chama. Medido no servidor: sem o cabeçalho, o
   * Next preenche com o endereço do socket; com o cabeçalho, ele repassa o
   * valor do cliente inteiro. Ler esse valor como se fosse a origem dá ao
   * atacante um balde de limite de taxa novo por requisição.
   *
   * Com `N > 0`, a origem é a entrada `N` posições antes do fim da cadeia — a
   * que o proxy confiável mais externo acrescentou. Contar do começo é contar
   * o que o cliente escreveu.
   *
   * Ajuste isto ao publicar atrás de nginx, Cloudflare ou balanceador: com o
   * padrão `0`, o limite por origem vira limite global.
   */
  PROXIES_CONFIAVEIS: z.coerce.number().int().min(0).max(10).default(0),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export type Ambiente = z.infer<typeof AmbienteSchema>

let cache: Ambiente | undefined

export function ambiente(): Ambiente {
  if (cache) return cache
  carregarArquivoEnv()

  const resultado = AmbienteSchema.safeParse(process.env)
  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map((problema) => `  ${problema.path.join('.')}: ${problema.message}`)
      .join('\n')
    throw new Error(`Configuração de ambiente inválida:\n${problemas}`)
  }

  // O adapter real de IA exige chave. Descobrir isso na primeira chamada ao
  // modelo, em produção, seria tarde demais.
  if (resultado.data.IA_ADAPTER === 'anthropic' && !resultado.data.ANTHROPIC_API_KEY) {
    throw new Error('IA_ADAPTER="anthropic" exige ANTHROPIC_API_KEY configurada.')
  }

  cache = resultado.data
  return cache
}

/** Só para testes: força releitura do ambiente. */
export function limparCacheDeAmbiente(): void {
  cache = undefined
  carregado = false
}
