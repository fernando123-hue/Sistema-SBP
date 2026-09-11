'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { api, mensagemDoErro } from './api'
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

export function Assistente({ papel }: { papel: string }) {
  const [aberto, setAberto] = useState(false)
  const [pergunta, setPergunta] = useState('')
  const [trocas, setTrocas] = useState<Troca[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const campo = useRef<HTMLInputElement>(null)
  const gatilho = useRef<HTMLButtonElement>(null)
  const fimDaConversa = useRef<HTMLDivElement>(null)

  // Foco vai para o campo ao abrir e VOLTA para o botão ao fechar. Sem o
  // retorno, quem navega por teclado perde a posição e cai no começo da página.
  useEffect(() => {
    if (aberto) campo.current?.focus()
    else gatilho.current?.focus()
  }, [aberto])

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
      </button>
    )
  }

  return (
    <div
      role="dialog"
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
          className="-mr-1 -mt-1 rounded-md px-2 py-1 text-sm text-tinta-suave hover:bg-papel-fundo hover:text-tinta"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3" aria-live="polite" aria-busy={carregando}>
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
