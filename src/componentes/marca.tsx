'use client'

import { useEffect, useRef } from 'react'

import { ALTURA, LARGURA } from '../core/marca/contorno'
import { PARTICULAS_DA_MARCA } from '../core/marca/especificacao'
import { assentou, criarEstado, passo, pulsar, type Ponteiro } from '../core/marca/fisica'

/**
 * A marca da SBP como objeto, não como imagem.
 *
 * ═══ A DIVISÃO DE TRABALHO ═══
 *
 * `core/marca/` decide TUDO: onde cada P nasce, quanto pesa, como reage. Este
 * arquivo só sabe duas coisas que o núcleo não pode saber — o que é um pixel e
 * o que é um elemento do DOM.
 *
 * ═══ REACT DESENHA UMA VEZ; O QUADRO É ESCRITO À MÃO ═══
 *
 * Os P's são renderizados uma única vez. A partir daí, o laço de animação
 * escreve `transform` direto nos elementos, por referência. Nada de estado do
 * React por quadro: uma centena de partículas a sessenta quadros por segundo
 * seriam seis mil re-renderizações por segundo, e o React não é — nem tenta
 * ser — um motor de animação.
 *
 * Só `transform` é tocado. É a única propriedade que o navegador anima sem
 * refazer layout, e é o que mantém isto barato até no celular.
 *
 * ═══ O LAÇO PARA ═══
 *
 * Quando o campo assenta e não há atividade, o `requestAnimationFrame` é
 * cancelado. Esta marca fica numa barra que a equipe deixa aberta o expediente
 * inteiro — um laço eterno gastaria bateria o dia todo para não mostrar nada.
 *
 * ═══ ACESSIBILIDADE NÃO É CAMADA POSTERIOR ═══
 *
 * - `prefers-reduced-motion` desliga a física INTEIRA, não a suaviza: quem
 *   pede menos movimento não quer movimento mais devagar.
 * - O SVG é `aria-hidden` e o nome acessível vem do texto ao lado. Para quem
 *   usa leitor de tela, a marca é decoração de um link que já se anuncia.
 * - `pointer: coarse` (dedo, não ponteiro) não recebe campo de repulsão: não
 *   há hover no toque, e reagir ao toque roubaria o gesto de rolagem.
 * - A cor é `currentColor`. A marca herda o tema claro e o escuro sem um
 *   segundo arquivo e sem uma linha de condicional.
 */

/** Escala do glifo em relação ao `tamanho` da partícula. Calibrado no olho. */
const ESCALA_DO_GLIFO = 1.42

/**
 * Abaixo desta altura, a marca não reage ao ponteiro.
 *
 * ═══ POR QUE CORTAR O EFEITO, E NÃO OS GLIFOS ═══
 *
 * A primeira ideia foi reduzir a quantidade de peças nas versões pequenas — o
 * "plano de LOD" que o dossiê descreve. Medido, ela se mostrou errada: os
 * glifos menores são justamente os da BORDA, e é a borda que define a
 * silhueta. Cortá-los deixa a letra mais leve e menos legível, que é o pior
 * dos dois mundos.
 *
 * O custo real nunca foi o número de nós — são algumas centenas, desenhados
 * uma vez. O custo é ESCREVER transformação neles sessenta vezes por segundo.
 *
 * Então o corte é no efeito: a 24 pixels a marca tem 17 de largura, e um campo
 * de repulsão nessa escala move as peças por frações de pixel — ninguém
 * percebe, e o navegador trabalha o expediente inteiro para isso. A marca da
 * barra fica parada, e o laço só acorda quando há trabalho de verdade em voo.
 *
 * A respiração do `ocupado` continua valendo em qualquer tamanho: ela é um
 * pulso COLETIVO, e movimento de conjunto se enxerga onde o de uma peça não.
 */
const ALTURA_MINIMA_PARA_PONTEIRO = 48

export interface MarcaProps {
  /** Altura em pixels. A largura sai da proporção do contorno. */
  readonly altura?: number
  /**
   * `true` enquanto o sistema está trabalhando.
   *
   * A marca respira — não é enfeite: substitui um indicador genérico por um
   * que É a identidade, e reflete um fato real (há requisição em voo), nunca
   * uma métrica inventada.
   */
  readonly ocupado?: boolean
  readonly className?: string
}

