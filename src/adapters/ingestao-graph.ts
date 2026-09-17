import {
  EmailBrutoSchema,
  TAMANHO_MAXIMO_ANEXO_BYTES,
  TAMANHO_MAXIMO_ASSUNTO,
  TAMANHO_MAXIMO_NOME_ANEXO,
  TAMANHO_MAXIMO_TIPO_DECLARADO,
  type EmailBruto,
} from '../core/esquemas'
import { ErroOperacional } from '../core/erros'
import { resumoDeValidacao } from '../core/seguranca/resumo-de-validacao'
import type { IngestaoPort, PedidoDeBusca } from '../ports/ingestao'
import { ambiente } from '../servidor/ambiente'
import { registrarLog } from '../servidor/observabilidade'

/**
 * Ingestão pela caixa do Microsoft 365 (`A47`).
 *
 * ═══ SÓ LEITURA, E ISSO É INVARIANTE, NÃO CONFIGURAÇÃO ═══
 *
 * `A5` decidiu que o sistema **nunca** escreve na caixa de ninguém: não marca
 * como lida, não move para pasta, não responde, não apaga. Este adapter faz
 * exatamente uma coisa — pedir mensagens e anexos. Não existe aqui nenhum
 * caminho de escrita, e a permissão pedida ao TI deve ser de leitura apenas
 * (`Mail.Read`), porque uma credencial que pode escrever transforma um defeito
 * de código na caixa de e-mail da secretaria.
 *
 * ═══ A FRONTEIRA DO FORNECEDOR, DE NOVO ═══
 *
 * `ClienteDoGraph` existe pelo mesmo motivo que `ClienteDeModelo` existe nos
 * adapters de IA: separar **como se fala com a API** do que é política deste
 * sistema. Com ela, o formato, a paginação, o corte de anexo e o tratamento de
 * credencial recusada são provados por teste, sem rede e sem credencial — e o
 * que sobra para o dia da implantação é só a conexão.
 *
 * ═══ IDEMPOTÊNCIA NÃO É PROBLEMA DAQUI ═══
 *
 * O adapter pode devolver o mesmo e-mail duas vezes: `Email.messageId` é único
 * no banco e a ingestão usa isso como chave. Por isso este arquivo não guarda
 * estado nenhum sobre o que já foi lido.
 */

/** O que o sistema precisa saber falar com a API — e nada além disso. */
export interface ClienteDoGraph {
  /**
   * Mensagens recebidas a partir de `desde`, da mais antiga para a mais nova.
   *
   * A paginação é responsabilidade da implementação: quem chama recebe a lista
   * inteira ou um erro. Um adapter que devolvesse "a primeira página" em
   * silêncio faria o sistema perder trabalho sem nenhum sinal — exatamente o
   * defeito da planilha que este projeto existe para eliminar.
   */
  listarMensagens(desde: Date | undefined): Promise<MensagemDoGraph[]>
  /** Os anexos de uma mensagem, já com os bytes. */
  listarAnexos(mensagemId: string): Promise<AnexoDoGraph[]>
}

/** O pedaço da resposta do Graph que este sistema usa. */
export interface MensagemDoGraph {
  id: string
  internetMessageId: string | null
  subject: string | null
  receivedDateTime: string
  hasAttachments: boolean
  from: { emailAddress?: { address?: string | null } | null } | null
  body: { content?: string | null } | null
}

export interface AnexoDoGraph {
  name: string | null
  contentType: string | null
  size: number
  /** Base64, como o Graph devolve. Ausente em anexo que não é arquivo. */
  contentBytes: string | null
}

export class IngestaoIndisponivelError extends ErroOperacional {
  readonly codigo = 'INGESTAO_INDISPONIVEL'
  /** Configuração ou credencial, nunca defeito de um e-mail. */
  readonly statusHttp = 503

  constructor(readonly causa: string) {
    super(`Não foi possível ler a caixa de e-mail: ${causa}`)
  }
}

/**
 * Quantas mensagens NOVAS uma sincronização lê, no máximo.
 *
 * Cada uma custa uma chamada paga ao modelo e o download dos anexos. Até o
 * achado C-03 o teto derrubava a leitura inteira — e, como a caixa só cresce
 * (`A5`) e a leitura não tinha janela, derrubava para sempre. Agora ele conta
 * só o que ainda não virou trabalho, lê as mais antigas e deixa o resto para a
 * próxima sincronização, **dizendo quantas ficaram** (`adiados`).
 */
const TETO_POR_SINCRONIZACAO = 200

export interface OpcoesDoGraph {
  /**
   * A data a partir da qual o sistema lê esta caixa (`GRAPH_LER_DESDE`).
   *
   * É a data da implantação, escolhida por quem implanta: o que chegou antes
   * foi tratado pela planilha, e lê-lo de novo criaria trabalho em dobro.
   * Obrigatória na fábrica; opcional aqui só para os testes do formato.
   */
  lerDesde?: Date
}

