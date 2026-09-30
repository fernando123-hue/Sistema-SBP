import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import { ehNomeDeModelo } from '../core/ia/nome-de-modelo'

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
  IA_ADAPTER: z.enum(['mock', 'anthropic', 'gemini', 'local']).default('mock'),
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
   * Endereço do servidor de modelo compatível com OpenAI (`A56 (b)`).
   *
   * É a raiz da API, terminando antes de `/chat/completions` — por exemplo
   * `http://127.0.0.1:11434/v1` (Ollama) ou `http://127.0.0.1:8080/v1`
   * (llama.cpp). Trocar de servidor é trocar este endereço; nada mais.
   */
  IA_LOCAL_URL: z.string().default(''),
  /**
   * Token do servidor local, quando ele exigir um.
   *
   * Vários servidores aceitam qualquer valor, e alguns não pedem nada. É
   * opcional de propósito: exigir um segredo que não existe faria a pessoa
   * inventar um e guardá-lo como se protegesse alguma coisa.
   */
  IA_LOCAL_CHAVE: z.string().optional(),
  /**
   * Classificador de segunda opinião (`A62`). **`nenhum` é o padrão**: sem
   * ele o sistema funciona igual, só sem a segunda opinião. É uma variável
   * separada de `IA_ADAPTER` porque é OUTRO fornecedor, com outra decisão de
   * dado — e a trava `CLASSIFICADOR_PARA_DADO_REAL` abaixo é por fornecedor.
   */
  CLASSIFICADOR_ADAPTER: z.enum(['nenhum', 'mock', 'typesafe']).default('nenhum'),
  /** Vazio = o padrão do fornecedor (`jev-latest` na TypeSafe). */
  CLASSIFICADOR_MODELO: z
    .string()
    .default('')
    .refine((modelo) => modelo === '' || ehNomeDeModelo(modelo), {
      message: 'CLASSIFICADOR_MODELO precisa ser um nome de modelo (letras, números e . : / - _, até 100)',
    }),
  /** Chave da TypeSafe. O nome é o que o SDK oficial deles lê. */
  TYPESAFE_API_KEY: z.string().optional(),
  /**
   * Teto de chamadas à IA por dia, por fornecedor (`A54`, achado C-06).
   *
   * **Zero significa sem teto**, e não "nenhuma chamada": um teto zerado por
   * engano deixaria o sistema mudo por causa de uma variável esquecida, que é o
   * oposto de falhar alto. O padrão vem de `core/ia/consumo.ts`, junto com a
   * conta que o justifica.
   */
  // A variável VAZIA precisa significar o mesmo que a ausente — vazia é o valor
  // que está no `.env.example`. Sem o `preprocess`, `z.coerce.number()` lê `''`
  // como `Number('')`, que é 0, e 0 significa SEM TETO: quem copiasse o arquivo
  // de exemplo desligava em silêncio a única trava de gasto. Mesma classe de
  // defeito já corrigida em ANEXOS_SECRET e GRAPH_LER_DESDE, neste arquivo.
  IA_TETO_DIARIO: z.preprocess(
    (valor) => (typeof valor === 'string' && valor.trim() === '' ? undefined : valor),
    z.coerce.number().int().min(0).optional(),
  ),
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
   * A chave de sessão de antes da troca, só para a troca de rotina (achado C-25).
   *
   * Trocar `SESSAO_SECRET` sozinho derruba todo mundo no meio do expediente.
   * Com esta variável, o cookie emitido antes da troca continua valendo até
   * expirar, e todo cookie novo sai com a chave nova. Ela só CONFERE; nunca
   * assina. Vale nas primeiras 12h do processo, a validade de um cookie: depois
   * disso `servidor/sessao.ts` a ignora, mesmo esquecida aqui.
   *
   * Depois de um VAZAMENTO, não use: a chave vazada é justamente a que não pode
   * continuar abrindo sessão. Nesse caso, troque só `SESSAO_SECRET` e deixe
   * todo mundo entrar de novo.
   */
  //
  // Vazia é o mesmo que ausente, como em `ANEXOS_SECRET`: é o estado normal,
  // fora de uma troca.
  SESSAO_SECRET_ANTERIOR: z
    .string()
    .transform((valor) => (valor.trim() === '' ? undefined : valor))
    .pipe(
      z
        .string()
        .min(16, 'SESSAO_SECRET_ANTERIOR, quando definido, precisa de no mínimo 16 caracteres')
        .optional(),
    )
    .optional(),
  /**
   * Onde os arquivos de anexo são guardados.
   *
   * Fora do repositório de propósito: são documentos de associado, não código.
   * Ao migrar para nuvem, troca-se o adapter de armazenamento e esta variável
   * deixa de ser usada.
   */
  //
  // `.default()` cobre a variável AUSENTE; `ARMAZENAMENTO_DIR=` (presente e
  // vazia) atravessava como `''`, e `resolve('')` é o diretório do processo —
  // a raiz do repositório. O primeiro anexo nasceria em `01/....pdf` ao lado do
  // código, fora do que o `.gitignore` protege, e um `git add -A` comitaria
  // documento de associado. A trava de travessia não pega: a raiz É o repo.
  ARMAZENAMENTO_DIR: z
    .string()
    .trim()
    .min(1, 'ARMAZENAMENTO_DIR não pode ser vazio')
    .default('./armazenamento'),
  /**
   * Segredo que cifra os bytes de anexo em repouso (`H-D19`).
   *
   * Separado de `SESSAO_SECRET` porque os dois têm ciclos de vida OPOSTOS.
   * Rotacionar o segredo de sessão é rotina de segurança — custa uma reentrada
   * por pessoa e nada mais. Rotacionar a chave dos anexos torna ILEGÍVEL todo
   * documento já gravado, porque não existe rotina de recifragem.
   *
   * Vazio significa "usa `SESSAO_SECRET`" — mas SÓ fora de produção: em
   * `NODE_ENV=production` ele é obrigatório e diferente do de sessão (achado
   * C-25, conferido mais abaixo). Fora de produção, cair na sessão é o que
   * mantém a instalação de desenvolvimento funcionando sem migração. Quem for
   * rotacionar o segredo de sessão numa instalação sem esta variável precisa
   * ANTES fixá-la com o valor antigo — senão os anexos param de abrir, e a
   * mensagem de erro em `armazenamento-disco.ts` é a única pista de por quê.
   */
  //
  // `ANEXOS_SECRET=` (presente e vazia) precisa significar o mesmo que ausente:
  // é o que a linha comentada do `.env.example` promete, e `.optional()`
  // sozinho cobre só o ausente. Sem o `transform`, a instalação que seguiu a
  // documentação ao pé da letra RECUSAVA SUBIR — testado.
  ANEXOS_SECRET: z
    .string()
    .transform((valor) => (valor.trim() === '' ? undefined : valor))
    .pipe(
      z
        .string()
        .min(16, 'ANEXOS_SECRET, quando definido, precisa de no mínimo 16 caracteres')
        .optional(),
    )
    .optional(),
  /**
   * Segredo do CPF protegido (`A23(b)`): o código guardado para achar um item
   * pelo CPF depois que o texto do e-mail foi apagado.
   *
   * OBRIGATÓRIO e separado dos outros dois, pelo ciclo de vida: trocar este
   * valor quebra a busca de todo item cujo texto já saiu, porque não sobra CPF
   * para recalcular o código. É o mesmo peso de `ANEXOS_SECRET` (`AT-13`), e
   * pior que o de `SESSAO_SECRET`, que custa só uma reentrada. Por isso também
   * NÃO cai em `SESSAO_SECRET` quando vazio: rotacionar a sessão, que é rotina,
   * não pode apagar a busca por baixo.
   */
  BUSCA_SECRET: z
    .string()
    .min(
      16,
      'BUSCA_SECRET precisa de no mínimo 16 caracteres — gere um com: node -e "console.log(crypto.randomBytes(32).toString(\'base64url\'))"',
    ),
  /**
   * Credenciais da caixa do Microsoft 365 (`A47`), usadas só quando
   * `INGESTAO_ADAPTER="graph"`.
   *
   * Opcionais AQUI e obrigatórias no adapter, de propósito: quem roda com
   * `mock` — todo o desenvolvimento e toda a suíte — não precisa de credencial
   * nenhuma, e exigir as quatro na partida impediria o sistema de subir na
   * máquina de quem só quer ver as telas. O adapter falha alto e nominal na
   * primeira sincronização, dizendo qual variável falta e de onde ela vem.
   *
   * `GRAPH_CAIXA` é UMA caixa, a da secretaria. A permissão pedida ao TI é de
   * leitura apenas, e restrita a ela — uma credencial que alcança a
   * organização inteira transforma um defeito de código num vazamento de
   * escala completamente diferente.
   */
  GRAPH_TENANT_ID: z.string().optional(),
  GRAPH_CLIENT_ID: z.string().optional(),
  GRAPH_CLIENT_SECRET: z.string().optional(),
  GRAPH_CAIXA: z.string().optional(),
  /**
   * O dia a partir do qual a caixa é lida (`AAAA-MM-DD`), obrigatório com
   * `graph` (`AT-35`). É o dia da implantação: o que chegou antes foi tratado
   * pela planilha, e lê-lo de novo criaria trabalho em dobro — pago.
   */
  GRAPH_LER_DESDE: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'GRAPH_LER_DESDE precisa ser uma data AAAA-MM-DD')
    // O formato não basta: `2026-02-31` viraria 3 de março em silêncio.
    .refine(
      (valor) => {
        const data = new Date(`${valor}T00:00:00Z`)
        return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === valor
      },
      'GRAPH_LER_DESDE precisa ser uma data que existe',
    )
    .optional()
    .or(z.literal('').transform(() => undefined)),
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
  /**
   * Acesso local SEM SENHA, para conferir telas em desenvolvimento.
   *
   * Existe porque toda tela além de `/entrar` exige login, e quem verifica uma
   * mudança de tela (o agente, inclusive) não digita senha. O dono pediu, em
   * 12/09/2026, um jeito de entrar sem senha para ver o que está sendo feito —
   * sem deixar falha de segurança. Ver `servidor/acesso-local.ts` para as
   * travas; aqui só a mais importante: **ligado em produção, o sistema recusa
   * subir**.
   *
   * Só `"1"` liga. Qualquer valor torto falha alto em vez de ser lido como
   * desligado — um `"true"` escrito à mão não pode passar calado para nenhum
   * dos dois lados. O jeito normal de ligar não é o `.env`: é `npm run
   * dev:local`, que liga só para aquele processo.
   */
  ACESSO_LOCAL_SEM_SENHA: z
    .enum(['', '0', '1'], { message: 'ACESSO_LOCAL_SEM_SENHA aceita só "0" ou "1"' })
    .default('0')
    .transform((valor) => valor === '1'),
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

  // Entrar sem senha em produção não é configuração: é a porta da frente
  // aberta. Recusar subir é a única resposta que não depende de alguém lembrar
  // de desligar a variável antes de publicar.
  //
  // Achado C-12: a trava era "NODE_ENV é production", e o `next start` só
  // preenche NODE_ENV quando ele falta — herdado como `test`, um servidor
  // publicado passava. Agora só DESENVOLVIMENTO libera, e a variável não pode
  // morar num arquivo `.env`: quem liga é o `npm run dev:local`, só para o
  // processo dele.
  if (resultado.data.ACESSO_LOCAL_SEM_SENHA) {
    if (resultado.data.NODE_ENV !== 'development') {
      throw new Error(
        `ACESSO_LOCAL_SEM_SENHA=1 com NODE_ENV=${resultado.data.NODE_ENV}. O acesso sem senha existe só para ` +
          'desenvolvimento local — desligue a variável antes de subir o sistema.',
      )
    }
    const arquivo = acessoLocalEmArquivoEnv(process.cwd())
    if (arquivo !== null) {
      throw new Error(
        `ACESSO_LOCAL_SEM_SENHA=1 está escrito em ${arquivo}. Apague a linha: o acesso sem senha só se liga ` +
          'com npm run dev:local, que vale só para aquele processo.',
      )
    }
  }

  // `NODE_TLS_REJECT_UNAUTHORIZED=0` desliga a verificação de certificado do
  // PROCESSO INTEIRO: o texto do e-mail indo para a IA, o banco, o Graph.
  // Qualquer proxy no caminho abre o TLS e lê tudo, sem erro nenhum — é a
  // degradação calada que o invariante 7 proíbe (pendência 37, revisão de
  // segurança do #144). Proxy corporativo que inspeciona TLS é legítimo, e o
  // caminho dele é `NODE_EXTRA_CA_CERTS` com o certificado da empresa.
  //
  // Mesmo sinal positivo do C-12, acima: só desenvolvimento libera, porque um
  // servidor publicado com `NODE_ENV` herdado como `test` também é produção.
  // Compara com '0' exato porque é só esse valor que o Node trata como
  // "desligado".
  if (process.env['NODE_TLS_REJECT_UNAUTHORIZED'] === '0' && resultado.data.NODE_ENV !== 'development') {
    throw new Error(
      `NODE_TLS_REJECT_UNAUTHORIZED=0 com NODE_ENV=${resultado.data.NODE_ENV} desliga a verificação de TLS de ` +
        'todo o processo, e o texto dos e-mails ficaria legível para quem estiver no caminho. Apague a variável; ' +
        'se a rede da empresa inspeciona TLS, aponte NODE_EXTRA_CA_CERTS para o certificado dela.',
    )
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

  // O SDK da Anthropic junta os cabeçalhos de `ANTHROPIC_CUSTOM_HEADERS` aos
  // do pedido DEPOIS dos de autenticação: a variável troca a chave (o e-mail
  // processado na conta de outra organização), põe de volta um `Authorization`
  // e muda `anthropic-version` e `anthropic-beta`, sem que nada no código diga
  // isso (pendência 29, revisões do #144). Máquina configurada para um gateway
  // de modelo costuma ter a variável, com o segredo do gateway dentro.
  //
  // Só com `IA_ADAPTER=anthropic`: nos outros casos o SDK nem é construído, e
  // a mesma variável pode existir na máquina para outra ferramenta. A mensagem
  // não repete o valor, porque ele costuma carregar segredo.
  if (resultado.data.IA_ADAPTER === 'anthropic' && (process.env['ANTHROPIC_CUSTOM_HEADERS'] ?? '').trim() !== '') {
    throw new Error(
      'ANTHROPIC_CUSTOM_HEADERS está definida, e com IA_ADAPTER="anthropic" ela trocaria a chave e os cabeçalhos ' +
        'que vão com o texto do e-mail. Apague a variável deste processo antes de subir o sistema.',
    )
  }

  // O servidor local não tem credencial na tabela acima, mas tem duas
  // exigências próprias, e as duas falham na partida em vez de na primeira
  // chamada ao modelo.
  if (resultado.data.IA_ADAPTER === 'local') {
    if (!resultado.data.IA_LOCAL_URL) {
      throw new Error(
        'IA_ADAPTER="local" exige IA_LOCAL_URL: o endereço do servidor de modelo compatível com OpenAI ' +
          '(por exemplo http://127.0.0.1:11434/v1).',
      )
    }
    if (!resultado.data.IA_MODELO) {
      throw new Error(
        'IA_ADAPTER="local" exige IA_MODELO: cada servidor local serve o modelo que baixaram nele, ' +
          'e não há padrão que valha para todos.',
      )
    }
    const recusa = motivoDeEnderecoLocalInvalido(resultado.data.IA_LOCAL_URL)
    if (recusa) throw new Error(`IA_LOCAL_URL ${recusa}`)
  }

  if (resultado.data.CLASSIFICADOR_ADAPTER === 'typesafe' && !resultado.data.TYPESAFE_API_KEY?.trim()) {
    throw new Error('CLASSIFICADOR_ADAPTER="typesafe" exige TYPESAFE_API_KEY configurada.')
  }

  // A mesma trava da IA, para o classificador (`A62`, `§ H.4` item 35): o Jev
  // não recebe e-mail de associado enquanto o dono não decidir as condições.
  // A camada de defesa do dado roda sempre, mas nome e endereço passam por
  // ela — por isso a decisão é do dono, e não desta camada.
  if (
    resultado.data.INGESTAO_ADAPTER !== 'mock' &&
    !CLASSIFICADOR_PARA_DADO_REAL[resultado.data.CLASSIFICADOR_ADAPTER]
  ) {
    throw new Error(
      `INGESTAO_ADAPTER="${resultado.data.INGESTAO_ADAPTER}" lê e-mail real, e ` +
        `CLASSIFICADOR_ADAPTER="${resultado.data.CLASSIFICADOR_ADAPTER}" não pode recebê-lo ` +
        '(decisão A62, pendente em DECISOES.md § H.4 item 35). Use CLASSIFICADOR_ADAPTER="nenhum".',
    )
  }

  // Caixa real = e-mail real de associado (achado N-17). A IA simulada
  // aprovaria esse e-mail por regra fixa, e a chave gratuita do Gemini é só
  // para e-mail sintético (`A50`) — seus termos não excluem treino (`A38`).
  // Um fornecedor novo para dado real entra aqui por decisão, não por omissão.
  if (
    resultado.data.INGESTAO_ADAPTER !== 'mock' &&
    !IA_PARA_DADO_REAL[resultado.data.IA_ADAPTER]
  ) {
    throw new Error(
      `INGESTAO_ADAPTER="${resultado.data.INGESTAO_ADAPTER}" lê e-mail real, e IA_ADAPTER="${resultado.data.IA_ADAPTER}" ` +
        'não pode recebê-lo (decisões A38 e A50). Use a IA contratada.',
    )
  }

  // Igual à atual, a troca não aconteceu: quem configurou acha que rotacionou,
  // e o segredo antigo segue assinando tudo. Contida uma na outra, a nova foi
  // derivada da velha ("<velha>-v2"), e quem tiver a velha adivinha a nova —
  // a mesma regra do C-25 entre sessão e anexos. A contenção pega também a
  // cópia com um espaço sobrando, que a igualdade deixava passar (revisões do
  // #146). Falha alto em qualquer ambiente.
  const anterior = resultado.data.SESSAO_SECRET_ANTERIOR
  const atual = resultado.data.SESSAO_SECRET
  if (anterior !== undefined && (anterior.includes(atual) || atual.includes(anterior))) {
    throw new Error(
      'SESSAO_SECRET_ANTERIOR igual a SESSAO_SECRET, ou uma contida na outra: a troca da chave de sessão ' +
        'não aconteceu, ou a nova foi derivada da anterior. Gere a nova com o seu próprio crypto.randomUUID().',
    )
  }

  // Segredo escrito no repositório não é segredo (achado N-18): o CI e a suíte
  // usam valores públicos de propósito, e nada impedia que um deles fosse
  // copiado para produção. A mensagem nomeia a variável, nunca o valor.
  //
  // LIMITE CONHECIDO: "produção" aqui é só `NODE_ENV`, o mesmo sinal fraco do
  // achado C-12 (um servidor publicado com `NODE_ENV` herdado diferente passa
  // sem esta trava). Quando o C-12 trouxer um sinal positivo de produção, esta
  // trava deve usá-lo também.
  if (resultado.data.NODE_ENV === 'production') {
    const publicos = SEGREDOS.filter((nome) => {
      const valor = resultado.data[nome]
      return (
        typeof valor === 'string' &&
        (PARECE_VALOR_DE_TESTE.test(valor) || new Set(valor).size < VARIEDADE_MINIMA_DO_SEGREDO)
      )
    })
    if (publicos.length > 0) {
      throw new Error(
        `${publicos.join(', ')} com valor de teste público ou previsível em NODE_ENV=production. ` +
          'Gere um segredo novo para cada variável antes de subir o sistema.',
      )
    }

    // Segredo próprio dos anexos (achado C-25). Sem ele, a chave dos anexos é
    // derivada de `SESSAO_SECRET`: um vazamento entrega de uma vez a sessão de
    // gestor e os documentos, e a resposta normal a ele — trocar o segredo de
    // sessão — torna todo anexo ilegível. Fora de produção o recurso de cair na
    // sessão continua (desenvolvimento e suíte dependem dele); aqui, antes de
    // existir dado real, os dois têm de ser separados de verdade.
    //
    // O QUE ISTO NÃO GARANTE: recusa o reuso idêntico e a concatenação (um
    // contém o outro, como "<sessão>-anexos"), mas nenhuma regra de texto prova
    // que os dois foram gerados independentes. Isso é da implantação: cada um
    // sai do seu próprio `crypto.randomUUID()`, como diz o `.env.example`.
    // E "produção" aqui é só `NODE_ENV` — o mesmo LIMITE CONHECIDO da trava de
    // cima (C-12): sem `NODE_ENV=production`, esta trava não roda.
    if (resultado.data.ANEXOS_SECRET === undefined) {
      throw new Error(
        'ANEXOS_SECRET é obrigatório em NODE_ENV=production: sem ele, a chave dos anexos sai de ' +
          'SESSAO_SECRET, e trocar a sessão depois de um vazamento tornaria os documentos ilegíveis. ' +
          'Gere um segredo próprio para ele antes de subir o sistema.',
      )
    }
    const anexos = resultado.data.ANEXOS_SECRET
    const sessao = resultado.data.SESSAO_SECRET
    if (anexos.includes(sessao) || sessao.includes(anexos)) {
      throw new Error(
        'ANEXOS_SECRET igual a SESSAO_SECRET, ou um contido no outro, em NODE_ENV=production: ' +
          'derivado de um, o outro cai junto num vazamento. Gere cada um com o seu próprio ' +
          'crypto.randomUUID(), nunca por concatenação.',
      )
    }

    // A chave anterior também abre sessão, então vale para ela a mesma
    // separação da de cima: a chave dos anexos não pode abrir sessão durante
    // a troca. Fora de produção a igualdade é o caminho documentado (fixar
    // `ANEXOS_SECRET` com o valor antigo antes de trocar a sessão).
    //
    // A saída que a mensagem dá é apagar a anterior, nunca trocar a dos
    // anexos: trocar a dos anexos torna ilegível todo documento gravado
    // (`AT-13`); apagar a anterior custa uma reentrada por pessoa.
    if (anterior !== undefined && (anexos.includes(anterior) || anterior.includes(anexos))) {
      throw new Error(
        'SESSAO_SECRET_ANTERIOR igual a ANEXOS_SECRET, ou um contido no outro, em NODE_ENV=production: ' +
          'durante a troca, a chave dos anexos abriria sessão. Apague SESSAO_SECRET_ANTERIOR ' +
          '(cada pessoa entra de novo uma vez); não troque ANEXOS_SECRET, que tornaria os anexos ilegíveis.',
      )
    }

    // O mesmo com a da busca, que foi feita para nunca trocar (`A23(b)`) e
    // por isso vive muito mais que uma chave de sessão (revisão de segurança
    // do #146). A saída é a mesma: apagar a anterior, nunca trocar a da busca.
    const busca = resultado.data.BUSCA_SECRET
    if (anterior !== undefined && (busca.includes(anterior) || anterior.includes(busca))) {
      throw new Error(
        'SESSAO_SECRET_ANTERIOR igual a BUSCA_SECRET, ou uma contida na outra, em NODE_ENV=production: ' +
          'durante a troca, a chave da busca abriria sessão. Apague SESSAO_SECRET_ANTERIOR ' +
          '(cada pessoa entra de novo uma vez); não troque BUSCA_SECRET, que quebraria a busca por CPF.',
      )
    }
  }

  cache = resultado.data
  return cache
}

