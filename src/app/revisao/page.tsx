'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { api, mensagemDoErro } from '../../componentes/api'
import {
  Anuncio,
  Aviso,
  Botao,
  CabecalhoDeSecao,
  Cartao,
  Carregando,
  Selo,
  SeloDeConfianca,
  Vazio,
} from '../../componentes/matrizes'
import { NotasDoSetor } from '../../componentes/notas'
import { pedidoDeConfirmacao, pedidoDeConfirmacaoDoEmail } from '../../componentes/pedido-de-confirmacao'
import { CartaoDoEmail, type PessoaNova } from './cartao-do-email'
import { EmailAoLado, type EstadoDoEmail } from './email-ao-lado'
import {
  blocosDaRevisao,
  depoisDeResolver,
  depoisDeResolverVarias,
  estadoDaFila,
  filaDaResposta,
  ligaQueFicouDeFora,
  lerSugestao,
  mostraConfianca,
  prefixoDoTitulo,
  seloDoCampo,
} from './fila-na-tela'
import type { ItemEmRevisao, NaRede } from '../../core/tipos'
import type { EmailDaRevisao } from '../../core/trecho-do-email'

/** A forma vem do núcleo; a tela lê o que sobrevive ao JSON (`H-D7`). */
type ItemNaTela = NaRede<ItemEmRevisao>

const CATEGORIAS = [
  'DOC_CADASTRO',
  'FICHA_CADASTRO',
  'EMAIL_CADASTRO',
  'LIGA',
  'LIGANTE',
  'EMAIL_LIGA',
] as const

interface ItemExtra {
  titulo: string
  campos: Record<string, string>
}

interface Edicao {
  titulo: string
  categoria: string
  campos: Record<string, string>
  extras: ItemExtra[]
}

/** O que a pessoa mexeu no cartão de um e-mail (`A69`, 1A). */
interface EdicaoDoCartao {
  tirados: string[]
  novos: PessoaNova[]
}

const CARTAO_VAZIO: EdicaoDoCartao = { tirados: [], novos: [] }

/** Chave estável de cada pessoa nova: com o índice, remover a do meio levava o foco para a vizinha. */
let proximaChave = 0

/**
 * `confirmando` guarda o id da revisão armada, ou esta marca mais a ação e o
 * e-mail: um estado só, para nunca haver dois botões armados ao mesmo tempo.
 * Id de revisão não tem dois-pontos (cuid).
 */
const ARMADO_NO_EMAIL = 'email:'

function armadoNoEmail(acao: 'aprovar' | 'descartar', emailId: string): string {
  return `${ARMADO_NO_EMAIL}${acao}:${emailId}`
}


const MOTIVO: Record<string, { texto: string; tom: 'atencao' | 'alerta' | 'neutro' }> = {
  baixa_confianca: { texto: 'confiança abaixo do mínimo', tom: 'atencao' },
  campo_ausente: { texto: 'campo obrigatório faltando', tom: 'atencao' },
  duplicata_suspeita: { texto: 'possível duplicata', tom: 'atencao' },
  anomalia: { texto: 'anomalia', tom: 'alerta' },
  conteudo_suspeito: { texto: 'conteúdo suspeito', tom: 'alerta' },
  desdobramento: { texto: 'e-mail gerou vários itens', tom: 'atencao' },
  valor_fora_do_texto: { texto: 'dado não encontrado no e-mail', tom: 'atencao' },
  cpf_invalido: { texto: 'CPF não confere', tom: 'atencao' },
  // Alerta, e não atenção: o estouro pode ser provocado pelo remetente para o
  // selo apontar um campo isca; o que vem depois dele não foi conferido
  // (3ª rodada de segurança do #150).
  conferencia_incompleta: { texto: 'conferência interrompida: confira este campo e os seguintes', tom: 'alerta' },
}

/**
 * Fila de revisão.
 *
 * O operador não recomeça do zero: parte da sugestão da IA, corrige o que
 * estiver errado e aprova. A diferença entre a sugestão e o valor final é a
 * medida de acerto do modelo — e é ela que autoriza afrouxar o limiar depois.
 */