export class IngestaoGraph implements IngestaoPort {
  readonly nome = 'graph'

  constructor(
    private readonly cliente: ClienteDoGraph,
    private readonly opcoes: OpcoesDoGraph = {},
  ) {}

  async buscarNovos(pedido: PedidoDeBusca = {}): Promise<EmailBruto[]> {
    const mensagens = await this.cliente.listarMensagens(this.desdeEfetivo(pedido.desde))

    const conhecidos = pedido.jaProcessados
      ? await pedido.jaProcessados(mensagens.map(chaveDaMensagem))
      : new Set<string>()
    const novas = mensagens.filter((mensagem) => !conhecidos.has(chaveDaMensagem(mensagem)))

    // A listagem vem da mais antiga para a mais nova: as que ficam para depois
    // são as mais recentes, e a ordem de chegada se mantém.
    const agora = novas.slice(0, TETO_POR_SINCRONIZACAO)
    const adiados = novas.length - agora.length
    if (adiados > 0) {
      registrarLog('aviso', 'mais mensagens novas que o teto: o resto fica para a próxima leitura', {
        adapter: this.nome,
        adiados,
        teto: TETO_POR_SINCRONIZACAO,
      })
      pedido.avisar?.({ tipo: 'adiados', quantidade: adiados })
    }

    const emails: EmailBruto[] = []

    for (const mensagem of agora) {
      // Anexo que não baixa (mensagem movida ou apagada entre a lista e o
      // pedido, rede) recusa ESTA mensagem, nunca o lote — a mesma classe do
      // C-02, na busca de anexo (revisão do PR). Fora da trilha vai só o nome
      // do erro: a resposta da API não é conteúdo nosso para guardar.
      let anexos: EmailBruto['anexos']
      try {
        anexos = mensagem.hasAttachments ? await this.anexosDe(mensagem) : []
      } catch (erro) {
        this.recusar(pedido, mensagem, `anexos indisponíveis (${erro instanceof Error ? erro.name : 'erro'})`)
        continue
      }

      // `safeParse` POR MENSAGEM (achado C-02): antes, um `parse` aqui — fora
      // do `try` por e-mail da ingestão — fazia uma única mensagem de fora
      // derrubar a leitura inteira. O que não cabe no esquema vira aviso com o
      // identificador, e as outras seguem.
      const lido = EmailBrutoSchema.safeParse({
        messageId: chaveDaMensagem(mensagem),
        // `||`, não `??`: remetente vazio também não é endereço.
        remetente: mensagem.from?.emailAddress?.address || 'desconhecido@invalido',
        // Assunto é metadado: cortar não muda o pedido, e recusar o e-mail por
        // um assunto longo faria o pedido sumir por um detalhe.
        assunto: (mensagem.subject ?? '').slice(0, TAMANHO_MAXIMO_ASSUNTO),
        // O corpo NÃO é cortado aqui. Um corpo acima do teto é recusado pelo
        // nome e uma pessoa o trata na caixa — cortar mandaria ao modelo, e à
        // retenção, um pedido pela metade sem ninguém saber.
        corpo: mensagem.body?.content ?? '',
        anexos,
        recebidoEm: mensagem.receivedDateTime,
        origem: 'graph',
      } satisfies Record<string, unknown>)

      if (lido.success) {
        emails.push(lido.data)
        continue
      }

      this.recusar(pedido, mensagem, resumoDeValidacao(lido.error))
    }

    return emails
  }

  private recusar(pedido: PedidoDeBusca, mensagem: MensagemDoGraph, motivo: string): void {
    registrarLog('erro', 'mensagem da caixa não pôde ser lida: recusada, as outras seguem', {
      adapter: this.nome,
      messageId: chaveDaMensagem(mensagem),
      motivo,
    })
    pedido.avisar?.({
      tipo: 'recusado',
      messageId: chaveDaMensagem(mensagem),
      recebidoEm: mensagem.receivedDateTime || null,
      motivo,
    })
  }

  /** A mais recente entre a janela pedida e a data de início da implantação. */
  private desdeEfetivo(pedido: Date | undefined): Date | undefined {
    const { lerDesde } = this.opcoes
    if (!pedido) return lerDesde
    if (!lerDesde) return pedido
    return pedido > lerDesde ? pedido : lerDesde
  }

