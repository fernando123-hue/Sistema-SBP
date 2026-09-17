import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TAMANHO_MAXIMO_ANEXO_BYTES, TAMANHO_MAXIMO_CORPO } from '../core/esquemas'
import type { AvisoDaBusca } from '../ports/ingestao'
import { limparCacheDeAmbiente } from '../servidor/ambiente'
import { criarIngestaoPort } from './fabrica'
import {
  clienteDoGraph,
  IngestaoGraph,
  limparTokenDoGraph,
  type AnexoDoGraph,
  type ClienteDoGraph,
  type MensagemDoGraph,
} from './ingestao-graph'

/**
 * O adapter da caixa do Microsoft 365 (`A47`), sem rede e sem credencial.
 *
 * O que se prova aqui é tudo o que NÃO depende de existir uma conta: o formato
 * que chega ao sistema, qual identificador vira chave de idempotência, o corte
 * de anexo grande e o teto de mensagens por sincronização. O que só se prova
 * com credencial é a conexão — e é por isso que a fronteira `ClienteDoGraph`
 * existe: sem ela, nada disto seria testável antes do dia da implantação.
 */

function mensagem(parcial: Partial<MensagemDoGraph> = {}): MensagemDoGraph {
  return {
    id: 'AAMkAGI2_id_do_graph',
    internetMessageId: '<abc123@exemplo.test>',
    subject: 'Atualização cadastral',
    receivedDateTime: '2026-09-16T12:30:00Z',
    hasAttachments: false,
    from: { emailAddress: { address: 'associado.sintetico@exemplo.test' } },
    body: { content: 'Segue minha ficha para atualização.' },
    ...parcial,
  }
}

function clienteFalso(
  mensagens: MensagemDoGraph[],
  anexos: AnexoDoGraph[] = [],
): ClienteDoGraph & { anexosPedidos: string[] } {
  const anexosPedidos: string[] = []
  return {
    anexosPedidos,
    listarMensagens: async () => mensagens,
    listarAnexos: async (id) => {
      anexosPedidos.push(id)
      return anexos
    },
  }
}

describe('a caixa do Microsoft 365 vira e-mail do sistema', () => {
  it('traduz o que a operação precisa, e marca a origem', async () => {
    const [email] = await new IngestaoGraph(clienteFalso([mensagem()])).buscarNovos()

    expect(email!.remetente).toBe('associado.sintetico@exemplo.test')
    expect(email!.assunto).toBe('Atualização cadastral')
    expect(email!.corpo).toContain('ficha para atualização')
    expect(email!.recebidoEm.toISOString()).toBe('2026-09-16T12:30:00.000Z')
    expect(email!.origem).toBe('graph')
  })

  it('a chave de idempotência é o identificador que sobrevive a mudar de pasta', async () => {
    // `internetMessageId` atravessa servidores; o `id` do Graph muda quando a
    // mensagem é movida. Usar o `id` faria o mesmo e-mail virar trabalho novo
    // só porque alguém o arrastou na caixa.
    const [email] = await new IngestaoGraph(clienteFalso([mensagem()])).buscarNovos()
    expect(email!.messageId).toBe('<abc123@exemplo.test>')
  })

  it('sem `internetMessageId`, usa o identificador do Graph em vez de falhar', async () => {
    const [email] = await new IngestaoGraph(
      clienteFalso([mensagem({ internetMessageId: null })]),
    ).buscarNovos()

    expect(email!.messageId).toBe('AAMkAGI2_id_do_graph')
  })

  it('mensagem sem anexo não pede anexo nenhum', async () => {
    const cliente = clienteFalso([mensagem({ hasAttachments: false })])
    await new IngestaoGraph(cliente).buscarNovos()

    expect(cliente.anexosPedidos).toEqual([])
  })

  it('anexo vem com os bytes decodificados', async () => {
    const conteudo = '%PDF-1.4 sintetico'
    const cliente = clienteFalso(
      [mensagem({ hasAttachments: true })],
      [
        {
          name: 'ficha.pdf',
          contentType: 'application/pdf',
          size: conteudo.length,
          contentBytes: Buffer.from(conteudo).toString('base64'),
        },
      ],
    )

    const [email] = await new IngestaoGraph(cliente).buscarNovos()
    const anexo = email!.anexos[0]!

    expect(anexo.nome).toBe('ficha.pdf')
    expect(anexo.tipoDeclarado).toBe('application/pdf')
    expect(new TextDecoder().decode(anexo.conteudo!)).toBe(conteudo)
  })

  it('anexo grande demais entra SEM bytes, e o e-mail continua de pé', async () => {
    // O sistema já sabe tratar anexo sem bytes: guarda o metadado e registra
    // que o arquivo não foi armazenado. Deixar o tamanho derrubar o `parse`
    // faria o pedido de um associado sumir por causa de um anexo.
    const cliente = clienteFalso(
      [mensagem({ hasAttachments: true })],
      [
        {
          name: 'exame.pdf',
          contentType: 'application/pdf',
          size: TAMANHO_MAXIMO_ANEXO_BYTES + 1,
          contentBytes: Buffer.from('bytes que nao cabem').toString('base64'),
        },
      ],
    )

    const [email] = await new IngestaoGraph(cliente).buscarNovos()
    const anexo = email!.anexos[0]!

    expect(anexo.nome).toBe('exame.pdf')
    expect(anexo.conteudo).toBeUndefined()
  })
})