/**
 * Quais IAs podem receber e-mail real de associado.
 *
 * Lista de PERMISSÃO amarrada ao enum de `IA_ADAPTER`: um fornecedor novo — o
 * modelo local de `A51`, por exemplo — não compila sem uma linha aqui, e essa
 * linha é a decisão de que ele foi medido e pode receber dado real (revisão do
 * PR que corrigiu o N-17).
 */
const IA_PARA_DADO_REAL = {
  mock: false,
  anthropic: true,
  gemini: false,
  // Nasce `false` por decisão do dono (`A56 (e)`): o modelo local só recebe
  // e-mail de associado depois de medido pelo gabarito (`npm run ia:avaliar`)
  // e de ele decidir. Trocar esta linha é a decisão, não um efeito colateral
  // de configurar o endereço.
  local: false,
} as const satisfies Record<z.infer<typeof AmbienteSchema>['IA_ADAPTER'], boolean>

/**
 * Quais classificadores podem receber e-mail real de associado (`A62`).
 *
 * Mesmo desenho de `IA_PARA_DADO_REAL`: lista de PERMISSÃO amarrada ao enum,
 * e trocar uma linha é a decisão.
 *
 * - `nenhum`: nada sai da casa.
 * - `mock`: não sai da casa, mas daria opinião inventada sobre e-mail real, e
 *   a discordância mandaria item de verdade à revisão por causa de um dublê.
 * - `typesafe`: nasce `false`. Sem acordo empresarial, e nome e endereço
 *   atravessam a camada de defesa. Quem troca esta linha é o dono, com a
 *   resposta do `§ H.4` item 35 registrada.
 */