  /**
   * Metadado sempre, com o tamanho REAL; bytes só quando cabem.
   *
   * Anexo acima do teto entra **sem** `conteudo` e com o tamanho verdadeiro —
   * baixar 30 MB para descartar seria desperdício, e mentir sobre o tamanho
   * esconderia de `validarAnexo` justamente o que ele precisa para decidir.
   *
   * O que acontece com ele depois: a ingestão recusa o anexo com motivo
   * legível, conta a recusa e manda o item para revisão humana. O e-mail
   * continua virando trabalho, e **uma pessoa fica sabendo** que veio um
   * arquivo que o sistema não guardou — em vez de o pedido sumir calado, que
   * era o efeito do teto antigo no esquema (ver `AnexoSchema`).
   */
  private async anexosDe(mensagem: MensagemDoGraph): Promise<EmailBruto['anexos']> {
    const doGraph = await this.cliente.listarAnexos(mensagem.id)

    return doGraph.map((anexo) => {
      const cabe = anexo.contentBytes !== null && anexo.size <= TAMANHO_MAXIMO_ANEXO_BYTES

      if (!cabe && anexo.contentBytes !== null) {
        registrarLog('aviso', 'anexo grande demais: metadado guardado, bytes não', {
          adapter: this.nome,
          tamanho: anexo.size,
          teto: TAMANHO_MAXIMO_ANEXO_BYTES,
        })
      }

      return {
        // O nome vem do remetente e é normalizado depois, na ingestão — aqui
        // ele é dado, não caminho.
        nome: nomeQueCabe(anexo.name || 'anexo-sem-nome'),
        tipoDeclarado: (anexo.contentType || 'application/octet-stream').slice(0, TAMANHO_MAXIMO_TIPO_DECLARADO),
        tamanho: anexo.size,
        hash: null,
        ...(cabe ? { conteudo: Uint8Array.from(Buffer.from(anexo.contentBytes!, 'base64')) } : {}),
      }
    })
  }
}

/**
 * `internetMessageId` é o identificador que atravessa servidores e sobrevive a
 * uma mensagem movida de pasta; `id` é do Graph e muda nesse caso. Usar o `id`
 * faria o mesmo e-mail voltar a ser trabalho novo só porque alguém o arrastou
 * na caixa.
 */
function chaveDaMensagem(mensagem: MensagemDoGraph): string {
  return mensagem.internetMessageId ?? mensagem.id
}

/**
 * Nome de anexo longo demais é cortado no MEIO, guardando a extensão: é ela que
 * a ingestão usa, com a assinatura do arquivo, para decidir se aceita.
 */
function nomeQueCabe(nome: string): string {
  if (nome.length <= TAMANHO_MAXIMO_NOME_ANEXO) return nome
  const ponto = nome.lastIndexOf('.')
  const extensao = ponto > 0 && nome.length - ponto <= 16 ? nome.slice(ponto) : ''
  return nome.slice(0, TAMANHO_MAXIMO_NOME_ANEXO - extensao.length) + extensao
}

// ─── A conversa com a API, que é a única parte específica da Microsoft ───────

const ESCOPO = 'https://graph.microsoft.com/.default'
const RAIZ = 'https://graph.microsoft.com/v1.0'
/**
 * Quantas mensagens a listagem de uma janela aceita, no máximo.
 *
 * Não é o teto de trabalho (esse é `TETO_POR_SINCRONIZACAO`, sobre as novas):
 * é a trava contra uma janela absurda — data de início errada, caixa
 * inundada — que encheria a memória com corpos de e-mail. Falha alta.
 */
const LIMITE_DA_LISTAGEM = 5_000

/** Tempo limite por chamada. Uma caixa que não responde não pode pendurar a ingestão. */
const TEMPO_LIMITE_MS = 60_000

interface ConfiguracaoDoGraph {
  tenantId: string
  clientId: string
  clientSecret: string
  /** A caixa que o sistema lê. Uma só, e é a da secretaria. */
  caixa: string
}

function configuracao(): ConfiguracaoDoGraph {
  const env = ambiente()

  // Falha alta e nominal, como a chave de IA: descobrir credencial faltando na
  // primeira sincronização, em produção, é tarde demais.
  const faltando = (['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET', 'GRAPH_CAIXA'] as const).filter(
    (nome) => !env[nome],
  )

  if (faltando.length > 0) {
    throw new IngestaoIndisponivelError(
      `INGESTAO_ADAPTER="graph" exige ${faltando.join(', ')} configurada(s). ` +
        `Elas vêm do registro de aplicativo no Microsoft 365 da associação, com permissão de ` +
        `LEITURA apenas da caixa da secretaria.`,
    )
  }

  return {
    tenantId: env.GRAPH_TENANT_ID!,
    clientId: env.GRAPH_CLIENT_ID!,
    clientSecret: env.GRAPH_CLIENT_SECRET!,
    caixa: env.GRAPH_CAIXA!,
  }
}

/**
 * Token de aplicativo, com cache até pouco antes de expirar.
 *
 * Sem o cache, uma sincronização de 40 e-mails pediria 40 tokens. A margem de
 * 60 segundos existe porque o relógio desta máquina e o da Microsoft não são o
 * mesmo: um token que expira "agora" pode já ter expirado lá.
 */
