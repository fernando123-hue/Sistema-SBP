import type { ParticulaDaMarca } from './especificacao'

/**
 * A física da marca — mola amortecida com massa, sem DOM e sem relógio.
 *
 * ═══ POR QUE FÍSICA, E NÃO TRANSIÇÃO CSS ═══
 *
 * Uma `transition` faz o glifo *ir* de um ponto ao outro. Uma mola faz ele
 * *ter inércia*: passa do ponto, volta, oscila e assenta. A diferença é a que
 * existe entre um elemento animado e um objeto — e o pedido era um objeto.
 *
 * O detalhe que sustenta a ilusão é a MASSA. Cada P pequeno pesa conforme o
 * próprio tamanho, então o ponteiro espalha os miúdos primeiro e os graúdos
 * quase não cedem. Sem isso, o campo inteiro se move em bloco e a leitura vira
 * "imagem sendo distorcida" em vez de "muitas peças reagindo".
 *
 * ═══ POR QUE ESTE ARQUIVO ESTÁ EM `core/` ═══
 *
 * Não importa React, não importa Next, não lê `performance.now()` e não sabe o
 * que é um pixel de tela: recebe o passo de tempo como argumento. É domínio
 * puro pelo mesmo critério do resto de `core/` — e, como o resto, dá para
 * testar em milissegundos, sem navegador.
 *
 * O dossiê do `img2threejs` chama isso de "a IR nunca importa o motor". Aqui a
 * regra já existia com outro nome: as setas apontam só para dentro.
 *
 * ═══ POR QUE MUTAÇÃO, DELIBERADAMENTE ═══
 *
 * `passo` reescreve os vetores recebidos em vez de devolver novos. É o laço
 * mais quente do módulo — sessenta vezes por segundo sobre uma centena de
 * partículas — e alocar seis arrays por quadro produziria lixo constante para
 * o coletor, num sistema que roda o dia inteiro numa aba aberta.
 *
 * A função continua sendo previsível e testável: mesma entrada, mesma saída,
 * sem I/O. O estado é do chamador; este módulo só o avança.
 */

/**
 * Estado mutável do campo. Vetores paralelos, indexados junto com as partículas.
 *
 * Vetores paralelos e não uma lista de objetos: são leituras sequenciais no
 * laço, e a forma importa mais aqui do que a elegância da estrutura.
 */
export interface EstadoDoCampo {
  /** Deslocamento em relação ao repouso. Zero = a marca está montada. */
  readonly deslocX: Float32Array
  readonly deslocY: Float32Array
  readonly velX: Float32Array
  readonly velY: Float32Array
  /** Giro EXTRA, somado ao giro de repouso da partícula. */
  readonly giroExtra: Float32Array
  readonly giroVel: Float32Array
}

export function criarEstado(quantidade: number): EstadoDoCampo {
  return {
    deslocX: new Float32Array(quantidade),
    deslocY: new Float32Array(quantidade),
    velX: new Float32Array(quantidade),
    velY: new Float32Array(quantidade),
    giroExtra: new Float32Array(quantidade),
    giroVel: new Float32Array(quantidade),
  }
}

export interface Ponteiro {
  readonly x: number
  readonly y: number
  /** `false` quando o ponteiro saiu: o campo volta ao repouso sozinho. */
  readonly ativo: boolean
}

/** Rigidez da mola de volta ao repouso. Mais alto, mais rápido e mais seco. */
const RIGIDEZ = 120
/**
 * Amortecimento.
 *
 * Calibrado logo abaixo do crítico: assenta rápido, com UMA oscilação de
 * sobra. Abaixo disso vira gelatina — e gelatina numa barra de navegação que
 * a pessoa olha o dia inteiro cansa em uma tarde.
 */
const AMORTECIMENTO = 14

/** Força do campo do ponteiro. */
const REPULSAO = 620
/** Raio de influência, em unidades do contorno. */
const ALCANCE = 22

/** Teto de deslocamento. A marca deforma; nunca se desmancha. */
const DESLOCAMENTO_MAXIMO = 9

/** Quanto o deslocamento vira giro. É o que faz o glifo parecer empurrado, não transportado. */
const GIRO_POR_DESLOCAMENTO = 3.2
const RIGIDEZ_DO_GIRO = 90
const AMORTECIMENTO_DO_GIRO = 12

/**
 * Massa a partir do tamanho.
 *
 * Quadrática porque a percepção de peso segue a ÁREA do glifo, não a altura.
 * Com massa linear os grandes ainda pareciam leves demais e o campo todo se
 * movia junto.
 */
function massaDe(tamanho: number): number {
  return tamanho * tamanho * 0.09
}

/**
 * Avança o campo em `dt` segundos.
 *
 * `dt` vem de fora, e é por isso que o teste consegue simular dois segundos de
 * repouso sem esperar dois segundos.
 */
