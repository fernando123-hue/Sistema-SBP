'use client'

import { useCallback, useEffect, useState } from 'react'

import { api, mensagemDoErro } from '../../componentes/api'
import {
  Aviso,
  Botao,
  CabecalhoDeSecao,
  Cartao,
  Carregando,
  Selo,
  Vazio,
} from '../../componentes/matrizes'
import { NotasDoSetor } from '../../componentes/notas'
import { hojeIso } from '../../core/util/datas'

interface ItemDaFila {
  itemId: string
  titulo: string
  categoriaCodigo: string
  categoriaRotulo: string
  status: string
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

type AcaoEmCurso = { itemId: string; acao: 'concluir' | 'devolver' | 'transferir' } | null

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

  const carregar = useCallback(async () => {
    try {
      setItens(await api.buscar<ItemDaFila[]>('/fila'))
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

  async function concluir(item: ItemDaFila) {
    setOcupado({ itemId: item.itemId, acao: 'concluir' })
    setErro(null)
    try {
      await api.enviar(`/itens/${item.itemId}/concluir`)
      setItens((atual) => (atual ?? []).filter((linha) => linha.itemId !== item.itemId))
    } catch (causa) {
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
      setItens((atual) => (atual ?? []).filter((linha) => linha.itemId !== item.itemId))
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
      setItens((atual) => (atual ?? []).filter((linha) => linha.itemId !== item.itemId))
      setSaindo(null)
    } catch (causa) {
      setErro(mensagemDoErro(causa))
    } finally {
      setOcupado(null)
    }
  }

  const porCategoria = new Map<string, ItemDaFila[]>()
  for (const item of itens ?? []) {
    porCategoria.set(item.categoriaRotulo, [...(porCategoria.get(item.categoriaRotulo) ?? []), item])
  }

  return (
    <div className="flex flex-col gap-5">
      <CabecalhoDeSecao
        titulo="Minha fila"
        descricao={
          itens === null
            ? 'Carregando…'
            : `${itens.length} ${itens.length === 1 ? 'item' : 'itens'} para trabalhar. O que não terminar hoje continua seu amanhã.`
        }
      />

      {erro ? <Aviso>{erro}</Aviso> : null}

      {itens === null ? (
        <Carregando />
      ) : itens.length === 0 ? (
        <Vazio titulo="Fila vazia" descricao="Nada atribuído a você no momento." />
      ) : (
        <div className="flex flex-col gap-5">
          {[...porCategoria.entries()].map(([categoria, lista]) => (
            <section key={categoria}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                {categoria}
                <Selo>{lista.length}</Selo>
              </h2>

              <ul className="flex flex-col gap-2">
                {lista.map((item) => (
                  <li key={item.itemId}>
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
                        <span
                          className="numerico text-xs whitespace-nowrap text-tinta-fraca"
                          title="Entrou no sistema nesta data. A fila mostra o mais antigo primeiro."
                        >
                          {quando(item.criadoEm)}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
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
                          onClick={() =>
                            confirmandoConclusao === item.itemId
                              ? void concluir(item)
                              : setConfirmandoConclusao(item.itemId)
                          }
                          desabilitado={ocupado !== null}
                        >
                          {ocupado?.itemId === item.itemId && ocupado.acao === 'concluir'
                            ? 'concluindo…'
                            : confirmandoConclusao === item.itemId
                              ? 'Confirmar: concluir'
                              : 'Concluir'}
                        </Botao>
                      </div>

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
                  </li>
                ))}
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