let tokenEmCache: { valor: string; expiraEm: number } | undefined

async function token(config: ConfiguracaoDoGraph): Promise<string> {
  const agora = Date.now()
  if (tokenEmCache && tokenEmCache.expiraEm > agora) return tokenEmCache.valor

  const resposta = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: ESCOPO,
        grant_type: 'client_credentials',
      }),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    },
  )

  if (!resposta.ok) {
    // O corpo do erro da Microsoft diz QUAL é o problema (segredo expirado,
    // tenant errado, permissão não concedida), e quem sincroniza é operador ou
    // gestor — é exatamente essa pessoa que precisa ler isso para saber a quem
    // recorrer. Mesma escolha de `InterpretacaoIndisponivelError`.
    throw new IngestaoIndisponivelError(
      `a Microsoft recusou a credencial (${resposta.status}): ${(await resposta.text()).slice(0, 300)}`,
    )
  }

  const corpo = (await resposta.json()) as { access_token?: string; expires_in?: number }
  if (!corpo.access_token) {
    throw new IngestaoIndisponivelError('a Microsoft respondeu sem token de acesso.')
  }

  tokenEmCache = {
    valor: corpo.access_token,
    expiraEm: agora + Math.max((corpo.expires_in ?? 3600) - 60, 30) * 1000,
  }

  return tokenEmCache.valor
}

/** Só para teste: derruba o token guardado. */
export function limparTokenDoGraph(): void {
  tokenEmCache = undefined
}

export function clienteDoGraph(): ClienteDoGraph {
  const config = configuracao()

  const pedir = async (caminho: string): Promise<Record<string, unknown>> => {
    const resposta = await fetch(`${RAIZ}${caminho}`, {
      headers: {
        authorization: `Bearer ${await token(config)}`,
        // Pede o corpo em TEXTO. Sem isto, a Microsoft devolve HTML, e o que
        // chegaria ao modelo seria marcação — mais tokens pagos para dizer a
        // mesma coisa, e mais superfície para conteúdo escondido em atributo.
        prefer: 'outlook.body-content-type="text"',
      },
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    })

    if (!resposta.ok) {
      throw new IngestaoIndisponivelError(
        `a caixa respondeu ${resposta.status}: ${(await resposta.text()).slice(0, 300)}`,
      )
    }

    return (await resposta.json()) as Record<string, unknown>
  }

  return {
    async listarMensagens(desde) {
      const filtro = desde ? `&$filter=receivedDateTime ge ${desde.toISOString()}` : ''
      const campos = 'id,internetMessageId,subject,receivedDateTime,hasAttachments,from,body'

      // Só a caixa de entrada. `/users/{caixa}/messages` devolve todas as
      // pastas, e a resposta da própria secretaria (Itens Enviados), o rascunho
      // e a lixeira voltariam como pedido novo, cada um virando tarefa. Se o TI
      // disser que regras do Outlook movem pedidos para subpastas, elas entram
      // aqui por nome, uma a uma — nunca a caixa inteira.
      let caminho =
        `/users/${encodeURIComponent(config.caixa)}/mailFolders/inbox/messages` +
        `?$select=${campos}&$orderby=receivedDateTime asc&$top=50${filtro}`

      const mensagens: MensagemDoGraph[] = []

      // Segue a paginação ATÉ O FIM da janela. Parava ao passar de 200, quando
      // o teto derrubava a leitura; com a janela (`AT-35`), as primeiras
      // páginas são quase todas de mensagens já processadas, e parar ali
      // devolveria só as velhas — as novas sumiriam sem aviso (revisão do PR).
      // O teto de 200 vale para as NOVAS, e é conferido por quem chama.
      while (true) {
        const pagina = await pedir(caminho)
        mensagens.push(...((pagina['value'] as MensagemDoGraph[] | undefined) ?? []))

        const proxima = pagina['@odata.nextLink']
        if (typeof proxima !== 'string') return mensagens
        if (mensagens.length > LIMITE_DA_LISTAGEM) {
          throw new IngestaoIndisponivelError(
            `mais de ${LIMITE_DA_LISTAGEM} mensagens na janela de leitura. Isso não é uma semana normal ` +
              `da secretaria: confira GRAPH_LER_DESDE e a caixa antes de sincronizar de novo.`,
          )
        }

        caminho = proxima.replace(RAIZ, '')
      }
    },

    async listarAnexos(mensagemId) {
      const pagina = await pedir(
        `/users/${encodeURIComponent(config.caixa)}/messages/${encodeURIComponent(mensagemId)}/attachments`,
      )
      return ((pagina['value'] as AnexoDoGraph[] | undefined) ?? []).filter(
        (anexo) => anexo.contentBytes !== undefined,
      )
    },
  }
}