export function passo(
  estado: EstadoDoCampo,
  particulas: readonly ParticulaDaMarca[],
  ponteiro: Ponteiro,
  dt: number,
): void {
  // Passo grande (aba que ficou em segundo plano e voltou) explodiria a
  // integração explícita. Limitar é mais honesto que fingir que não aconteceu:
  // a marca reassenta um pouco mais devagar, e nada estoura.
  const passoSeguro = Math.min(dt, 1 / 30)
  const alcanceAoQuadrado = ALCANCE * ALCANCE

  for (let i = 0; i < particulas.length; i += 1) {
    const p = particulas[i]!
    const massa = massaDe(p.tamanho)

    // Posição ATUAL: repouso mais deslocamento. O campo do ponteiro age sobre
    // onde a peça está agora, não sobre onde ela nasceu — sem isso, arrastar o
    // ponteiro devagar produz um empurrão que não acompanha a peça.
    const x = p.x + estado.deslocX[i]!
    const y = p.y + estado.deslocY[i]!

    let forcaX = 0
    let forcaY = 0

    if (ponteiro.ativo) {
      const dx = x - ponteiro.x
      const dy = y - ponteiro.y
      const distanciaAoQuadrado = dx * dx + dy * dy

      if (distanciaAoQuadrado < alcanceAoQuadrado) {
        const distancia = Math.sqrt(distanciaAoQuadrado)

        // ═══ A PARTÍCULA EXATAMENTE SOB O PONTEIRO ═══
        //
        // Num campo de repulsão a direção é indefinida em distância zero. A
        // versão anterior pulava esses casos, e o efeito visual era o pior
        // possível: de todas as peças, a única parada era justamente a que
        // está debaixo do cursor — o centro do buraco ficava cheio.
        //
        // A direção de fuga vem do GIRO de repouso da partícula, que já é um
        // número estável e distinto por peça. Assim a peça participa, sempre
        // pelo mesmo lado, sem sorteio em tempo de execução e sem descontinuidade.
        const [direcaoX, direcaoY] =
          distancia > 0.01
            ? [dx / distancia, dy / distancia]
            : [Math.cos((p.giro * Math.PI) / 180), Math.sin((p.giro * Math.PI) / 180)]

        // Queda quadrática suave: 1 no centro, 0 na borda do alcance. Sem
        // descontinuidade, então nenhum glifo "salta" ao entrar no campo.
        const queda = 1 - distancia / ALCANCE
        const intensidade = (REPULSAO * queda * queda) / massa
        forcaX += direcaoX * intensidade
        forcaY += direcaoY * intensidade
      }
    }

    // Mola de volta ao repouso, sempre ativa — é ela que garante que a marca
    // SEMPRE volta a ser a marca, aconteça o que acontecer com o ponteiro.
    forcaX += -RIGIDEZ * estado.deslocX[i]!
    forcaY += -RIGIDEZ * estado.deslocY[i]!
    forcaX += -AMORTECIMENTO * estado.velX[i]!
    forcaY += -AMORTECIMENTO * estado.velY[i]!

    estado.velX[i]! += forcaX * passoSeguro
    estado.velY[i]! += forcaY * passoSeguro

    let novoX = estado.deslocX[i]! + estado.velX[i]! * passoSeguro
    let novoY = estado.deslocY[i]! + estado.velY[i]! * passoSeguro

    // Teto de deslocamento, com a velocidade zerada na direção em que bateu.
    // Sem zerar, a peça fica raspando no limite e treme.
    const distanciaDoRepouso = Math.hypot(novoX, novoY)
    if (distanciaDoRepouso > DESLOCAMENTO_MAXIMO) {
      const escala = DESLOCAMENTO_MAXIMO / distanciaDoRepouso
      novoX *= escala
      novoY *= escala
      estado.velX[i]! *= 0.5
      estado.velY[i]! *= 0.5
    }

    estado.deslocX[i]! = novoX
    estado.deslocY[i]! = novoY

    // O giro persegue o deslocamento horizontal, com mola própria: a peça
    // parece girar POR ter sido empurrada, e não girar sozinha.
    const giroAlvo = novoX * GIRO_POR_DESLOCAMENTO
    const forcaDoGiro =
      -RIGIDEZ_DO_GIRO * (estado.giroExtra[i]! - giroAlvo) -
      AMORTECIMENTO_DO_GIRO * estado.giroVel[i]!
    estado.giroVel[i]! += forcaDoGiro * passoSeguro
    estado.giroExtra[i]! += estado.giroVel[i]! * passoSeguro
  }
}

/**
 * `true` quando o campo assentou e não vale mais gastar quadro.
 *
 * Existe para o laço de animação PARAR. Uma marca que mantém `requestAnimationFrame`
 * vivo para sempre custa bateria o dia inteiro numa aba que fica aberta o
 * expediente inteiro — e não entrega nada enquanto ninguém está interagindo.
 */
export function assentou(estado: EstadoDoCampo): boolean {
  const LIMIAR_DE_POSICAO = 0.01
  const LIMIAR_DE_VELOCIDADE = 0.05

  for (let i = 0; i < estado.deslocX.length; i += 1) {
    if (Math.abs(estado.deslocX[i]!) > LIMIAR_DE_POSICAO) return false
    if (Math.abs(estado.deslocY[i]!) > LIMIAR_DE_POSICAO) return false
    if (Math.abs(estado.velX[i]!) > LIMIAR_DE_VELOCIDADE) return false
    if (Math.abs(estado.velY[i]!) > LIMIAR_DE_VELOCIDADE) return false
    if (Math.abs(estado.giroExtra[i]!) > LIMIAR_DE_POSICAO) return false
  }
  return true
}

/**
 * Empurra o campo inteiro para fora, a partir de um ponto.
 *
 * É o pulso — usado quando o sistema quer que a marca REAJA a um fato, não ao
 * ponteiro. Não desenha nada e não decide quando acontece: só injeta energia.
 */
export function pulsar(
  estado: EstadoDoCampo,
  particulas: readonly ParticulaDaMarca[],
  origemX: number,
  origemY: number,
  forca: number,
): void {
  for (let i = 0; i < particulas.length; i += 1) {
    const p = particulas[i]!
    const dx = p.x + estado.deslocX[i]! - origemX
    const dy = p.y + estado.deslocY[i]! - origemY
    const distancia = Math.hypot(dx, dy) || 0.0001
    const intensidade = forca / massaDe(p.tamanho)
    estado.velX[i]! += (dx / distancia) * intensidade
    estado.velY[i]! += (dy / distancia) * intensidade
  }
}
