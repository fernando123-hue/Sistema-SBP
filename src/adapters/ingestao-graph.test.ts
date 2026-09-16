import { describe, expect, it } from 'vitest'

import { TAMANHO_MAXIMO_ANEXO_BYTES } from '../core/esquemas'
import {
  IngestaoGraph,
  IngestaoIndisponivelError,
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

  it('caixa com histórico inteiro falha ALTO, em vez de cortar calado', async () => {
    // Cada mensagem custa uma chamada paga ao modelo. Cortar em silêncio
    // esconderia trabalho perdido; parar com a mensagem certa faz quem implanta
    // decidir de que data começar.
    const muitas = Array.from({ length: 201 }, (_, indice) =>
      mensagem({ id: `id-${indice}`, internetMessageId: `<${indice}@exemplo.test>` }),
    )

    await expect(new IngestaoGraph(clienteFalso(muitas)).buscarNovos()).rejects.toBeInstanceOf(
      IngestaoIndisponivelError,
    )
  })
})
