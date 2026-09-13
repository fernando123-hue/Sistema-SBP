'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { AvisoParaATela } from '../core/aviso-do-gestor'
import { api, mensagemDoErro } from './api'
import { AvisoDoDia } from './aviso-do-gestor'
import { Botao, juntar } from './matrizes'

/**
 * Painel de ajuda.
 *
 * ═══ O QUE ESTA TELA PROMETE, E O QUE ELA NÃO PROMETE ═══
 *
 * Ela responde dúvidas sobre COMO O SISTEMA FUNCIONA. Não consulta demanda
 * específica, não fala de associado, não vê o trabalho de outra pessoa e não
 * executa nada. Isso está escrito na própria tela, em uma linha, porque um
 * assistente que não diz o que não faz é um assistente que será perguntado
 * sobre o que não pode responder — e a decepção acontece uma vez por pessoa.
 *
 * ═══ DECISÕES DE INTERFACE QUE VALEM REGISTRO ═══
 *
 * **A pergunta não é perdida quando a resposta falha.** O campo só é limpo
 * depois de uma resposta que chegou. Perder o que a pessoa digitou porque a
 * rede oscilou é o tipo de detalhe que faz alguém desistir do recurso.
 *
 * **Perguntas prontas.** Quem nunca usou um assistente não sabe o que
 * perguntar, e campo em branco não ensina. As três sugestões mudam conforme o
 * papel, e são a diferença entre um recurso usado e um recurso ignorado.
 *
 * **A origem da resposta aparece.** Quando quem responde é a busca no manual,
 * a tela diz. O sistema nunca finge que um modelo respondeu.
 *
 * **A conversa não sai daqui.** O histórico vive no estado do componente:
 * fechou a aba, acabou. Nada é gravado, nem no navegador nem no servidor — o
 * servidor registra que houve pergunta, jamais o texto dela.
 */

interface Troca {
  pergunta: string
  resposta: string
  respondida: boolean
  telaSugerida: string | null
  origem: string
}

interface RespostaDaApi {
  resposta: string
  respondida: boolean
  telaSugerida: string | null
  origem: string
}

const ROTULO_DA_TELA: Record<string, string> = {
  '/distribuicao': 'Distribuição',
  '/revisao': 'Revisão',
  '/caixa': 'Caixa de entrada',
  '/fila': 'Minha fila',
  '/painel': 'Painel',
  '/acesso': 'Acesso',
}

/** Perguntas prontas por papel. Campo em branco não ensina ninguém a perguntar. */
function sugestoes(papel: string): readonly string[] {
  if (papel === 'colaborador') {
    return [
      'Como devolvo um item que não é comigo?',
      'O que significa o percentual de confiança?',
      'Como o sistema decide quem recebe o quê?',
    ]
  }
  if (papel === 'gestor') {
    return [
      'Como distribuo o dia?',
      'Como cadastro uma pessoa nova?',
      'Por que um item foi para revisão?',
    ]
  }
  return [
    'Como distribuo o dia?',
    'Por que um item foi para revisão?',
    'Qual a diferença entre escala e afastamento?',
  ]
}

/** De quanto em quanto tempo a tela pergunta se o aviso do dia mudou. */
const MINUTOS_ENTRE_CONFERENCIAS_DO_AVISO = 15

/** Identidade de um conjunto de chaves, sem depender da ordem. */
function assinaturaDas(chaves: readonly string[]): string {
  return [...chaves].sort().join('|')
}

