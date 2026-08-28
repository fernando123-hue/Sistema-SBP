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

/**
 * A qual sistema do ecossistema uma linha de memória pertence.
 *
 * Hoje há um só, e a lista tem um valor só. Ela existe assim mesmo porque a
 * trilha de auditoria é APPEND-ONLY por invariante: corrigir um dado gera
 * linha nova, nunca reescreve a anterior. Uma linha que nasce sem dizer de
 * onde veio só ganharia essa informação por um `UPDATE` na trilha — a única
 * escrita que este sistema promete nunca fazer.
 *
 * É irmão de `SaldoCargaGlobal.escopo` (`H-D6`), e vale o mesmo raciocínio
 * que o dono do negócio já aceitou em 27/08: acrescentar escopo a um razão
 * já acumulado exige recomputar histórico. Aqui nem recomputar resolve.
 *
 * NÃO confunda com `Frente`. `frente` (CADASTRO/TITULOS) separa operações
 * DENTRO deste sistema; `dominio` separa este sistema dos outros. Os dois
 * eixos são ortogonais — uma frente nova não é um domínio novo.
 */
export const DominioSchema = z.enum(['distribuicao'])
export type Dominio = z.infer<typeof DominioSchema>

/** O domínio deste sistema. Todo registro de memória nasce com ele. */
export const DOMINIO_ATUAL: Dominio = 'distribuicao'

/**
 * Vocabulário fechado da trilha de auditoria.
 *
 * Era `string` livre em 21 literais espalhados por 10 arquivos. Um `concluido`
 * digitado `concluído` entrava calado, e a consulta que fosse procurá-lo
 * simplesmente não o encontraria — sem erro, sem aviso, sem nada. Numa trilha
 * append-only isso é permanente: a linha errada não pode ser corrigida, só
 * acompanhada de outra.
 *
 * Fechar o vocabulário é também o que torna esta memória LEGÍVEL POR MÁQUINA.
 * Enquanto a ação for texto livre, ninguém — nem uma camada de orquestração
 * futura, nem uma consulta de hoje — consegue perguntar "o que aconteceu com
 * este item" sem adivinhar como a pergunta foi escrita.
 */
export const AcaoAuditavelSchema = z.enum([
  // Ingestão e interpretação
  'ingerido',
  // Revisão humana
  'revisao_aprovada',
  'revisao_recusada',
  'revisao_aprovada_em_massa',
  'item_criado_por_divisao_de_revisao',
  // Item
  'item_registrado_manualmente',
  'concluido',
  'devolvido',
  'transferencia',
  // Distribuição
  'distribuido',
  'escala_definida',
  // Pessoas e acesso
  'colaborador_criado',
  'habilitacao_definida',
  'acesso_reativado',
  'acesso_desativado',
  'entrada_autorizada',
  'entrada_recusada',
  'senha_trocada',
  'senha_inicial_definida',
  'senha_redefinida_pelo_gestor',
  'conta_destravada',
])
export type AcaoAuditavel = z.infer<typeof AcaoAuditavelSchema>

/**
 * Vocabulário fechado das operações sujeitas a papel.
 *
 * A string já existia em cada chamada de `exigirPapel`, mas servia SÓ para
 * compor a mensagem de erro — não era chave de nada, e `'sincronizar ingestão'`
 * já aparecia duplicada em dois arquivos. Fechada, ela vira a resposta única
 * para "que operações existem e quem pode cada uma", que hoje está espalhada
 * por três lugares mantidos à mão: as chamadas de `exigirPapel`, o mapa de
 * telas em `navegacao.tsx` e a checagem duplicada em `caixa/page.tsx`.
 *
 * É a primeira metade de uma "capacidade" no sentido da diretriz do cérebro:
 * identificação e autorização. Finalidade, escopo e registro de uso ficam
 * para quando existir um agente — hoje seriam burocracia sobre 19 linhas.
 */
export const OperacaoSchema = z.enum([
  'sincronizar ingestão',
  'ver fila de revisão',
  'resolver revisão',
  'aprovar revisões em massa',
  'ver prévia da distribuição',
  'confirmar distribuição',
  'ver auditoria de rodada',
  'definir escala',
  'registrar item manualmente',
  'ver a fila de outra pessoa',
  'transferir item de outra pessoa',
  'devolver item de outra pessoa',
  'listar colaboradores',
  'cadastrar colaborador',
  'definir habilitação',
  'definir senha de outro colaborador',
  'destravar conta',
  'ativar ou desativar colaborador',
  'consultar diagnóstico de origem',
  'consultar memória operacional',
])
export type Operacao = z.infer<typeof OperacaoSchema>

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