const CLASSIFICADOR_PARA_DADO_REAL = {
  nenhum: true,
  mock: false,
  typesafe: false,
} as const satisfies Record<z.infer<typeof AmbienteSchema>['CLASSIFICADOR_ADAPTER'], boolean>

/**
 * Por que o endereço do modelo local não pode ser público (`A56 (f)`).
 *
 * Um `IA_LOCAL_URL` apontando para a internet manda o corpo do e-mail — nome,
 * CPF, CRM de associado — a uma empresa qualquer, **com o nome de "local"**, e
 * passa por cima da lista de permissão `IA_PARA_DADO_REAL`, que é por
 * fornecedor. Fornecedor de fora entra como `ia-<nome>.ts` com decisão
 * escrita; não pela porta dos fundos de um endereço.
 *
 * O laço é permitir a rede interna da associação (o servidor pode não ser a
 * mesma máquina) e recusar o resto. Nome que não seja `localhost` é recusado
 * porque resolvê-lo aqui seria consulta de DNS na partida — e o mesmo nome
 * pode resolver para outra coisa depois.
 */
function motivoDeEnderecoLocalInvalido(valor: string): string | null {
  let url: URL
  try {
    url = new URL(valor)
  } catch {
    return `não é um endereço válido: "${valor}".`
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `precisa ser http ou https (recebido "${url.protocol}").`
  }
  // Credencial no endereço viaja em TODO pedido e aparece no log de acesso do
  // servidor e de qualquer proxy no meio. A mensagem não repete o valor.
  if (url.username || url.password) {
    return 'não pode levar usuário e senha embutidos; use IA_LOCAL_CHAVE para o token do servidor.'
  }

  // `[::1]` chega com os colchetes em `hostname`.
  const hospedeiro = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (hospedeiro === 'localhost' || hospedeiro === '::1' || /^127\./.test(hospedeiro)) return null
  if (/^10\./.test(hospedeiro)) return null
  if (/^192\.168\./.test(hospedeiro)) return null
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hospedeiro)) return null
  // `fc00::/7` — endereço local único do IPv6.
  //
  // OS QUATRO DÍGITOS SÃO A REGRA, não zero à esquerda esquecido. A faixa é
  // `fc00::` a `fdff::`, e todo valor dela tem quatro dígitos no primeiro
  // hexteto. `fd1:2:3::4` é `0x0fd1` — endereço público, não interno. Aceitar
  // 1 a 3 dígitos abriria a trava justamente para o que ela existe para
  // recusar (revisão do PR #74 sugeriu afrouxar; medido, seria um buraco).
  if (/^f[cd][0-9a-f]{2}:/.test(hospedeiro)) return null

  return (
    `aponta para fora da máquina e da rede interna ("${hospedeiro}"). O modelo local não fica em endereço ` +
    'público (A56 (f)); um fornecedor de fora entra como adapter próprio, com decisão registrada.'
  )
}