describe('a conversa com a API lê só a caixa de entrada', () => {
  // `/users/{caixa}/messages` devolve TODAS as pastas: a resposta que a
  // secretaria mandou (Itens Enviados), o rascunho e a lixeira voltariam como
  // pedido novo, e cada um viraria tarefa com responsável. Só a caixa de
  // entrada é pedido de associado.
  const pedidos: string[] = []

  beforeEach(() => {
    pedidos.length = 0
    vi.stubEnv('GRAPH_TENANT_ID', 'tenant-sintetico')
    vi.stubEnv('GRAPH_CLIENT_ID', 'cliente-sintetico')
    vi.stubEnv('GRAPH_CLIENT_SECRET', 'segredo-sintetico')
    vi.stubEnv('GRAPH_CAIXA', 'secretaria@exemplo.test')
    limparCacheDeAmbiente()
    limparTokenDoGraph()
    vi.stubGlobal('fetch', async (url: string) => {
      pedidos.push(url)
      const corpo = url.includes('/oauth2/') ? { access_token: 'token-sintetico', expires_in: 3600 } : { value: [] }
      return new Response(JSON.stringify(corpo), { status: 200 })
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    limparCacheDeAmbiente()
    limparTokenDoGraph()
  })

  // Anexos continuam por `/messages/{id}`, que vale em qualquer pasta: se a
  // secretaria mover o e-mail entre a lista e o pedido do anexo, o caminho pela
  // Inbox responderia 404 e derrubaria a sincronização inteira.
  it('mensagens vêm da pasta Inbox, nunca da caixa inteira', async () => {
    await clienteDoGraph().listarMensagens(undefined)

    const mensagens = pedidos.filter((url) => url.includes('graph.microsoft.com'))
    expect(mensagens).toHaveLength(1)
    expect(mensagens[0]).toContain('/users/secretaria%40exemplo.test/mailFolders/inbox/messages?')
  })
})

/**
 * Achados C-02 e C-03 (`docs/auditoria/2026-09-17-achados-da-auditoria-por-agentes.md`).
 *
 * Antes, UMA mensagem fora do esquema (corpo gigante, 51 anexos) derrubava a
 * leitura inteira, e a caixa com mais de 200 mensagens também — para sempre,
 * porque a caixa só cresce (`A5` proíbe mover ou apagar) e a leitura não tinha
 * cursor. Nenhum pedido novo entrava até alguém mexer no Outlook à mão.
 */
describe('uma mensagem ruim, ou uma caixa cheia, não trava a leitura', () => {
  const LER_DESDE = new Date('2026-09-01T00:00:00Z')

  function varias(quantidade: number, prefixo: string): MensagemDoGraph[] {
    return Array.from({ length: quantidade }, (_, indice) =>
      mensagem({
        id: `${prefixo}-${indice}`,
        internetMessageId: `<${prefixo}-${indice}@exemplo.test>`,
        receivedDateTime: new Date(Date.UTC(2026, 8, 10, 0, indice)).toISOString(),
        hasAttachments: true,
      }),
    )
  }

  function coletor() {
    const avisos: AvisoDaBusca[] = []
    return { avisos, avisar: (aviso: AvisoDaBusca) => avisos.push(aviso) }
  }

  it('corpo acima do teto: a mensagem é recusada pelo nome, as outras passam', async () => {
    const gigante = 'x'.repeat(TAMANHO_MAXIMO_CORPO + 1)
    const cliente = clienteFalso([
      mensagem({ id: 'a', internetMessageId: '<a@exemplo.test>' }),
      mensagem({ id: 'b', internetMessageId: '<b@exemplo.test>', body: { content: gigante } }),
      mensagem({ id: 'c', internetMessageId: '<c@exemplo.test>' }),
    ])
    const { avisos, avisar } = coletor()

    const emails = await new IngestaoGraph(cliente, { lerDesde: LER_DESDE }).buscarNovos({ avisar })

    expect(emails.map((e) => e.messageId)).toEqual(['<a@exemplo.test>', '<c@exemplo.test>'])
    expect(avisos).toEqual([
      expect.objectContaining({ tipo: 'recusado', messageId: '<b@exemplo.test>' }),
    ])
    // O motivo diz o que houve, nunca repete o conteúdo.
    expect(JSON.stringify(avisos)).not.toContain('xxxxxxxxxx')
  })

  it('identificador maior que a coluna (C-04): recusada pelo nome, sem chamar ninguém depois', async () => {
    const longo = `<${'x'.repeat(300)}@exemplo.test>`
    const cliente = clienteFalso([
      mensagem({ id: 'longo', internetMessageId: longo }),
      mensagem({ id: 'ok', internetMessageId: '<ok@exemplo.test>' }),
    ])
    const { avisos, avisar } = coletor()

    const emails = await new IngestaoGraph(cliente, { lerDesde: LER_DESDE }).buscarNovos({ avisar })

    expect(emails.map((e) => e.messageId)).toEqual(['<ok@exemplo.test>'])
    expect(avisos).toEqual([expect.objectContaining({ tipo: 'recusado', messageId: longo })])
  })

  it('mais de 50 anexos: recusada pelo nome, sem derrubar as outras', async () => {
    const umAnexo: AnexoDoGraph = { name: 'a.pdf', contentType: 'application/pdf', size: 3, contentBytes: 'YWJj' }
    const cliente: ClienteDoGraph = {
      listarMensagens: async () => [
        mensagem({ id: 'muitos', internetMessageId: '<muitos@exemplo.test>', hasAttachments: true }),
        mensagem({ id: 'ok', internetMessageId: '<ok@exemplo.test>' }),
      ],
      listarAnexos: async (id) => (id === 'muitos' ? Array.from({ length: 51 }, () => umAnexo) : []),
    }
    const { avisos, avisar } = coletor()

    const emails = await new IngestaoGraph(cliente, { lerDesde: LER_DESDE }).buscarNovos({ avisar })

    expect(emails.map((e) => e.messageId)).toEqual(['<ok@exemplo.test>'])
    expect(avisos).toEqual([expect.objectContaining({ tipo: 'recusado', messageId: '<muitos@exemplo.test>' })])
  })

  it('assunto longo, nome de anexo vazio ou longo e remetente vazio são ajustados, não recusados', async () => {
    const cliente = clienteFalso(
      [
        mensagem({
          subject: 'a'.repeat(1_500),
          from: { emailAddress: { address: '' } },
          hasAttachments: true,
        }),
      ],
      [
        { name: '', contentType: 'application/pdf', size: 3, contentBytes: 'YWJj' },
        { name: `${'n'.repeat(400)}.pdf`, contentType: 'x'.repeat(300), size: 3, contentBytes: 'YWJj' },
      ],
    )
    const { avisos, avisar } = coletor()

    const [email] = await new IngestaoGraph(cliente, { lerDesde: LER_DESDE }).buscarNovos({ avisar })

    expect(avisos).toEqual([])
    expect(email!.assunto.length).toBeLessThanOrEqual(1_000)
    expect(email!.remetente).toBe('desconhecido@invalido')
    expect(email!.anexos[0]!.nome).toBe('anexo-sem-nome')
    expect(email!.anexos[1]!.nome.length).toBeLessThanOrEqual(255)
    expect(email!.anexos[1]!.nome.endsWith('.pdf')).toBe(true)
  })

  it('caixa cheia: lê as 200 mais antigas e deixa o resto para a próxima, dizendo quantas', async () => {
    const cliente = clienteFalso(varias(203, 'nova'))
    const { avisos, avisar } = coletor()

    const emails = await new IngestaoGraph(cliente, { lerDesde: LER_DESDE }).buscarNovos({ avisar })

    expect(emails).toHaveLength(200)
    expect(emails[0]!.messageId).toBe('<nova-0@exemplo.test>')
    expect(emails[199]!.messageId).toBe('<nova-199@exemplo.test>')
    expect(avisos).toEqual([{ tipo: 'adiados', quantidade: 3 }])
    // Anexo só é baixado para o que vai ser lido agora.
    expect(cliente.anexosPedidos).toHaveLength(200)
  })

  it('o que já foi processado sai ANTES do teto e antes de baixar anexo', async () => {
    const antigas = varias(250, 'antiga')
    const novas = varias(3, 'nova')
    const cliente = clienteFalso([...antigas, ...novas])
    const conhecidos = new Set(antigas.map((m) => m.internetMessageId!))

    const emails = await new IngestaoGraph(cliente, { lerDesde: LER_DESDE }).buscarNovos({
      jaProcessados: async (ids) => new Set(ids.filter((id) => conhecidos.has(id))),
    })

    expect(emails.map((e) => e.messageId)).toEqual(novas.map((m) => m.internetMessageId))
    expect(cliente.anexosPedidos).toEqual(['nova-0', 'nova-1', 'nova-2'])
  })

  it('lê a partir da data mais recente entre a janela pedida e a data de início da implantação', async () => {
    const pedidas: (Date | undefined)[] = []
    const cliente: ClienteDoGraph = {
      listarMensagens: async (desde) => {
        pedidas.push(desde)
        return []
      },
      listarAnexos: async () => [],
    }
    const ingestao = new IngestaoGraph(cliente, { lerDesde: LER_DESDE })

    await ingestao.buscarNovos({ desde: new Date('2026-08-01T00:00:00Z') })
    await ingestao.buscarNovos({ desde: new Date('2026-09-10T00:00:00Z') })
    await ingestao.buscarNovos()

    expect(pedidas).toEqual([LER_DESDE, new Date('2026-09-10T00:00:00Z'), LER_DESDE])
  })
})

describe('a fábrica exige o dia de início da leitura (AT-35)', () => {
  beforeEach(() => {
    vi.stubEnv('INGESTAO_ADAPTER', 'graph')
    vi.stubEnv('GRAPH_TENANT_ID', 'tenant-sintetico')
    vi.stubEnv('GRAPH_CLIENT_ID', 'cliente-sintetico')
    vi.stubEnv('GRAPH_CLIENT_SECRET', 'segredo-sintetico')
    vi.stubEnv('GRAPH_CAIXA', 'secretaria@exemplo.test')
    limparCacheDeAmbiente()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    limparCacheDeAmbiente()
  })

  it('sem GRAPH_LER_DESDE, falha dizendo qual variável falta', () => {
    vi.stubEnv('GRAPH_LER_DESDE', '')
    limparCacheDeAmbiente()
    expect(() => criarIngestaoPort({ datas: [] })).toThrow(/GRAPH_LER_DESDE/)
  })

  it.each(['2026-02-31', '2026-13-99'])('GRAPH_LER_DESDE=%s, data que não existe, é recusada', (data) => {
    vi.stubEnv('GRAPH_LER_DESDE', data)
    limparCacheDeAmbiente()
    expect(() => criarIngestaoPort({ datas: [] })).toThrow(/GRAPH_LER_DESDE/)
  })

  it('com GRAPH_LER_DESDE, lê a partir do início daquele dia no fuso da operação', async () => {
    vi.stubEnv('GRAPH_LER_DESDE', '2026-09-01')
    limparCacheDeAmbiente()
    const pedidas: (Date | undefined)[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      if (!url.includes('/oauth2/')) pedidas.push(new Date(decodeURIComponent(url.split('ge ')[1] ?? '')))
      const corpo = url.includes('/oauth2/') ? { access_token: 'token-sintetico', expires_in: 3600 } : { value: [] }
      return new Response(JSON.stringify(corpo), { status: 200 })
    })
    limparTokenDoGraph()

    await criarIngestaoPort({ datas: [] }).buscarNovos()

    vi.unstubAllGlobals()
    limparTokenDoGraph()
    expect(pedidas.map((d) => d?.toISOString())).toEqual(['2026-09-01T03:00:00.000Z'])
  })
})

describe('revisão do PR: a listagem real e o anexo que falha', () => {
  beforeEach(() => {
    vi.stubEnv('GRAPH_TENANT_ID', 'tenant-sintetico')
    vi.stubEnv('GRAPH_CLIENT_ID', 'cliente-sintetico')
    vi.stubEnv('GRAPH_CLIENT_SECRET', 'segredo-sintetico')
    vi.stubEnv('GRAPH_CAIXA', 'secretaria@exemplo.test')
    limparCacheDeAmbiente()
    limparTokenDoGraph()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    limparCacheDeAmbiente()
    limparTokenDoGraph()
  })

  /** `paginas` páginas de `porPagina` mensagens, encadeadas por `@odata.nextLink`. */
  function caixaPaginada(paginas: number, porPagina: number) {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/oauth2/')) {
        return new Response(JSON.stringify({ access_token: 'token-sintetico', expires_in: 3600 }), { status: 200 })
      }
      const atual = Number(new URL(url).searchParams.get('pagina') ?? '0')
      const value = Array.from({ length: porPagina }, (_, i) =>
        mensagem({ id: `p${atual}-${i}`, internetMessageId: `<p${atual}-${i}@exemplo.test>` }),
      )
      const proxima =
        atual + 1 < paginas
          ? { '@odata.nextLink': `https://graph.microsoft.com/v1.0/users/x/mailFolders/inbox/messages?pagina=${atual + 1}` }
          : {}
      return new Response(JSON.stringify({ value, ...proxima }), { status: 200 })
    })
  }

  it('segue a paginação até o fim da janela, mesmo passando de 200', async () => {
    // Com a janela, as primeiras páginas são quase todas de mensagens já
    // processadas: parar em 200 devolveria só as velhas, e as novas sumiriam
    // sem aviso nenhum.
    caixaPaginada(4, 100)

    const mensagens = await clienteDoGraph().listarMensagens(new Date('2026-09-10T00:00:00Z'))

    expect(mensagens).toHaveLength(400)
  })

  it('uma janela absurda falha alto, em vez de encher a memória', async () => {
    caixaPaginada(60, 100)

    await expect(clienteDoGraph().listarMensagens(new Date('2026-09-10T00:00:00Z'))).rejects.toThrow(
      /mensagens na janela/,
    )
  })

  it('anexo que não baixa recusa aquela mensagem pelo nome, e as outras seguem', async () => {
    const cliente: ClienteDoGraph = {
      listarMensagens: async () => [
        mensagem({ id: 'sumiu', internetMessageId: '<sumiu@exemplo.test>', hasAttachments: true }),
        mensagem({ id: 'ok', internetMessageId: '<ok@exemplo.test>' }),
      ],
      listarAnexos: async () => {
        throw new Error('a caixa respondeu 404: mensagem movida')
      },
    }
    const avisos: AvisoDaBusca[] = []

    const emails = await new IngestaoGraph(cliente).buscarNovos({ avisar: (aviso) => avisos.push(aviso) })

    expect(emails.map((e) => e.messageId)).toEqual(['<ok@exemplo.test>'])
    expect(avisos).toEqual([
      expect.objectContaining({ tipo: 'recusado', messageId: '<sumiu@exemplo.test>' }),
    ])
    expect(JSON.stringify(avisos)).not.toContain('movida')
  })
})