/**
 * Teto de itens que um único registro manual pode criar de uma vez.
 *
 * A planilha lança `INADIMP.` como número — em `CAD-MAIO`, `Mov.Extra = 11`
 * digitado direto na linha 35. Exigir onze requisições para registrar esses
 * onze devolveria a operação à planilha na primeira semana, então o registro
 * manual aceita quantidade. O teto existe pelo mesmo motivo dos outros: um
 * `111` digitado no lugar de `11` precisa virar recusa visível, não cento e
 * onze linhas no banco que alguém terá de cancelar uma a uma.
 *
 * Mais alto que `LIMITE_ITENS_POR_DIVISAO_MANUAL` porque aqui a quantidade é
 * UM número, não N títulos digitados um a um — o esforço não cresce com o N,
 * e o volume diário legítimo dessas categorias é maior que o de um
 * desdobramento de e-mail.
 */
export const LIMITE_ITENS_POR_REGISTRO_MANUAL = 50

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

// ─── Registro manual de item ─────────────────────────────────

/**
 * Item que nasce sem e-mail.
 *
 * `INADIMP.` e `ISENTO` estavam semeadas, marcadas como fora do rateio, e
 * proibidas à IA (`CategoriaClassificavelSchema`) — sem que existisse nenhum
 * caminho para criá-las. Duas linhas da planilha não tinham correspondente
 * nenhum aqui dentro, e a rodada de comparação lado a lado nasceria incompleta
 * por construção.
 *
 * `colaboradorId` é NULO para categoria do rateio e OBRIGATÓRIO para categoria
 * fora dele. Não é simetria quebrada por descuido — é a consequência de quem
 * decide o quê. Dentro do rateio, quem escolhe a pessoa é o motor, e aceitar um
 * responsável aqui abriria uma porta lateral para escolher a dedo quem recebe o
 * trabalho, que é exatamente a fragilidade que este sistema substitui. Fora do
 * rateio, o motor nunca vai passar por perto: sem responsável, o item ficaria
 * `aprovado` para sempre, engordando a pendência do painel sem que ninguém
 * pudesse concluí-lo — `concluir` exige atribuição ativa.
 *
 * Não carrega quem registrou: isso vem do `Ator`.
 */
export const RegistroManualSchema = z.object({
  categoriaCodigo: CategoriaCodigoSchema,
  titulo: z.string().trim().min(1).max(300),
  /** Um lançamento pode valer N itens. Cada um continua rastreável e individual. */
  quantidade: z.number().int().min(1).max(LIMITE_ITENS_POR_REGISTRO_MANUAL).default(1),
  colaboradorId: z.string().min(1).nullable().default(null),
  /**
   * Campo em branco vira NULO, não string vazia.
   *
   * `""` no `payload` do item significa "existe uma observação, e ela é vazia"
   * — que não é o mesmo que "não há observação". Quem for ler o histórico
   * depois teria de saber, de cor, que as duas coisas são a mesma aqui.
   */
  observacao: z
    .string()
    .trim()
    .max(1000)
    .nullable()
    .default(null)
    .transform((valor) => (valor === '' ? null : valor)),
})
export type RegistroManual = z.infer<typeof RegistroManualSchema>

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

/**
 * Entrada.
 *
 * `.trim()` vem ANTES de `.min(1)` pelo mesmo motivo do cadastro: medir a
 * string crua deixaria "   " passar e virar "". Aqui o efeito é inofensivo
 * (e-mail vazio não casa com conta nenhuma), mas a ordem certa é a mesma nos
 * dois lugares — e o formato NÃO é exigido de propósito: recusar endereço
 * exótico na hora de entrar tranca alguém que já está cadastrado.
 */
export const CredenciaisSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(320),
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
/**
 * Gestor definindo a senha provisória de alguém.
 *
 * NÃO existe campo de senha aqui, e a ausência é a regra.
 *
 * `credenciais.ts` declara que o sistema nunca pede ao gestor que invente a
 * senha de alguém — pessoa apressada escolhe `Sbp2026!` para a equipe
 * inteira, e a provisória vira permanente conhecida por todos. Enquanto o
 * campo era aceito aqui, essa regra existia só como convenção da tela: o
 * servidor obedecia a qualquer valor que chegasse pela rota. Agora quem
 * sorteia é sempre o servidor, e não há como pedir outra coisa por HTTP.
 */