export function Marca({ altura = 26, ocupado = false, className }: MarcaProps) {
  const svg = useRef<SVGSVGElement>(null)
  const grupos = useRef<(SVGGElement | null)[]>([])
  // O estado do ponteiro vive em ref, não em estado do React: ele muda a cada
  // movimento do mouse, e re-renderizar a árvore a cada pixel seria absurdo.
  const ponteiro = useRef<Ponteiro>({ x: 0, y: 0, ativo: false })
  const ocupadoRef = useRef(ocupado)
  /**
   * Religa o laço de animação.
   *
   * Publicada pelo efeito principal para que o efeito de `ocupado` possa
   * acordar o campo sem remontar nada. Remontar o efeito principal a cada
   * mudança de `ocupado` recriaria o estado do campo, e a marca daria um salto
   * visível toda vez que uma requisição começasse.
   */
  const acordarRef = useRef<(() => void) | null>(null)
  // A altura vive em ref para o efeito principal — que monta uma vez só — poder
  // consultá-la sem se remontar quando ela muda.
  const alturaRef = useRef(altura)
  alturaRef.current = altura

  useEffect(() => {
    ocupadoRef.current = ocupado
  }, [ocupado])

  useEffect(() => {
    const elemento = svg.current
    if (!elemento) return

    // Quem pede menos movimento recebe a marca parada. Sem laço, sem ouvintes,
    // sem custo — e o SVG estático já está correto no DOM.
    const semMovimento = window.matchMedia('(prefers-reduced-motion: reduce)')
    const semPonteiroFino = window.matchMedia('(pointer: coarse)')
    if (semMovimento.matches) return

    const particulas = PARTICULAS_DA_MARCA
    const estado = criarEstado(particulas.length)

    let quadro = 0
    let instanteAnterior = 0
    let rodando = false
    let faseDaRespiracao = 0

    function escreverNoDom() {
      for (let i = 0; i < particulas.length; i += 1) {
        const g = grupos.current[i]
        if (!g) continue
        const dx = estado.deslocX[i]!
        const dy = estado.deslocY[i]!
        const p = particulas[i]!
        const giro = p.giro + estado.giroExtra[i]!
        // `rotate` do SVG aceita o centro como argumento — o glifo gira em
        // torno de si mesmo sem depender de `transform-origin`, que em SVG
        // tem comportamento diferente entre navegadores.
        g.setAttribute(
          'transform',
          `translate(${dx.toFixed(3)} ${dy.toFixed(3)}) rotate(${giro.toFixed(2)} ${p.x.toFixed(2)} ${p.y.toFixed(2)})`,
        )
      }
    }

    function laco(instante: number) {
      const dt = instanteAnterior === 0 ? 1 / 60 : (instante - instanteAnterior) / 1000
      instanteAnterior = instante

      // A respiração do "ocupado" é um pulso periódico e fraco, injetado no
      // MESMO campo — não uma animação paralela. Assim ela some sozinha quando
      // o trabalho termina, e nunca briga com o ponteiro.
      if (ocupadoRef.current) {
        faseDaRespiracao += dt
        if (faseDaRespiracao >= 1.15) {
          faseDaRespiracao = 0
          pulsar(estado, particulas, LARGURA * 0.42, ALTURA * 0.3, 26)
        }
      } else {
        faseDaRespiracao = 0
      }

      passo(estado, particulas, ponteiro.current, dt)
      escreverNoDom()

      // Para quando não há mais nada acontecendo. Volta a rodar no próximo
      // movimento do ponteiro ou na próxima requisição.
      if (assentou(estado) && !ponteiro.current.ativo && !ocupadoRef.current) {
        rodando = false
        instanteAnterior = 0
        return
      }
      quadro = requestAnimationFrame(laco)
    }

    function acordar() {
      if (rodando || semMovimento.matches) return
      rodando = true
      instanteAnterior = 0
      quadro = requestAnimationFrame(laco)
    }
    acordarRef.current = acordar

    /** Converte pixels da tela para as coordenadas do contorno. */
    function aoMover(evento: PointerEvent) {
      // Toque não tem "passar por cima": reagir ao dedo roubaria o gesto de
      // rolagem. E abaixo do tamanho mínimo o efeito é imperceptível — ver
      // `ALTURA_MINIMA_PARA_PONTEIRO`.
      if (semPonteiroFino.matches || alturaRef.current < ALTURA_MINIMA_PARA_PONTEIRO) return
      const caixa = elemento!.getBoundingClientRect()
      if (caixa.width === 0) return
      ponteiro.current = {
        x: ((evento.clientX - caixa.left) / caixa.width) * LARGURA,
        y: ((evento.clientY - caixa.top) / caixa.height) * ALTURA,
        ativo: true,
      }
      acordar()
    }

    function aoSair() {
      ponteiro.current = { ...ponteiro.current, ativo: false }
      acordar()
    }

    // Ouvir na JANELA, não no SVG: a marca tem 26px de altura e uma silhueta
    // recortada. Esperar o ponteiro entrar exatamente na tinta tornaria o
    // efeito quase inalcançável — o campo tem de sentir a aproximação.
    window.addEventListener('pointermove', aoMover, { passive: true })
    window.addEventListener('pointerleave', aoSair, { passive: true })

    // A preferência pode mudar com a aba aberta — o expediente inteiro, que é o
    // uso normal. Lida só na montagem, "reduzir movimento" ligado no meio do dia
    // não desligava nada até recarregar (revisão do PR #35). Ao ligar, o laço
    // para e as peças voltam ao lugar; `acordar` passa a recusar. Ao desligar, a
    // marca volta a reagir no próximo movimento do ponteiro.
    function aoMudarPreferencia() {
      if (!semMovimento.matches) return
      cancelAnimationFrame(quadro)
      rodando = false
      instanteAnterior = 0
      Object.assign(estado, criarEstado(particulas.length))
      escreverNoDom()
    }
    semMovimento.addEventListener('change', aoMudarPreferencia)

    // Um pulso na montagem: a marca se MONTA em vez de aparecer pronta.
    // Acontece uma vez por carregamento e dura menos de um segundo.
    //
    // Só nas versões grandes: a 24 pixels o movimento é imperceptível, e
    // acordar o laço em toda navegação para nada é o oposto do que a regra de
    // parar o laço existe para conseguir.
    if (alturaRef.current >= ALTURA_MINIMA_PARA_PONTEIRO) {
      pulsar(estado, particulas, LARGURA * 0.5, ALTURA * 0.45, 90)
      acordar()
    } else {
      escreverNoDom()
    }

    return () => {
      cancelAnimationFrame(quadro)
      acordarRef.current = null
      window.removeEventListener('pointermove', aoMover)
      window.removeEventListener('pointerleave', aoSair)
      semMovimento.removeEventListener('change', aoMudarPreferencia)
    }
  }, [])

  // Religa o laço quando o sistema começa a trabalhar. Só isso — o efeito
  // principal continua montado, e o campo mantém o estado que tinha.
  useEffect(() => {
    if (ocupado) acordarRef.current?.()
  }, [ocupado])

  const largura = (altura * LARGURA) / ALTURA

  return (
    <svg
      ref={svg}
      width={largura}
      height={altura}
      viewBox={`0 0 ${LARGURA} ${ALTURA}`}
      // Decoração: quem lê por áudio recebe o nome do link ao lado, não uma
      // descrição de cem letras P.
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ overflow: 'visible', color: 'currentColor' }}
    >
      {PARTICULAS_DA_MARCA.map((p, i) => (
        // Dois elementos por peça, e a separação é o que torna isto um objeto:
        // o <g> é o PIVÔ — o alvo da animação, movido e girado — e o <text> é
        // o glifo, que nunca é tocado pelo laço. É a mesma divisão que o
        // dossiê descreve como o contrato de runtime do img2threejs.
        <g
          key={p.id}
          ref={(no) => {
            grupos.current[i] = no
          }}
          // O giro de repouso já vem no atributo: sem movimento (ou antes do
          // primeiro quadro) a marca já está correta, não achatada.
          transform={`translate(0 0) rotate(${p.giro.toFixed(2)} ${p.x.toFixed(2)} ${p.y.toFixed(2)})`}
        >
          <text
            x={p.x}
            y={p.y}
            fontSize={p.tamanho * ESCALA_DO_GLIFO}
            fontWeight={p.peso}
            fill="currentColor"
            textAnchor="middle"
            dominantBaseline="central"
            style={{ fontFamily: 'var(--font-sans)' }}
          >
            P
          </text>
        </g>
      ))}
    </svg>
  )
}
