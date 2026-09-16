import {
  EmailBrutoSchema,
  TAMANHO_MAXIMO_ANEXO_BYTES,
  type EmailBruto,
} from '../core/esquemas'
import { ErroOperacional } from '../core/erros'
import type { IngestaoPort } from '../ports/ingestao'
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
 * Quantas mensagens uma sincronização traz, no máximo.
 *
 * Teto, não paginação: a primeira sincronização de uma caixa com anos de
 * histórico traria dezenas de milhares de mensagens, e **cada uma custa uma
 * chamada paga ao modelo**. O limite falha alto quando é atingido, em vez de
 * cortar calado — quem estiver implantando precisa decidir de que data começar,
 * e não descobrir depois que metade do histórico virou item.
 */
const TETO_POR_SINCRONIZACAO = 200

export class IngestaoGraph implements IngestaoPort {
  readonly nome = 'graph'

  constructor(private readonly cliente: ClienteDoGraph) {}

  async buscarNovos(desde?: Date): Promise<EmailBruto[]> {
    const mensagens = await this.cliente.listarMensagens(desde)

    if (mensagens.length > TETO_POR_SINCRONIZACAO) {
      throw new IngestaoIndisponivelError(
        `a caixa devolveu ${mensagens.length} mensagens, acima do teto de ${TETO_POR_SINCRONIZACAO} ` +
          `por sincronização. Escolha a data a partir da qual o sistema deve ler, em vez de ` +
          `processar o histórico inteiro — cada mensagem custa uma chamada ao modelo.`,
      )
    }

    const emails: EmailBruto[] = []

    for (const mensagem of mensagens) {
      const anexos = mensagem.hasAttachments ? await this.anexosDe(mensagem) : []

      emails.push(
        EmailBrutoSchema.parse({
          // `internetMessageId` é o identificador que atravessa servidores e
          // sobrevive a uma mensagem movida de pasta; `id` é do Graph e muda
          // nesse caso. Usar o `id` faria o mesmo e-mail voltar a ser trabalho
          // novo só porque alguém o arrastou na caixa.
          messageId: mensagem.internetMessageId ?? mensagem.id,
          remetente: mensagem.from?.emailAddress?.address ?? 'desconhecido@invalido',
          assunto: mensagem.subject ?? '',
          corpo: mensagem.body?.content ?? '',
          anexos,
          recebidoEm: mensagem.receivedDateTime,
          origem: 'graph',
        } satisfies Record<string, unknown>),
      )
    }

    return emails
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
        nome: anexo.name ?? 'anexo-sem-nome',
        tipoDeclarado: anexo.contentType ?? 'application/octet-stream',
        tamanho: anexo.size,
        hash: null,
        ...(cabe ? { conteudo: Uint8Array.from(Buffer.from(anexo.contentBytes!, 'base64')) } : {}),
      }
    })
  }
}

// ─── A conversa com a API, que é a única parte específica da Microsoft ───────

const ESCOPO = 'https://graph.microsoft.com/.default'
const RAIZ = 'https://graph.microsoft.com/v1.0'
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

      // Segue a paginação até o fim. O teto de `TETO_POR_SINCRONIZACAO` é
      // conferido por quem chama, com erro explícito — aqui, parar calado na
      // primeira página seria perder trabalho sem sinal nenhum.
      while (true) {
        const pagina = await pedir(caminho)
        mensagens.push(...((pagina['value'] as MensagemDoGraph[] | undefined) ?? []))

        const proxima = pagina['@odata.nextLink']
        if (typeof proxima !== 'string') return mensagens
        if (mensagens.length > TETO_POR_SINCRONIZACAO) return mensagens

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