export const DefinicaoDeSenhaSchema = z.object({
  colaboradorId: z.string().min(1),
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

/**
 * Gestor cadastrando alguém novo.
 *
 * O e-mail é normalizado do MESMO jeito que na entrada (`CredenciaisSchema`):
 * minúsculas e sem espaço nas pontas. Cadastrar "Ana@Exemplo.test" e depois
 * tentar entrar com "ana@exemplo.test" precisa funcionar — normalizar só de um
 * lado cria uma conta que existe e não abre.
 *
 * `categorias` pode vir vazio, e isso é legítimo: gestor não recebe rateio.
 * Mas quem trabalha na fila e nasce sem categoria fica INVISÍVEL para a
 * distribuição, então a tela mostra esse estado em destaque em vez de deixar
 * a pessoa sumir em silêncio.
 *
 * ORDEM DA CADEIA IMPORTA. `.min(1).trim()` mede a string CRUA e só então
 * apara: "   " tem comprimento 3, passa na validação e vira "". Nascia daí
 * uma pessoa sem nome, ou — pior — com e-mail vazio, numa conta que existe e
 * nunca abre, porque a entrada exige e-mail com ao menos um caractere.
 * Aparar primeiro é o que faz a medida valer sobre o que será gravado.
 *
 * O formato do e-mail é exigido AQUI e não só na tela: o `type="email"` de um
 * campo fora de `<form>` não valida nada. E o estrago de um e-mail torto não
 * é estético — "ana.silva" sem domínio cria uma conta que a pessoa nunca
 * encontra, o gestor cadastra de novo com o endereço certo, e passam a
 * existir duas pessoas que são a mesma, com o histórico de carga partido
 * entre elas.
 */
export const CadastroDeColaboradorSchema = z.object({
  nome: z.string().trim().min(1).max(255),
  email: z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(320)),
  papel: PapelSchema,
  categorias: z.array(CategoriaCodigoSchema).max(20).default([]),
})

/**
 * Gestor definindo o que alguém pode receber.
 *
 * A lista é o estado FINAL desejado, não um delta: o que não estiver nela é
 * desligado. Mandar delta faria a tela precisar saber o estado anterior para
 * montar o pedido, e duas telas abertas ao mesmo tempo produziriam resultados
 * diferentes dependendo da ordem de envio.
 */
export const HabilitacaoEntradaSchema = z.object({
  colaboradorId: z.string().min(1),
  categorias: z.array(CategoriaCodigoSchema).max(20),
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

/**
 * Forma do `Revisao.sugestaoIa` — o que a IA propôs, congelado.
 *
 * Mais frouxo que `ItemExtraidoSchema` de propósito: linhas antigas foram
 * gravadas por versões anteriores do pipeline, e a medida de acerto precisa
 * ler o histórico como ele é, não como gostaríamos que fosse. O que interessa
 * aqui é só o que se compara com a decisão humana.
 */
export const SugestaoIaGravadaSchema = z.object({
  categoriaCodigo: z.string().min(1).max(60),
  titulo: z.string().max(300).default(""),
  confianca: z.number().min(0).max(1).default(0),
  campos: z.record(z.string().max(60), z.string().max(2000)).default({}),
})

/**
 * Forma do `Revisao.valorFinal` — o que o humano decidiu.
 *
 * Duas formas, porque há dois caminhos de resolução. A revisão item a item
 * grava categoria, título e campos; a aprovação em massa grava só `aprovado`
 * mais a marca de origem. Os campos anuláveis distinguem "o humano manteve o
 * que a IA disse" de "o humano nem foi consultado sobre isso" — colapsar os
 * dois faria toda aprovação rotineira contar como correção.
 */
export const ValorFinalDaRevisaoSchema = z.object({
  categoriaCodigo: z.string().min(1).max(60).nullish(),
  titulo: z.string().max(300).nullish(),
  campos: z.record(z.string().max(60), z.string().max(2000)).nullish(),
  aprovado: z.boolean(),
  itensExtras: z.number().int().min(0).default(0),
  origem: z.string().max(60).nullish(),
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