export function Assistente({ papel }: { papel: string }) {
  const [aberto, setAberto] = useState(false)
  const [pergunta, setPergunta] = useState('')
  const [trocas, setTrocas] = useState<Troca[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  /** Só existe para gestor (`A17`). Montado no servidor, sem IA. */
  const [aviso, setAviso] = useState<AvisoParaATela | null>(null)
  const [erroDoAviso, setErroDoAviso] = useState<string | null>(null)
  /** As chaves que esta tela já confirmou ao servidor como vistas. */
  const [confirmado, setConfirmado] = useState<string | null>(null)

  const campo = useRef<HTMLInputElement>(null)
  const gatilho = useRef<HTMLButtonElement>(null)
  const fimDaConversa = useRef<HTMLDivElement>(null)
  /** O painel abriu sozinho por causa do aviso, e não por um clique. */
  const abertoPeloAviso = useRef(false)

  // Foco vai para o campo ao abrir e VOLTA para o botão ao fechar. Sem o
  // retorno, quem navega por teclado perde a posição e cai no começo da página.
  //
  // Exceto quando o painel abre SOZINHO com o aviso do dia: puxar o foco para
  // o campo no carregamento da página tiraria a pessoa de onde ela estava, e o
  // leitor de tela anunciaria um campo que ninguém pediu.
  useEffect(() => {
    if (aberto) {
      if (abertoPeloAviso.current) {
        abertoPeloAviso.current = false
        return
      }
      campo.current?.focus()
    } else gatilho.current?.focus()
  }, [aberto])

  const confirmarVisto = useCallback(async (dados: AvisoParaATela) => {
    try {
      await api.enviar('/assistente/aviso', { chaves: dados.chaves })
      setConfirmado(assinaturaDas(dados.chaves))
    } catch (causa) {
      setErroDoAviso(mensagemDoErro(causa))
    }
  }, [])

  // `A17` e `A39(e)`: o quadro abre SOZINHO só na primeira vez do dia — abrir a
  // cada troca de tela ensinaria a fechar sem ler. Depois, o sistema confere de
  // tempos em tempos, e o que mudou (inclusive a troca de uma pessoa por outra)
  // acende a bolinha até ela olhar. Quem guarda o "já vi" é o servidor, então
  // vale para o dia inteiro, em qualquer computador.
  useEffect(() => {
    if (papel !== 'gestor') return
    let vigente = true

    async function buscar(): Promise<void> {
      try {
        const dados = await api.buscar<AvisoParaATela>('/assistente/aviso')
        if (!vigente) return
        setAviso(dados)
        setErroDoAviso(null)
        if (!dados.primeiraVezHoje) return

        if (dados.vazio) {
          // Nada a mostrar agora, mas a primeira olhada do dia fica marcada: o
          // que aparecer mais tarde vira bolinha, e não um quadro abrindo no
          // meio do trabalho.
          void confirmarVisto(dados)
          return
        }
        abertoPeloAviso.current = true
        setAberto(true)
      } catch (causa) {
        // A ajuda continua funcionando, e a falha aparece dentro do painel — não
        // some calada.
        if (vigente) setErroDoAviso(mensagemDoErro(causa))
      }
    }

    void buscar()
    const temporizador = window.setInterval(() => void buscar(), MINUTOS_ENTRE_CONFERENCIAS_DO_AVISO * 60_000)

    return () => {
      vigente = false
      window.clearInterval(temporizador)
    }
  }, [papel, confirmarVisto])

  const temNovidade =
    aviso !== null &&
    ((aviso.primeiraVezHoje && !aviso.vazio) ||
      aviso.novidades.entraram.length > 0 ||
      aviso.novidades.sairam.length > 0) &&
    assinaturaDas(aviso.chaves) !== confirmado

  const temAviso =
    aviso !== null && (!aviso.vazio || aviso.novidades.entraram.length > 0 || aviso.novidades.sairam.length > 0)

  // Painel aberto com novidade na tela: ela viu. O bloco "mudou desde a última
  // vez" continua visível até a próxima conferência — confirmar não o apaga
  // enquanto ela lê.
  useEffect(() => {
    if (!aberto || aviso === null || !temNovidade) return
    void confirmarVisto(aviso)
  }, [aberto, aviso, temNovidade, confirmarVisto])

  useEffect(() => {
    if (!aberto) return
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') setAberto(false)
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [aberto])

  useEffect(() => {
    fimDaConversa.current?.scrollIntoView({ block: 'end' })
  }, [trocas, carregando])

  const perguntar = useCallback(
    async (texto: string) => {
      const limpo = texto.trim()
      // Recusa o clique repetido: sem isto, dois cliques rápidos gastam duas
      // chamadas pagas ao modelo e devolvem a mesma resposta duas vezes.
      if (limpo.length < 3 || carregando) return

      setCarregando(true)
      setErro(null)
      try {
        const dados = await api.enviar<RespostaDaApi>('/assistente', { pergunta: limpo })
        setTrocas((anteriores) => [...anteriores, { pergunta: limpo, ...dados }])
        // Só limpa DEPOIS de uma resposta que chegou.
        setPergunta('')
      } catch (causa) {
        setErro(mensagemDoErro(causa))
      } finally {
        setCarregando(false)
      }
    },
    [carregando],
  )

  // ═══ O GATILHO MORA NA BARRA, NÃO FLUTUANDO SOBRE A PÁGINA ═══
  //
  // A primeira versão era um botão flutuante no canto inferior direito, e a
  // verificação na tela mostrou o problema na hora: ele cobria o botão
  // "Anotar" da memória do setor, na Distribuição. Folga no rodapé não
  // resolve — um elemento `fixed` fica sobre o que estiver naquele canto em
  // QUALQUER posição de rolagem, e sempre haverá alguma tela em que aquele
  // canto é um botão. Além disso, não há mais nada flutuante neste sistema:
  // um único elemento fora do fluxo destoaria do resto.
  if (!aberto) {
    return (
      <button
        ref={gatilho}
        onClick={() => setAberto(true)}
        aria-expanded={false}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-borda px-2.5 py-1 text-xs font-medium text-tinta-suave transition-colors hover:bg-papel-fundo hover:text-tinta"
      >
        <span aria-hidden="true">?</span>
        Ajuda
        {/* Acende só com NOVIDADE (`A39(e)`): bolinha sempre acesa deixa de ser notada. */}
        {temNovidade ? (
          <>
            <span aria-hidden="true" className="size-2 rounded-full bg-atencao" />
            <span className="sr-only">(há novidade no aviso do dia)</span>
          </>
        ) : null}
      </button>
    )
  }

  return (
    // `region`, e não `dialog`: o painel é deliberadamente NÃO modal — a página
    // atrás continua usável, e Tab sai dele. Anunciar `dialog` sem `aria-modal`
    // nem foco retido prometia ao leitor de tela um comportamento que não
    // existe. Foco ao abrir, retorno ao fechar e Escape continuam valendo.
    // Revisão do PR #35.
    <div
      role="region"
      aria-label="Ajuda sobre o sistema"
      className="fixed inset-x-0 bottom-0 z-40 flex max-h-[85dvh] flex-col border-t border-borda bg-papel shadow-2xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:max-h-[min(32rem,85dvh)] sm:w-[26rem] sm:rounded-[var(--radius-cartao)] sm:border"
    >
      <div className="flex items-start justify-between gap-3 border-b border-borda px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Ajuda</h2>
          <p className="mt-0.5 text-xs text-tinta-suave">
            Tiro dúvidas sobre como o sistema funciona. Não consulto demandas nem faço nada por você.
          </p>
        </div>
        <button
          onClick={() => setAberto(false)}
          aria-label="Fechar ajuda"
          className="-mr-1 -mt-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-sm text-tinta-suave hover:bg-papel-fundo hover:text-tinta sm:min-h-9 sm:min-w-9"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3" aria-live="polite" aria-busy={carregando}>
        {temAviso ? <AvisoDoDia aviso={aviso} /> : null}
        {erroDoAviso ? (
          <p className="mb-4 rounded-md border border-alerta/40 bg-alerta-claro px-3 py-2 text-xs text-alerta">
            Não foi possível montar o aviso do dia: {erroDoAviso}
          </p>
        ) : null}

        {trocas.length === 0 && !carregando ? (
          <div>
            <p className="text-sm text-tinta-suave">Sobre o que você quer saber?</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {sugestoes(papel).map((sugestao) => (
                <li key={sugestao}>
                  <button
                    onClick={() => void perguntar(sugestao)}
                    className="w-full rounded-md border border-borda px-3 py-2 text-left text-sm transition-colors hover:border-borda-forte hover:bg-papel-fundo"
                  >
                    {sugestao}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <ul className="flex flex-col gap-4">
          {trocas.map((troca, indice) => (
            <li key={`${indice}-${troca.pergunta}`}>
              <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-acento-claro px-3 py-2 text-sm text-acento-escuro">
                {troca.pergunta}
              </p>
              <div
                className={juntar(
                  'mt-2 w-fit max-w-[92%] rounded-2xl rounded-bl-sm px-3 py-2 text-sm whitespace-pre-line',
                  troca.respondida ? 'bg-papel-fundo' : 'border border-atencao/40 bg-atencao-claro text-atencao',
                )}
              >
                {troca.resposta}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {troca.telaSugerida ? (
                  <a
                    href={troca.telaSugerida}
                    className="inline-flex min-h-9 items-center rounded-md border border-borda-forte px-2.5 text-xs font-medium hover:bg-papel-fundo"
                  >
                    Ir para {ROTULO_DA_TELA[troca.telaSugerida] ?? troca.telaSugerida}
                  </a>
                ) : null}
                {/* Quem respondeu aparece sempre. O sistema não finge que um modelo
                    respondeu quando quem respondeu foi a busca no manual. */}
                <span className="text-xs text-tinta-fraca">
                  {troca.origem === 'busca' ? 'resposta tirada do manual' : `resposta gerada · ${troca.origem}`}
                </span>
              </div>
            </li>
          ))}
        </ul>

        {carregando ? (
          <p role="status" className="mt-3 text-sm text-tinta-suave">
            Consultando…
          </p>
        ) : null}

        {erro ? (
          <div role="alert" className="mt-3 rounded-md border border-alerta/40 bg-alerta-claro px-3 py-2 text-sm text-alerta">
            {erro}
            <span className="mt-1 block text-xs">Sua pergunta continua escrita abaixo — é só tentar de novo.</span>
          </div>
        ) : null}

        <div ref={fimDaConversa} />
      </div>

      <form
        onSubmit={(evento) => {
          evento.preventDefault()
          void perguntar(pergunta)
        }}
        className="flex items-center gap-2 border-t border-borda px-4 py-3"
      >
        <label htmlFor="pergunta-ao-assistente" className="sr-only">
          Sua pergunta
        </label>
        <input
          id="pergunta-ao-assistente"
          ref={campo}
          value={pergunta}
          onChange={(evento) => setPergunta(evento.target.value)}
          // O mesmo teto do esquema no servidor. Ele recusaria de qualquer
          // jeito; o atributo evita que a pessoa escreva 900 caracteres para
          // descobrir isso só ao enviar.
          maxLength={500}
          placeholder="Escreva sua dúvida…"
          autoComplete="off"
          className="min-h-11 flex-1 rounded-md border border-borda-forte bg-papel px-3 text-sm outline-none focus:border-acento"
        />
        <Botao tipo="submit" variante="principal" desabilitado={carregando || pergunta.trim().length < 3}>
          Enviar
        </Botao>
      </form>
    </div>
  )
}
