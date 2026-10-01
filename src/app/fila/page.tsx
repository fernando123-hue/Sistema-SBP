'use client'

import { useCallback, useEffect, useState } from 'react'

import { api, mensagemDoErro } from '../../componentes/api'
import {
  Anuncio,
  Aviso,
  Botao,
  CabecalhoDeSecao,
  Cartao,
  Carregando,
  Selo,
  Vazio,
} from '../../componentes/matrizes'
import { NotasDoSetor } from '../../componentes/notas'
import { pedidoDeConfirmacao, pedidoDeConfirmacaoDoGrupo } from '../../componentes/pedido-de-confirmacao'
import type { CampoParaCopiar } from '../../core/dados-do-item'
import { hojeIso } from '../../core/util/datas'
import { agruparPorEmail, amostraDosTitulos, type GrupoDaFila } from './grupos'

interface ItemDaFila {
  itemId: string
  titulo: string
  categoriaCodigo: string
  categoriaRotulo: string
  status: string
  emailId: string | null
  remetente: string | null
  assunto: string | null
  recebidoEm: string | null
  atribuidoEm: string
  criadoEm: string
}

function quando(valor: string | null): string {
  if (!valor) return '—'
  return new Date(valor).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

/**
 * Minha fila.
 *
 * A tela que substitui "Paulo: 24". Em vez de um número, os 24 itens reais,
 * com remetente e assunto. Mobile-first: é a tela que será aberta no celular.
 */
/** Quem pode receber uma transferência. Vem da escala, que qualquer papel lê. */
interface PessoaDaEscala {
  colaboradorId: string
  nome: string
  /** Já redigido pelo servidor conforme o papel de quem pergunta (`'ferias'` ou outro rótulo). */
  afastamento: string | null
}

interface PerfilDaSessao {
  colaborador: { id: string } | null
}

/**
 * O nome na lista "Transferir para", com a ausência do dia à vista.
 *
 * Marca, não bloqueia: transferir para quem está fora pode ser deliberado
 * ("ela volta amanhã e o caso é dela"), e essa resposta é do dono do
 * processo, não da tela — ver o comentário de `transferir` em `servicos/fila.ts`.
 */
function rotuloDoDestino(pessoa: PessoaDaEscala): string {
  if (pessoa.afastamento === null) return pessoa.nome
  return `${pessoa.nome} — ${pessoa.afastamento === 'ferias' ? 'de férias' : 'ausente hoje'}`
}

/** `itemId` é o item, ou a chave do grupo quando a ação é "Concluir os N". */
type AcaoEmCurso = { itemId: string; acao: 'concluir' | 'devolver' | 'transferir' } | null

/** O que `GET /itens/[id]/dados` devolve (`servicos/fila.ts → lerDadosDoItem`). */
type DadosDoItem =
  | { situacao: 'disponivel'; campos: CampoParaCopiar[] }
  | { situacao: 'expurgado'; expurgadoEm: string }

type PainelDeDados =
  | { estado: 'carregando' }
  | { estado: 'pronto'; dados: DadosDoItem }
  | { estado: 'erro'; mensagem: string }

/** Chave de grupo e id de item nunca se confundem: a do grupo começa assim. */
const PREFIXO_DE_GRUPO = 'email:'

export default function Fila() {
  const [itens, setItens] = useState<ItemDaFila[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<AcaoEmCurso>(null)
  /** Item cujo formulário de "não é comigo" está aberto, e o que ele preenche. */
  const [saindo, setSaindo] = useState<string | null>(null)
  const [justificativa, setJustificativa] = useState('')
  const [destino, setDestino] = useState('')
  const [equipe, setEquipe] = useState<PessoaDaEscala[]>([])
  /** Item cujo "Concluir" já levou o primeiro toque e espera a confirmação. */
  const [confirmandoConclusao, setConfirmandoConclusao] = useState<string | null>(null)
  /**
   * O que o leitor de tela ouve depois do segundo clique: sem isto, o item
   * sumia calado. Toda ação nova o limpa — senão, desarmar o Concluir fazia o
   * leitor repetir um sucesso antigo (revisão do #128).
   */
  const [feito, setFeito] = useState<string | null>(null)
  /** Grupos abertos em "Ver um por um". */
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(new Set())
  /**
   * Os dados que a IA leu, por item, só enquanto o painel está aberto (`A69`,
   * 3B). Fechar o painel ou o item sair da fila apaga daqui: CPF não fica
   * guardado na tela além do tempo em que alguém o está usando.
   */
  const [dados, setDados] = useState<Readonly<Record<string, PainelDeDados>>>({})

  const carregar = useCallback(async () => {
    try {
      const lista = await api.buscar<ItemDaFila[]>('/fila')
      setItens(lista)
      // O item que saiu da fila leva junto os dados que a tela tinha dele
      // (revisão de segurança do #165): CPF não fica no estado da tela.
      const ficam = new Set(lista.map((item) => item.itemId))
      setDados((atual) => Object.fromEntries(Object.entries(atual).filter(([itemId]) => ficam.has(itemId))))
    } catch (causa) {
      // Lista vazia, e não `null`: `null` é a condição que desenha "Carregando…",
      // então uma falha de rede deixava erro E carregando na tela ao mesmo
      // tempo, para sempre. Quem olha conclui "hoje está lento" e espera.
      setItens([])
      setErro(mensagemDoErro(causa))
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  /** Tira os itens da lista e esquece os dados que a tela tinha deles. */
  function tirarDaLista(ids: readonly string[]) {
    const saem = new Set(ids)
    setItens((atual) => (atual ?? []).filter((linha) => !saem.has(linha.itemId)))
    setDados((atual) => Object.fromEntries(Object.entries(atual).filter(([itemId]) => !saem.has(itemId))))
  }

  async function concluir(item: ItemDaFila) {
    setOcupado({ itemId: item.itemId, acao: 'concluir' })
    setErro(null)
    // Limpa ANTES do `await`: o aviso novo passa a ser uma mudança de verdade,
    // mesmo quando é igual ao anterior.
    setFeito(null)
    try {
      await api.enviar(`/itens/${item.itemId}/concluir`)
      tirarDaLista([item.itemId])
      setFeito('Item concluído.')
    } catch (causa) {
      setFeito(null)
      setErro(mensagemDoErro(causa))
    } finally {
      setOcupado(null)
      setConfirmandoConclusao(null)
    }
  }

  /**
   * Abre o formulário de saída do item, e busca a equipe uma vez só.
   *
   * A lista vem de `/escala`, que é o que um colaborador consegue ler —
   * `/colaboradores` exige gestor. Consequência: só aparece quem tem alguma
   * habilitação, e é por isso que o texto embaixo do seletor diz isso, em vez
   * de deixar a pessoa procurar um nome que nunca vai estar lá.
   */
  async function abrirSaida(item: ItemDaFila) {
    setSaindo(item.itemId)
    setJustificativa('')
    setDestino('')
    setErro(null)
    if (equipe.length > 0) return
    try {
      // `hojeIso()`, no fuso da operação: `toISOString()` é UTC, e depois das
      // 21h de Brasília pedia a escala — e os afastamentos — de amanhã (N-05).
      const [escala, sessao] = await Promise.all([
        api.buscar<PessoaDaEscala[]>(`/escala?data=${hojeIso()}`),
        // Sem a sessão, a lista sai com o próprio nome — e o servidor recusa a
        // transferência para si com mensagem clara. Perder a lista inteira
        // por isso seria trocar um incômodo por uma saída a menos.
        api.buscar<PerfilDaSessao>('/sessao').catch(() => null),
      ])
      // A própria pessoa sai da lista: transferir para si não é transferir.
      // O servidor também recusa, mas a opção nem deve ser oferecida.
      const eu = sessao?.colaborador?.id
      setEquipe(escala.filter((pessoa) => pessoa.colaboradorId !== eu))
    } catch {
      // Sem a lista, transferir fica indisponível e devolver continua valendo.
      // Uma das duas saídas some; a tela não. Por isso não vira erro de tela.
      setEquipe([])
    }
  }

  async function devolver(item: ItemDaFila) {
    setOcupado({ itemId: item.itemId, acao: 'devolver' })
    setErro(null)
    try {
      await api.enviar(`/itens/${item.itemId}/devolver`, { justificativa })
      tirarDaLista([item.itemId])
      setSaindo(null)
    } catch (causa) {
      setErro(mensagemDoErro(causa))
    } finally {
      setOcupado(null)
    }
  }

  async function transferir(item: ItemDaFila) {
    setOcupado({ itemId: item.itemId, acao: 'transferir' })
    setErro(null)
    try {
      await api.enviar(`/itens/${item.itemId}/transferir`, {
        paraColaboradorId: destino,
        justificativa,
      })
      tirarDaLista([item.itemId])
      setSaindo(null)
    } catch (causa) {
      setErro(mensagemDoErro(causa))
    } finally {
      setOcupado(null)
    }
  }

  /**
   * "Concluir os N" de um e-mail (`A69`, 3A). Os ids vão explícitos: o que a
   * pessoa viu é o que conclui. Tudo ou nada no servidor — se algum item mudou
   * de mão, nenhum é concluído e a mensagem diz isso.
   */
  async function concluirJunto(grupo: GrupoDaFila<ItemDaFila>) {
    setOcupado({ itemId: grupo.chave, acao: 'concluir' })
    setErro(null)
    setFeito(null)
    try {
      const ids = grupo.itens.map((item) => item.itemId)
      await api.enviar('/fila/concluir-junto', { itemIds: ids })
      tirarDaLista(ids)
      // Literal, como todo aviso da região (`§ AT-48`); quantos já foi dito
      // no pedido de confirmação.
      setFeito('Itens do e-mail concluídos.')
    } catch (causa) {
      setFeito(null)
      setErro(mensagemDoErro(causa))
      // A recusa do grupo manda atualizar a tela; a tela atualiza sozinha, e
      // o erro continua à vista (`carregar` só o troca se ela mesma falhar).
      void carregar()
    } finally {
      setOcupado(null)
      setConfirmandoConclusao(null)
    }
  }

  /** Abre ou fecha o painel de dados de um item; abrir pede ao servidor. */
  async function alternarDados(item: ItemDaFila) {
    if (dados[item.itemId]) {
      setDados((atual) => Object.fromEntries(Object.entries(atual).filter(([itemId]) => itemId !== item.itemId)))
      return
    }
    setDados((atual) => ({ ...atual, [item.itemId]: { estado: 'carregando' } }))
    let painel: PainelDeDados
    try {
      painel = { estado: 'pronto', dados: await api.buscar<DadosDoItem>(`/itens/${item.itemId}/dados`) }
    } catch (causa) {
      painel = { estado: 'erro', mensagem: mensagemDoErro(causa) }
    }
    // Só se o painel continua aberto: fechado no meio do caminho, a resposta
    // não reabre nada nem fica guardada.
    setDados((atual) => (atual[item.itemId] ? { ...atual, [item.itemId]: painel } : atual))
  }

  /**
   * Copia um valor. A área de transferência do navegador só existe em
   * endereço seguro (https ou localhost); fora dele, a tela diz como copiar à
   * mão em vez de fingir que copiou.
   */
  async function copiar(valor: string) {
    // Outro botão desarma o Concluir; e, armado, o anúncio de confirmação
    // tomaria o lugar do "Copiado." (revisão técnica do #165).
    setConfirmandoConclusao(null)
    // Limpa ANTES do `await`, como em `concluir`: copiar duas vezes seguidas
    // também é ouvido duas vezes.
    setFeito(null)
    try {
      await navigator.clipboard.writeText(valor)
      setFeito('Copiado.')
    } catch {
      setErro('Não consegui copiar daqui. Selecione o valor e copie com Ctrl+C.')
    }
  }

  const porCategoria = new Map<string, ItemDaFila[]>()
  for (const item of itens ?? []) {
    porCategoria.set(item.categoriaRotulo, [...(porCategoria.get(item.categoriaRotulo) ?? []), item])
  }
  // Os grupos são por categoria E por e-mail: um e-mail que virou itens de
  // categorias diferentes aparece em cada seção com os seus.
  const secoes = [...porCategoria.entries()].map(([categoria, lista]) => ({
    categoria,
    quantos: lista.length,
    grupos: agruparPorEmail(lista),
  }))
  const todosOsGrupos = secoes.flatMap((secao) => secao.grupos)
  const gruposJuntos = todosOsGrupos.filter((grupo) => grupo.itens.length > 1)

  // Onde está o que foi armado, na ordem da tela. A frase sai de
  // `pedidoDeConfirmacao*`, só com posição e quantidade (`§ AT-48`).
  const grupoArmado = confirmandoConclusao?.startsWith(PREFIXO_DE_GRUPO)
    ? gruposJuntos.findIndex((grupo) => grupo.chave === confirmandoConclusao)
    : null
  // A ordem da TELA: o grupo aparece na posição do item mais antigo dele, e a
  // posição conta só os cartões À VISTA: os itens de um grupo fechado não
  // têm Concluir próprio na tela (revisão técnica do #165).
  const cartoesNaTela = todosOsGrupos.flatMap((grupo) =>
    grupo.itens.length === 1 || abertos.has(grupo.chave) ? grupo.itens : [],
  )
  const itemArmado = cartoesNaTela.findIndex((item) => item.itemId === confirmandoConclusao)

  function cartaoDoItem(item: ItemDaFila) {
    return (
      <Cartao className="px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{item.titulo}</p>
            <p className="mt-0.5 truncate text-xs text-tinta-suave">
              {item.remetente ?? 'origem manual'}
            </p>
            {item.assunto && item.assunto !== item.titulo ? (
              <p className="mt-0.5 truncate text-xs text-tinta-fraca">
                {item.assunto}
              </p>
            ) : null}
          </div>
          {/*
            Mostra `criadoEm`, que é a chave pela qual o servidor
            ordena esta lista (`A7`: mais antigo no topo). Exibir
            `recebidoEm` aqui deixava a ordem parecendo arbitrária
            nos casos em que as duas datas divergem — item de
            origem manual não tem e-mail, e item devolvido guarda
            a data original.
          */}
          <span className="numerico text-xs whitespace-nowrap text-tinta-fraca">
            <span className="sr-only">entrou em </span>
            {quando(item.criadoEm)}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {/*
            Só item de e-mail: o registrado à mão não tem nada que a IA tenha lido.
            Os dados vêm do servidor no clique, um item por vez, e a leitura vai
            para a trilha (`A69`, 3B).
          */}
          {item.emailId !== null ? (
            <Botao
              tamanho="pequeno"
              onClick={() => {
                // Outro botão desarma o Concluir, como o "Não é comigo".
                setConfirmandoConclusao(null)
                void alternarDados(item)
              }}
            >
              {dados[item.itemId] ? 'Esconder dados' : 'Ver dados'}
            </Botao>
          ) : null}
          {/*
            "Não é comigo" existe porque a alternativa é pior: com
            Concluir sendo o único botão, quem recebe item alheio
            conclui trabalho que não fez — e a contagem do painel
            volta a ser a ficção que este sistema veio substituir.
            O manual do assistente já ensinava as duas operações e
            mandava a pessoa para esta tela; a tela é que não as
            oferecia.
          */}
          <Botao
            tamanho="pequeno"
            onClick={() => {
              setConfirmandoConclusao(null)
              setFeito(null)
              if (saindo === item.itemId) setSaindo(null)
              else void abrirSaida(item)
            }}
            desabilitado={ocupado !== null}
          >
            {saindo === item.itemId ? 'Deixar comigo' : 'Não é comigo'}
          </Botao>
          {/*
            ═══ CONCLUIR PEDE DOIS TOQUES ═══

            Concluir não tem volta — não existe serviço, rota nem
            tela para reabrir —, e o item some de todas as filas:
            um toque errado dá como atendido o pedido de um
            associado que ninguém atendeu, o painel conta uma
            conclusão que não aconteceu e o prazo de retenção do
            texto começa a correr. Ninguém fica sabendo. É a
            mesma trava do Descartar da Revisão (N-04, `AT-46`).
          */}
          <Botao
            variante="principal"
            tamanho="pequeno"
            onClick={() => {
              if (confirmandoConclusao === item.itemId) {
                void concluir(item)
                return
              }
              setConfirmandoConclusao(item.itemId)
              setFeito(null)
            }}
            desabilitado={ocupado !== null}
          >
            {ocupado?.itemId === item.itemId && ocupado.acao === 'concluir'
              ? 'concluindo…'
              : confirmandoConclusao === item.itemId
                ? 'Confirmar: concluir'
                : 'Concluir'}
          </Botao>
        </div>

        {dados[item.itemId] ? <PainelDosDados painel={dados[item.itemId]!} copiar={copiar} /> : null}

        {saindo === item.itemId ? (
          <div className="mt-3 flex flex-col gap-2 border-t border-borda pt-3">
            <label
              className="text-xs text-tinta-suave"
              htmlFor={`porque-${item.itemId}`}
            >
              {/* Não diz mais "fica na trilha": desde o `A23(d)` o texto
                  mora à parte, e a trilha só guarda que houve motivo. */}
              Por que este item não é seu? Escreva pelo menos 5 letras.
            </label>
            <textarea
              id={`porque-${item.itemId}`}
              value={justificativa}
              onChange={(evento) => setJustificativa(evento.target.value)}
              rows={2}
              className="w-full rounded-md border border-borda-forte bg-papel px-2 py-1.5 text-sm"
              placeholder="Ex.: é da liga que a Cristina já está tratando."
            />

            <div className="flex flex-wrap items-center gap-2">
              <Botao
                tamanho="pequeno"
                onClick={() => devolver(item)}
                desabilitado={ocupado !== null || justificativa.trim().length < 5}
              >
                {ocupado?.itemId === item.itemId && ocupado.acao === 'devolver'
                  ? 'devolvendo…'
                  : 'Devolver para o grupo'}
              </Botao>

              {equipe.length > 0 ? (
                <>
                  <select
                    aria-label="Transferir para"
                    value={destino}
                    onChange={(evento) => setDestino(evento.target.value)}
                    className="min-h-11 rounded-md border border-borda-forte bg-papel px-2 text-xs sm:min-h-9"
                  >
                    <option value="">Transferir para…</option>
                    {equipe.map((pessoa) => (
                      <option key={pessoa.colaboradorId} value={pessoa.colaboradorId}>
                        {rotuloDoDestino(pessoa)}
                      </option>
                    ))}
                  </select>
                  <Botao
                    tamanho="pequeno"
                    onClick={() => transferir(item)}
                    desabilitado={
                      ocupado !== null ||
                      destino === '' ||
                      justificativa.trim().length < 5
                    }
                  >
                    {ocupado?.itemId === item.itemId && ocupado.acao === 'transferir'
                      ? 'transferindo…'
                      : 'Transferir'}
                  </Botao>
                </>
              ) : null}
            </div>

            <p className="text-xs text-tinta-suave">
              Devolver deixa o item sem dono, e o rateio decide de novo na próxima
              rodada. Transferir escolhe a pessoa — a lista traz quem está habilitado
              em alguma categoria.
            </p>
          </div>
        ) : null}
      </Cartao>
    )
  }

  function alternarGrupo(grupo: GrupoDaFila<ItemDaFila>) {
    setConfirmandoConclusao(null)
    setFeito(null)
    if (abertos.has(grupo.chave)) {
      // Juntar de novo esconde os cartões, e com eles os dados abertos: ao
      // reabrir, cada "Ver dados" lê de novo do servidor e entra na trilha
      // (revisão técnica do #165).
      const saem = new Set(grupo.itens.map((item) => item.itemId))
      setDados((atual) => Object.fromEntries(Object.entries(atual).filter(([itemId]) => !saem.has(itemId))))
    }
    setAbertos((atual) => {
      const novo = new Set(atual)
      if (novo.has(grupo.chave)) novo.delete(grupo.chave)
      else novo.add(grupo.chave)
      return novo
    })
  }

  /**
   * Um e-mail com vários itens, num cartão só (`A69`, 3A).
   *
   * Cada item continua existindo e contando no Painel; "Ver um por um" volta
   * aos cartões de sempre, para concluir, devolver ou transferir só alguns.
   */
  function cartaoDoGrupo(grupo: GrupoDaFila<ItemDaFila>) {
    const primeiro = grupo.itens[0]!
    const quantos = grupo.itens.length
    const { nomes, resto } = amostraDosTitulos(grupo.itens.map((item) => item.titulo))
    const armado = confirmandoConclusao === grupo.chave
    return (
      <Cartao className="px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {primeiro.assunto ?? primeiro.titulo}
              <span className="text-tinta-suave"> · {quantos} itens</span>
            </p>
            <p className="mt-0.5 truncate text-xs text-tinta-suave">{primeiro.remetente ?? 'origem manual'}</p>
            <p className="mt-1 text-xs text-tinta-fraca">
              {nomes.join(' · ')}
              {resto > 0 ? ` · mais ${resto}` : ''}
            </p>
          </div>
          {/* O mais antigo do grupo: é a posição dele que a fila respeita (`A7`). */}
          <span className="numerico text-xs whitespace-nowrap text-tinta-fraca">
            <span className="sr-only">entrou em </span>
            {quando(primeiro.criadoEm)}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <Botao tamanho="pequeno" onClick={() => alternarGrupo(grupo)} desabilitado={ocupado !== null}>
            Ver um por um
          </Botao>
          {/*
            A MESMA TRAVA DE DOIS TOQUES do Concluir de um item, e o segundo
            toque diz quantos: concluir os 34 não tem volta, e um toque errado
            dá como atendido o pedido inteiro de uma liga.
          */}
          <Botao
            variante="principal"
            tamanho="pequeno"
            onClick={() => {
              if (armado) {
                void concluirJunto(grupo)
                return
              }
              setConfirmandoConclusao(grupo.chave)
              setFeito(null)
            }}
            desabilitado={ocupado !== null}
          >
            {ocupado?.itemId === grupo.chave
              ? 'concluindo…'
              : armado
                ? `Confirmar: concluir os ${quantos}`
                : `Concluir os ${quantos}`}
          </Botao>
        </div>
      </Cartao>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <CabecalhoDeSecao
        titulo="Minha fila"
        descricao={
          itens === null
            ? 'Carregando…'
            : `${itens.length} ${itens.length === 1 ? 'item' : 'itens'} para trabalhar, o que entrou há mais tempo primeiro. O que não terminar hoje continua seu amanhã.`
        }
      />

      {erro ? <Aviso>{erro}</Aviso> : null}
      {/* Qual item está armado, pela posição e pelo título: `pedido-de-confirmacao.ts`. */}
      {/* A ordem da TELA, agrupada por categoria e por e-mail — não a de `itens`. */}
      <Anuncio
        mensagem={
          confirmandoConclusao
            ? grupoArmado !== null
              ? pedidoDeConfirmacaoDoGrupo(
                  grupoArmado,
                  gruposJuntos.length,
                  gruposJuntos[grupoArmado]?.itens.length ?? 0,
                )
              : pedidoDeConfirmacao('concluir', itemArmado, cartoesNaTela.length)
            : feito
        }
      />

      {itens === null ? (
        <Carregando />
      ) : itens.length === 0 ? (
        <Vazio titulo="Fila vazia" descricao="Nada atribuído a você no momento." />
      ) : (
        <div className="flex flex-col gap-5">
          {secoes.map(({ categoria, quantos, grupos }) => (
            <section key={categoria}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                {categoria}
                <Selo>{quantos}</Selo>
              </h2>

              <ul className="flex flex-col gap-2">
                {grupos.map((grupo) =>
                  grupo.itens.length === 1 ? (
                    <li key={grupo.chave}>{cartaoDoItem(grupo.itens[0]!)}</li>
                  ) : abertos.has(grupo.chave) ? (
                    <li key={grupo.chave}>
                      <div className="flex flex-col gap-2 rounded-md border border-dashed border-borda-forte p-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                          <p className="text-xs text-tinta-suave">
                            {grupo.itens.length} itens do mesmo e-mail, um por um
                          </p>
                          <Botao
                            tamanho="pequeno"
                            onClick={() => alternarGrupo(grupo)}
                            desabilitado={ocupado !== null}
                          >
                            Juntar de novo
                          </Botao>
                        </div>
                        {grupo.itens.map((item) => (
                          <div key={item.itemId}>{cartaoDoItem(item)}</div>
                        ))}
                      </div>
                    </li>
                  ) : (
                    <li key={grupo.chave}>{cartaoDoGrupo(grupo)}</li>
                  ),
                )}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/*
        A memória do setor fica DEPOIS da fila, nunca antes: o trabalho do dia
        vem primeiro. Aqui o contexto é o setor inteiro — a fila mistura
        categorias, e recortar por uma delas esconderia o aviso das outras.
      */}
      <NotasDoSetor />
    </div>
  )
}

/**
 * Os dados que a IA leu de um item, com "Copiar" em cada um (`A69`, 3B).
 *
 * Texto puro, como o servidor mandou (`textoParaExibir`): formatação invisível
 * aparece como "�", e o que se copia é o que se vê.
 */
function PainelDosDados({ painel, copiar }: { painel: PainelDeDados; copiar: (valor: string) => Promise<void> }) {
  return (
    <div className="mt-3 border-t border-borda pt-3">
      {painel.estado === 'carregando' ? (
        <p className="text-xs text-tinta-suave" role="status">
          Carregando os dados…
        </p>
      ) : painel.estado === 'erro' ? (
        <p className="text-xs text-tinta-suave" role="alert">
          {painel.mensagem}
        </p>
      ) : painel.dados.situacao === 'expurgado' ? (
        // Invariante 11: diz que saiu, e quando — não "nenhum dado", que
        // pareceria falha da IA.
        <p className="text-xs text-tinta-suave">
          Os dados que a IA leu deste item já saíram pelo prazo de retenção, em{' '}
          {new Date(painel.dados.expurgadoEm).toLocaleDateString('pt-BR')}.
        </p>
      ) : painel.dados.campos.length === 0 ? (
        <p className="text-xs text-tinta-suave">A IA não leu nenhum dado deste item. Confira no e-mail.</p>
      ) : (
        <dl className="flex flex-col gap-2">
          {painel.dados.campos.map((campo) => (
            <div key={campo.campo} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <dt className="text-xs text-tinta-suave">
                  {campo.rotulo}
                  {/* Nome que veio do e-mail, não da casa: à vista, para não se
                      passar por um campo nosso (revisão de segurança do #165). */}
                  {campo.conhecido ? null : <span className="ml-1.5 italic">· nome escrito no e-mail</span>}
                </dt>
                <dd className="numerico text-sm break-all select-all">{campo.valor}</dd>
              </div>
              <Botao tamanho="pequeno" onClick={() => void copiar(campo.valor)}>
                Copiar<span className="sr-only">{campo.conhecido ? ` ${campo.rotulo}` : ' este valor'}</span>
              </Botao>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