export default function Revisao() {
  /**
   * Lista e total num estado só (achado N-30): cada decisão desconta dos dois
   * juntos, sobre o estado de agora — duas decisões seguidas não trabalham
   * sobre uma lista velha. `pedirMais` marca que a lista local acabou com
   * pendentes além do corte.
   */
  const [fila, setFila] = useState<{ itens: ItemNaTela[]; total: number; pedirMais: boolean } | null>(
    null,
  )
  const pendentes = fila?.itens ?? null
  /** Quantas existem de verdade. Maior que a lista = a fila está truncada. */
  const totalPendentes = fila?.total ?? 0
  const estado = estadoDaFila(pendentes, totalPendentes)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<{ revisaoId: string; aprovar: boolean } | null>(null)
  /** Qual descarte está esperando o segundo clique. */
  const [confirmando, definirConfirmando] = useState<string | null>(null)
  /**
   * O que o leitor de tela ouve depois de aprovar ou descartar: o item sumia
   * calado. Toda ação nova o limpa (revisão do #128).
   */
  const [feito, setFeito] = useState<string | null>(null)
  const [edicao, setEdicao] = useState<Record<string, Edicao>>({})
  /** Por e-mail: quem foi tirado e quem foi acrescentado no cartão (`A69`, 1A). */
  const [cartoes, setCartoes] = useState<Record<string, EdicaoDoCartao>>({})
  /** E-mails que a pessoa pediu para ver um por um. */
  const [separados, setSeparados] = useState<ReadonlySet<string>>(new Set())
  const blocos = pendentes === null ? [] : blocosDaRevisao(pendentes, separados)
  const emailsNaTela = blocos.flatMap((bloco) => (bloco.tipo === 'email' ? [bloco] : []))
  /**
   * O e-mail de cada revisão ABERTA (`A69`, 2A). Lido do servidor só no
   * clique, um por vez: a lista não traz o corpo de propósito (achado N-34).
   */
  const [emails, setEmails] = useState<Record<string, EstadoDoEmail>>({})
  /**
   * O pedido VIGENTE de cada revisão. Lido do estado, o clique duplo antes do
   * re-render disparava duas leituras (duas linhas na trilha), e abrir →
   * fechar → abrir com a primeira em voo mostrava a resposta dela como se
   * fosse da segunda (revisão técnica do #163). Só o pedido vigente grava.
   */
  const pedidos = useRef(new Map<string, number>())
  const proximoPedido = useRef(0)
  /** Em voo: o segundo clique de um clique duplo chega antes do re-render e é ignorado. */
  const emVoo = useRef(new Set<string>())

  function fecharEmail(revisaoId: string) {
    pedidos.current.delete(revisaoId)
    emVoo.current.delete(revisaoId)
    setEmails(({ [revisaoId]: _fechado, ...resto }) => resto)
  }

  async function alternarEmail(revisaoId: string) {
    if (emVoo.current.has(revisaoId)) return
    if (pedidos.current.has(revisaoId)) {
      fecharEmail(revisaoId)
      return
    }
    proximoPedido.current += 1
    const pedido = proximoPedido.current
    pedidos.current.set(revisaoId, pedido)
    emVoo.current.add(revisaoId)
    setEmails((mapa) => ({ ...mapa, [revisaoId]: { fase: 'carregando' } }))
    let proximo: EstadoDoEmail
    try {
      const email = await api.buscar<EmailDaRevisao>(`/revisao/${encodeURIComponent(revisaoId)}/email`)
      proximo = { fase: 'pronto', email }
    } catch (causa) {
      proximo = { fase: 'erro', mensagem: mensagemDoErro(causa) }
    }
    if (pedidos.current.get(revisaoId) !== pedido) return
    emVoo.current.delete(revisaoId)
    setEmails((mapa) => ({ ...mapa, [revisaoId]: proximo }))
  }

  const carregar = useCallback(async () => {
    try {
      const resposta = filaDaResposta(
        await api.buscar<{ itens: ItemNaTela[]; total: number }>('/revisao'),
      )
      const lista = resposta.itens
      // O corpo de um e-mail não fica na memória da aba depois de a revisão
      // sair da fila: a retenção não alcança o navegador (revisão técnica do #163).
      pedidos.current.clear()
      emVoo.current.clear()
      setEmails({})
      setCartoes({})
      // Lista nova, nada armado: o aviso armado de antes falaria de outra lista.
      definirConfirmando(null)
      setFila({ itens: lista, total: resposta.total, pedirMais: false })
      setEdicao(
        Object.fromEntries(
          lista.map((item) => [
            item.revisaoId,
            {
              titulo: item.titulo,
              categoria: item.categoriaCodigo,
              campos: camposSugeridos(item),
              extras: [],
            },
          ]),
        ),
      )
    } catch (causa) {
      // Estado neutro, e não `null`: `null` é a condição que desenha
      // "Carregando…", então uma falha de rede deixava erro E carregando na
      // tela ao mesmo tempo, para sempre. Quem olha conclui "hoje está lento",
      // espera, e nunca tenta de novo.
      // Total zero junto: com o total antigo, lista vazia seria lida como
      // "próxima leva a caminho" e a tela mostraria "Carregando…" para sempre.
      setFila({ itens: [], total: 0, pedirMais: false })
      setErro(mensagemDoErro(causa))
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  // Só a decisão que zerou a lista local pede a próxima leva — nunca a própria
  // carga, então uma resposta vazia não vira laço de recarga.
  const pedirMais = fila?.pedirMais ?? false
  useEffect(() => {
    if (pedirMais) void carregar()
  }, [pedirMais, carregar])

  function mudarEdicao(revisaoId: string, parcial: Partial<Edicao>) {
    setEdicao((mapa) => ({ ...mapa, [revisaoId]: { ...mapa[revisaoId]!, ...parcial } }))
  }

  function mudarCampo(revisaoId: string, chave: string, valor: string) {
    const atual = edicao[revisaoId]
    if (!atual) return
    mudarEdicao(revisaoId, { campos: { ...atual.campos, [chave]: valor } })
  }

  /**
   * "A IA propõe N; o operador ajusta" (AT-06). Quando um item de lista ainda
   * esconde gente — "e mais 2 ligantes" no rodapé — o operador adiciona aqui
   * em vez de o sistema contar carga de menos pra sempre.
   */
  function adicionarExtra(revisaoId: string, chavesCampos: string[]) {
    const atual = edicao[revisaoId]
    if (!atual) return
    const novo: ItemExtra = {
      titulo: '',
      campos: Object.fromEntries(chavesCampos.map((chave) => [chave, ''])),
    }
    mudarEdicao(revisaoId, { extras: [...atual.extras, novo] })
  }

  function removerExtra(revisaoId: string, indice: number) {
    const atual = edicao[revisaoId]
    if (!atual) return
    mudarEdicao(revisaoId, { extras: atual.extras.filter((_, i) => i !== indice) })
  }

  function mudarExtra(revisaoId: string, indice: number, parcial: Partial<ItemExtra>) {
    const atual = edicao[revisaoId]
    if (!atual) return
    const extras = atual.extras.map((extra, i) => (i === indice ? { ...extra, ...parcial } : extra))
    mudarEdicao(revisaoId, { extras })
  }

  async function resolver(item: ItemEmRevisao, aprovar: boolean) {
    const atual = edicao[item.revisaoId]
    const extras = atual?.extras ?? []

    // NÃO descarta item sem título em silêncio.
    //
    // Filtrar os vazios aqui era exatamente a doença que esta tela existe para
    // curar: o operador adicionava o ligante esquecido, esquecia o título, e o
    // sistema voltava a contar carga de menos — agora sem nem o rastro que a
    // IA tinha deixado. Some com o trabalho e não conta a ninguém.
    if (aprovar && extras.some((extra) => extra.titulo.trim() === '')) {
      setErro('Há item novo sem título. Preencha o título ou remova o item antes de aprovar.')
      return
    }

    setOcupado({ revisaoId: item.revisaoId, aprovar })
    setErro(null)
    // Limpa ANTES do `await`: duas aprovações seguidas dão o mesmo texto, e
    // sem o vazio no meio a segunda não seria lida.
    setFeito(null)
    try {
      await api.enviar('/revisao/resolver', {
        revisaoId: item.revisaoId,
        categoriaCodigo: atual?.categoria ?? item.categoriaCodigo,
        titulo: atual?.titulo ?? item.titulo,
        campos: atual?.campos ?? {},
        aprovar,
        // Descartar é decisão sobre o item original; os extras nem chegam a
        // existir, então não há o que criar.
        itensExtras: aprovar ? extras : [],
      })
      setFila((anterior) => {
        if (!anterior) return anterior
        const depois = depoisDeResolver(anterior.itens, anterior.total, item.revisaoId)
        return { itens: depois.itens, total: depois.total, pedirMais: depois.recarregar }
      })
      fecharEmail(item.revisaoId)
      definirConfirmando(null)
      setFeito(aprovar ? 'Item aprovado.' : 'Item descartado.')
    } catch (causa) {
      setFeito(null)
      setErro(mensagemDoErro(causa))
    } finally {
      setOcupado(null)
    }
  }

  function mudarCartao(emailId: string, mudar: (atual: EdicaoDoCartao) => EdicaoDoCartao) {
    // Mexeu na lista, o número do segundo toque mudou: desarma.
    definirConfirmando((armado) => (armado?.endsWith(`:${emailId}`) ? null : armado))
    setCartoes((mapa) => ({ ...mapa, [emailId]: mudar(mapa[emailId] ?? CARTAO_VAZIO) }))
  }

  /** Corrigir o nome corrige também o fim do título, quando o título termina nele. */
  function mudarLinhaDoCartao(emailId: string, revisaoId: string, parcial: { titulo?: string; nome?: string }) {
    const atual = edicao[revisaoId]
    if (!atual) return
    definirConfirmando((armado) => (armado?.endsWith(`:${emailId}`) ? null : armado))
    if (parcial.titulo !== undefined) {
      mudarEdicao(revisaoId, { titulo: parcial.titulo })
      return
    }
    if (parcial.nome === undefined) return
    const prefixo = prefixoDoTitulo(atual.titulo, atual.campos.nome)
    mudarEdicao(revisaoId, {
      campos: { ...atual.campos, nome: parcial.nome },
      ...(prefixo === null ? {} : { titulo: `${prefixo}${parcial.nome}` }),
    })
  }

  function acrescentarNoCartao(emailId: string, primeira: ItemNaTela | undefined) {
    const atual = primeira ? edicao[primeira.revisaoId] : undefined
    const prefixo = atual ? (prefixoDoTitulo(atual.titulo, atual.campos.nome) ?? '') : ''
    proximaChave += 1
    const chave = proximaChave
    mudarCartao(emailId, (cartao) => ({ ...cartao, novos: [...cartao.novos, { chave, titulo: prefixo, nome: '' }] }))
  }

  function mudarNovoDoCartao(emailId: string, indice: number, parcial: Partial<PessoaNova>) {
    mudarCartao(emailId, (cartao) => ({
      ...cartao,
      novos: cartao.novos.map((novo, i) => {
        if (i !== indice) return novo
        // Título que ainda é "prefixo + nome" acompanha o nome digitado.
        const prefixo = parcial.nome !== undefined ? prefixoDoTitulo(novo.titulo, novo.nome) : null
        return {
          ...novo,
          ...parcial,
          ...(prefixo !== null && parcial.nome !== undefined ? { titulo: `${prefixo}${parcial.nome}` } : {}),
        }
      }),
    }))
  }

  /**
   * "Aprovar os N" ou "Descartar o e-mail" (`A69`, 1A). Tudo ou nada no
   * servidor: se a lista do e-mail mudou, nada é decidido.
   */
  async function resolverEmail(emailId: string, itens: readonly ItemNaTela[], aprovar: boolean) {
    const cartao = cartoes[emailId] ?? CARTAO_VAZIO
    const revisoes = itens.map((item) => {
      const fica = aprovar && !cartao.tirados.includes(item.revisaoId)
      const atual = edicao[item.revisaoId]
      // Quem sai vai com o título como veio: a decisão é só "não é este".
      return fica
        ? { revisaoId: item.revisaoId, titulo: atual?.titulo ?? item.titulo, campos: atual?.campos ?? {}, aprovar: true }
        : { revisaoId: item.revisaoId, titulo: item.titulo, campos: {}, aprovar: false }
    })
    const novos = aprovar
      ? cartao.novos.map((novo) => ({
          titulo: novo.titulo.trim(),
          campos: novo.nome.trim() === '' ? {} : { nome: novo.nome.trim() },
        }))
      : []

    // Mesma regra do cartão avulso: nada some calado por falta de título. E
    // pessoa nova só com o começo do título ("Inclusão de ligante — ") é
    // linha esquecida em branco, não uma pessoa.
    const primeira = itens[0] ? edicao[itens[0].revisaoId] : undefined
    const prefixo = primeira ? prefixoDoTitulo(primeira.titulo, primeira.campos.nome)?.trim() : undefined
    if (
      revisoes.some((linha) => linha.aprovar && linha.titulo.trim() === '') ||
      novos.some((novo) => novo.titulo === '' || (novo.titulo === prefixo && novo.campos.nome === undefined))
    ) {
      definirConfirmando(null)
      setErro('Há item sem título na lista. Preencha o título ou tire o item antes de aprovar.')
      return
    }

    setOcupado({ revisaoId: `${ARMADO_NO_EMAIL}${emailId}`, aprovar })
    setErro(null)
    setFeito(null)
    try {
      await api.enviar('/revisao/resolver-email', { emailId, revisoes, novos })
      const ids = itens.map((item) => item.revisaoId)
      setFila((anterior) => {
        if (!anterior) return anterior
        const depois = depoisDeResolverVarias(anterior.itens, anterior.total, ids)
        return { itens: depois.itens, total: depois.total, pedirMais: depois.recarregar }
      })
      for (const id of ids) fecharEmail(id)
      setCartoes(({ [emailId]: _decidido, ...resto }) => resto)
      definirConfirmando(null)
      setFeito(aprovar ? 'Lista do e-mail aprovada.' : 'E-mail descartado.')
    } catch (causa) {
      setFeito(null)
      definirConfirmando(null)
      setErro(mensagemDoErro(causa))
    } finally {
      setOcupado(null)
    }
  }

  /** O aviso do segundo toque no cartão: só números (`§ AT-48`). */
  function avisoDoEmail(armado: string): string {
    const [, acao, emailId] = armado.split(':')
    const posicao = emailsNaTela.findIndex((bloco) => bloco.emailId === emailId)
    const bloco = emailsNaTela[posicao]
    const cartao = (emailId ? cartoes[emailId] : undefined) ?? CARTAO_VAZIO
    const total = bloco?.itens.length ?? 0
    if (acao === 'descartar') return pedidoDeConfirmacaoDoEmail('descartar', posicao, emailsNaTela.length, 0, total)
    const tirados = bloco ? bloco.itens.filter((item) => cartao.tirados.includes(item.revisaoId)).length : 0
    return pedidoDeConfirmacaoDoEmail('aprovar', posicao, emailsNaTela.length, total - tirados + cartao.novos.length, tirados)
  }

  function camposSugeridos(item: ItemNaTela): Record<string, string> {
    try {
      const sugestao = JSON.parse(item.sugestaoIa) as { campos?: Record<string, string> }
      return sugestao.campos ?? {}
    } catch {
      return {}
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <CabecalhoDeSecao
        titulo="Revisão"
        descricao={
          estado === 'carregando'
            ? 'Carregando…'
            : estado === 'vazia'
              ? 'Nada aguardando decisão humana.'
              : `${totalPendentes} itens para conferir antes de ir para a fila de alguém.`
        }
      />

      {estado === 'lista' && pendentes !== null && totalPendentes > pendentes.length ? (
        <Aviso tom="atencao">
          <strong>
            {totalPendentes} revisões pendentes, e esta tela mostra {pendentes.length}.
          </strong>{' '}
          As de menor confiança aparecem primeiro. Resolva estas para as outras aparecerem.
        </Aviso>
      ) : null}

      {erro ? <Aviso>{erro}</Aviso> : null}
      {/* Qual item está armado, pela posição e pelo título: `pedido-de-confirmacao.ts`. */}
      <Anuncio
        mensagem={
          confirmando
            ? confirmando.startsWith(ARMADO_NO_EMAIL)
              ? avisoDoEmail(confirmando)
              : pedidoDeConfirmacao(
                  'descartar',
                  fila?.itens.findIndex((item) => item.revisaoId === confirmando) ?? -1,
                  fila?.itens.length ?? 0,
                )
            : feito
        }
      />

      {estado === 'carregando' || pendentes === null ? (
        <Carregando />
      ) : estado === 'vazia' ? (
        <Vazio
          titulo="Fila de revisão vazia"
          descricao="Todos os itens passaram da confiança mínima das suas categorias."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {blocos.map((bloco) => {
            if (bloco.tipo === 'email') {
              const { emailId, itens } = bloco
              const primeira = itens[0]!
              const cartao = cartoes[emailId] ?? CARTAO_VAZIO
              const emVoo = ocupado?.revisaoId === `${ARMADO_NO_EMAIL}${emailId}`
              return (
                <li key={`${ARMADO_NO_EMAIL}${emailId}`}>
                  <CartaoDoEmail
                    linhas={itens.map((item) => {
                      const atual = edicao[item.revisaoId]
                      return {
                        revisaoId: item.revisaoId,
                        titulo: atual?.titulo ?? item.titulo,
                        nome: atual && Object.hasOwn(atual.campos, 'nome') ? (atual.campos.nome ?? '') : null,
                        tirado: cartao.tirados.includes(item.revisaoId),
                        // O campo que faltou e a confiança baixa, por linha:
                        // no cartão eles somiam (revisões do #167). Valor para
                        // conferir não chega aqui (`decidivelNoCartao`).
                        selos: [
                          ...(item.campoIncerto ? [seloDoCampo(item.campoIncerto, lerSugestao(item.sugestaoIa))] : []),
                          ...(mostraConfianca(item.motivo) ? [`confiança ${Math.round(item.confianca * 100)}%`] : []),
                        ],
                      }
                    })}
                    novos={cartao.novos}
                    remetente={primeira.remetente}
                    assunto={primeira.assunto}
                    email={emails[primeira.revisaoId]}
                    confirmando={
                      confirmando === armadoNoEmail('aprovar', emailId)
                        ? 'aprovar'
                        : confirmando === armadoNoEmail('descartar', emailId)
                          ? 'descartar'
                          : null
                    }
                    ocupado={emVoo ? (ocupado?.aprovar ? 'aprovar' : 'descartar') : ocupado !== null ? 'bloqueado' : null}
                    aoAlternarEmail={() => void alternarEmail(primeira.revisaoId)}
                    aoSeparar={() => {
                      definirConfirmando(null)
                      setSeparados((anterior) => new Set([...anterior, emailId]))
                    }}
                    aoMudarLinha={(revisaoId, parcial) => mudarLinhaDoCartao(emailId, revisaoId, parcial)}
                    aoTirar={(revisaoId) =>
                      mudarCartao(emailId, (atual) => ({
                        ...atual,
                        tirados: atual.tirados.includes(revisaoId)
                          ? atual.tirados.filter((id) => id !== revisaoId)
                          : [...atual.tirados, revisaoId],
                      }))
                    }
                    aoAcrescentar={() => acrescentarNoCartao(emailId, primeira)}
                    aoMudarNovo={(indice, parcial) => mudarNovoDoCartao(emailId, indice, parcial)}
                    aoRemoverNovo={(indice) =>
                      mudarCartao(emailId, (atual) => ({ ...atual, novos: atual.novos.filter((_, i) => i !== indice) }))
                    }
                    aoAprovar={() => {
                      if (confirmando === armadoNoEmail('aprovar', emailId)) {
                        void resolverEmail(emailId, itens, true)
                        return
                      }
                      definirConfirmando(armadoNoEmail('aprovar', emailId))
                      setFeito(null)
                    }}
                    aoDescartar={() => {
                      if (confirmando === armadoNoEmail('descartar', emailId)) {
                        void resolverEmail(emailId, itens, false)
                        return
                      }
                      definirConfirmando(armadoNoEmail('descartar', emailId))
                      setFeito(null)
                    }}
                  />
                </li>
              )
            }
            const item = bloco.item
            const info = MOTIVO[item.motivo] ?? { texto: item.motivo, tom: 'neutro' as const }
            const atual = edicao[item.revisaoId]
            const email = emails[item.revisaoId]

            return (
              <li key={item.revisaoId}>
                <Cartao className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Selo tom={info.tom}>{info.texto}</Selo>
                    {mostraConfianca(item.motivo) ? (
                      <SeloDeConfianca valor={item.confianca} limiar={item.limiarConfianca} />
                    ) : null}
                    {item.campoIncerto ? (
                      <Selo>{seloDoCampo(item.campoIncerto, lerSugestao(item.sugestaoIa))}</Selo>
                    ) : null}
                    <span className="ml-auto">
                      <Botao
                        variante="secundario"
                        tamanho="pequeno"
                        onClick={() => void alternarEmail(item.revisaoId)}
                        desabilitado={email?.fase === 'carregando'}
                      >
                        {email ? 'Fechar o e-mail' : 'Ver o e-mail'}
                      </Botao>
                    </span>
                  </div>

                  {/* Aberto, o e-mail vai à esquerda e o que a IA leu à direita; em tela estreita, um embaixo do outro. */}
                  <div className={email ? 'mt-3 grid gap-4 lg:grid-cols-2' : ''}>
                    {email ? <EmailAoLado estado={email} /> : null}
                    <div className="min-w-0">
                      {/* A liga que a IA citou não é campo editável, e quando ela não
                          bate com o e-mail o item fica sem liga: quem revisa precisa
                          ver o nome para saber o que conferir (revisão técnica do #150). */}
                      {ligaQueFicouDeFora(lerSugestao(item.sugestaoIa), item.semLiga) ? (
                        <p className="mt-2 text-xs text-tinta-suave">
                          {/* <bdi>: o nome vem da IA, e um controle de direção nele
                              desenharia o resto da frase invertido (4ª rodada de segurança). */}
                          liga citada pela IA: <bdi>{ligaQueFicouDeFora(lerSugestao(item.sugestaoIa), item.semLiga)}</bdi> · o
                          item ficou sem liga
                        </p>
                      ) : null}

                      <p className="mt-2 text-xs text-tinta-suave">
                        de {item.remetente ?? 'origem manual'}
                        {item.assunto ? ` · ${item.assunto}` : ''}
                      </p>

                      {item.motivo === 'conteudo_suspeito' ? (
                        <div className="mt-2">
                          <Aviso tom="alerta">
                            O conteúdo deste e-mail tentou dar instruções ao sistema. Foi tratado como
                            dado comum e não teve efeito nenhum sobre a distribuição. Confira antes de
                            aprovar.
                          </Aviso>
                        </div>
                      ) : null}

                      {Object.keys(atual?.campos ?? {}).length > 0 ? (
                        <div className="mt-3 grid grid-cols-2 gap-2 rounded-md bg-papel-fundo px-3 py-2 sm:grid-cols-3">
                          {Object.entries(atual?.campos ?? {}).map(([chave, valor]) => (
                            <label key={chave} className="flex flex-col gap-1">
                              <span className="text-xs text-tinta-fraca">{chave}</span>
                              <input
                                value={valor}
                                onChange={(evento) => mudarCampo(item.revisaoId, chave, evento.target.value)}
                                className="min-h-9 rounded-md border border-borda-forte bg-papel px-2 text-sm"
                              />
                            </label>
                          ))}
                        </div>
                      ) : null}

                      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                        <label className="flex flex-col gap-1">
                          <span className="text-xs text-tinta-fraca">Título</span>
                          <input
                            value={atual?.titulo ?? item.titulo}
                            onChange={(evento) =>
                              mudarEdicao(item.revisaoId, { titulo: evento.target.value })
                            }
                            className="min-h-10 rounded-md border border-borda-forte bg-papel px-2.5 text-sm"
                          />
                        </label>

                        <label className="flex flex-col gap-1">
                          <span className="text-xs text-tinta-fraca">Categoria</span>
                          <select
                            value={atual?.categoria ?? item.categoriaCodigo}
                            onChange={(evento) =>
                              mudarEdicao(item.revisaoId, { categoria: evento.target.value })
                            }
                            className="min-h-10 rounded-md border border-borda-forte bg-papel px-2.5 text-sm"
                          >
                            {CATEGORIAS.map((codigo) => (
                              <option key={codigo} value={codigo}>
                                {codigo.toLowerCase().replaceAll('_', ' ')}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="mt-3 flex flex-col gap-2 rounded-md border border-dashed border-borda-forte px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-tinta-fraca">
                            Este e-mail escondia mais gente? Adicione os itens que a IA não separou.
                          </span>
                          <Botao
                            variante="secundario"
                            tamanho="pequeno"
                            onClick={() =>
                              adicionarExtra(item.revisaoId, Object.keys(atual?.campos ?? {}))
                            }
                          >
                            + item
                          </Botao>
                        </div>

                        {(atual?.extras ?? []).map((extra, indice) => (
                          <div
                            key={indice}
                            className="flex flex-col gap-2 rounded-md bg-papel-fundo px-2.5 py-2 sm:flex-row sm:items-start"
                          >
                            <input
                              value={extra.titulo}
                              required
                              aria-label="título do item novo"
                              placeholder="título do item (obrigatório)"
                              onChange={(evento) =>
                                mudarExtra(item.revisaoId, indice, { titulo: evento.target.value })
                              }
                              className="min-h-9 flex-1 rounded-md border border-borda-forte bg-papel px-2 text-sm"
                            />
                            {Object.keys(extra.campos).map((chave) => (
                              <input
                                key={chave}
                                value={extra.campos[chave] ?? ''}
                                placeholder={chave}
                                aria-label={`${chave} do item novo`}
                                onChange={(evento) =>
                                  mudarExtra(item.revisaoId, indice, {
                                    campos: { ...extra.campos, [chave]: evento.target.value },
                                  })
                                }
                                className="min-h-9 flex-1 rounded-md border border-borda-forte bg-papel px-2 text-sm"
                              />
                            ))}
                            <Botao
                              variante="perigo"
                              tamanho="pequeno"
                              onClick={() => removerExtra(item.revisaoId, indice)}
                            >
                              remover
                            </Botao>
                          </div>
                        ))}
                      </div>

                      {/*
                        ═══ DESCARTAR PEDE DOIS CLIQUES, APROVAR NÃO ═══

                        Descartar grava `cancelado` e não existe caminho de volta —
                        nem serviço, nem rota, nem tela —, e a idempotência por
                        `messageId` impede que uma nova sincronização recrie o item.
                        Um clique errado numa fila de 40 revisões resolvidas em
                        sequência apaga o pedido de um associado para sempre.

                        Arquivar uma NOTA, que não apaga nada de operacional, já
                        exigia dois cliques. A assimetria era ao contrário.

                        E o rótulo de progresso ia para o botão errado: `ocupado`
                        guardava só o id, então quem clicava em Descartar via o botão
                        "Aprovar", ao lado, anunciar "salvando…".
                      */}
                      <div className="mt-3 flex justify-end gap-2">
                        <Botao
                          variante="perigo"
                          tamanho="pequeno"
                          onClick={() => {
                            if (confirmando === item.revisaoId) {
                              void resolver(item, false)
                              return
                            }
                            definirConfirmando(item.revisaoId)
                            setFeito(null)
                          }}
                          desabilitado={ocupado !== null}
                        >
                          {ocupado?.revisaoId === item.revisaoId && !ocupado.aprovar
                            ? 'descartando…'
                            : confirmando === item.revisaoId
                              ? 'Confirmar: descartar para sempre'
                              : 'Descartar'}
                        </Botao>
                        <Botao
                          variante="principal"
                          tamanho="pequeno"
                          onClick={() => resolver(item, true)}
                          desabilitado={ocupado !== null}
                        >
                          {ocupado?.revisaoId === item.revisaoId && ocupado.aprovar
                            ? 'salvando…'
                            : 'Aprovar'}
                        </Botao>
                      </div>
                    </div>
                  </div>
                </Cartao>
              </li>
            )
          })}
        </ul>
      )}

      {/*
        Na Revisão a memória vale duas vezes: é aqui que a equipe descobre onde
        a IA escorrega, e é a nota escrita aqui que fará mais diferença no dia
        em que o modelo passar a lê-la — ver `core/notas.ts`.
      */}
      <NotasDoSetor titulo="O que o setor já aprendeu sobre a interpretação" />
    </div>
  )
}