/**
 * Menos caracteres distintos que isto é segredo previsível (`aaaa…`,
 * `1234…`). Um UUID tem pelo menos 11 (hexadecimal e o hífen), na prática.
 */
const VARIEDADE_MINIMA_DO_SEGREDO = 8

const SEGREDOS = ['SESSAO_SECRET', 'SESSAO_SECRET_ANTERIOR', 'BUSCA_SECRET', 'ANEXOS_SECRET'] as const

/**
 * A forma dos valores públicos do repositório: `…-nao-e-segredo-…` no CI e no
 * vitest, `segredo-de-teste-…` nos testes. Quem criar outro valor de teste
 * deve seguir uma das duas formas, para esta trava continuar valendo.
 */
const PARECE_VALOR_DE_TESTE = /nao-e-segredo|segredo-de-teste/

/** Os arquivos que o Next e `process.loadEnvFile` leem. O `.env.example` não entra. */
const ARQUIVOS_ENV = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
  '.env.production',
  '.env.production.local',
] as const

// `export` opcional: `process.loadEnvFile` aceita essa forma, e a trava precisa
// enxergar o mesmo que o carregador (revisão do PR).
const LIGADO_EM_ARQUIVO = /^[ \t]*(?:export[ \t]+)?ACESSO_LOCAL_SEM_SENHA[ \t]*=[ \t]*["']?1["']?[ \t]*$/m

/**
 * O primeiro arquivo `.env*` da pasta que liga o acesso sem senha, ou `null`.
 * Linha comentada ou com outro valor não conta.
 */
export function acessoLocalEmArquivoEnv(pasta: string): string | null {
  for (const arquivo of ARQUIVOS_ENV) {
    let conteudo: string
    try {
      conteudo = readFileSync(join(pasta, arquivo), 'utf8')
    } catch {
      continue // arquivo que não existe não liga nada
    }
    if (LIGADO_EM_ARQUIVO.test(conteudo)) return arquivo
  }
  return null
}

/** Só para testes: força releitura do ambiente. */
export function limparCacheDeAmbiente(): void {
  cache = undefined
  carregado = false
}
