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
  IA_ADAPTER: z.enum(['mock', 'anthropic', 'gemini']).default('mock'),
  INGESTAO_ADAPTER: z.enum(['mock', 'imap', 'graph', 'gmail']).default('mock'),
  /**
   * Modelo a usar. **Vazio significa "o padrão do adapter escolhido"**, nunca
   * um modelo fixo.
   *
   * Antes o padrão era `claude-sonnet-5` para todo mundo. Com um fornecedor só
   * isso era inofensivo; com dois, trocar `IA_ADAPTER` sem lembrar de trocar
   * esta variável mandaria um nome de modelo da Anthropic para a API do Google
   * — que responde 404 sem dizer por quê, e a pessoa iria procurar o defeito
   * na chave. Cada adapter carrega o próprio padrão em `PerfilDoFornecedor`.
   */
  IA_MODELO: z.string().default(''),
  ANTHROPIC_API_KEY: z.string().optional(),
  /**
   * Chave do Gemini (Google AI Studio).
   *
   * O nome é o que o Google usa para a credencial do AI Studio, e não
   * `GEMINI_API_KEY`, porque a mesma chave serve a outros modelos da casa — se
   * um dia entrar um, ela não precisa mudar de nome nem de dono.
   */
  GOOGLE_AI_KEY: z.string().optional(),
  /**
   * Segredo que assina o cookie de sessão.
   *
   * VALIDADO NA PARTIDA, não na primeira entrada. Era `optional()`, e o sistema
   * subia normalmente: a falha só aparecia quando alguém tentava entrar, como
   * "Erro interno" com id de correlação — e `autenticar` já tinha rodado até o
   * fim, gravado `entrada_autorizada` na trilha e zerado o contador de
   * tentativas. Ou seja: a auditoria registrava uma entrada que não aconteceu,
   * e quem estava publicando o sistema descobria o problema pela pessoa errada,
   * com a mensagem errada.
   *
   * O mínimo de 16 caracteres é o mesmo que `segredo()` já exigia; a diferença
   * é a hora em que a exigência é cobrada. Ver `servidor/sessao.ts`.
   */
  SESSAO_SECRET: z
    .string()
    .min(
      16,
      'SESSAO_SECRET precisa de no mínimo 16 caracteres — gere um com: node -e "console.log(crypto.randomUUID())"',
    ),
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

  // Todo adapter real de IA exige chave. Descobrir isso na primeira chamada ao
  // modelo, em produção, seria tarde demais.
  //
  // A tabela é explícita em vez de uma convenção do tipo "`X` exige
  // `X_API_KEY`": os nomes das credenciais são escolhidos pelos fornecedores,
  // não por nós, e derivá-los por padrão de texto quebraria calado no dia em
  // que um deles não seguisse a forma.
  const CHAVE_EXIGIDA: Record<string, keyof typeof resultado.data> = {
    anthropic: 'ANTHROPIC_API_KEY',
    gemini: 'GOOGLE_AI_KEY',
  }

  const exigida = CHAVE_EXIGIDA[resultado.data.IA_ADAPTER]
  if (exigida && !resultado.data[exigida]) {
    throw new Error(`IA_ADAPTER="${resultado.data.IA_ADAPTER}" exige ${exigida} configurada.`)
  }

  cache = resultado.data
  return cache
}

/** Só para testes: força releitura do ambiente. */
export function limparCacheDeAmbiente(): void {
  cache = undefined
  carregado = false
}
