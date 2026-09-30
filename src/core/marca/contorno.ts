/**
 * O contorno do "P" da marca — geometria analítica, não desenho.
 *
 * ═══ POR QUE ISTO É UM ARQUIVO DE DADOS, E NÃO UM SVG ═══
 *
 * A marca da SBP é um P grande **composto por dezenas de P's pequenos**. Essa
 * estrutura não é enfeite: é a própria identidade, e é o que permite tratá-la
 * como objeto em vez de imagem. Para isso, é preciso responder uma pergunta
 * milhões de vezes — *"este ponto está dentro do P?"* — e responder rápido.
 *
 * Um `<path>` com curvas de Bézier responderia mal: exigiria tesselar,
 * rasterizar ou trazer uma biblioteca de geometria. Descrevendo a letra como
 * **união e subtração de retângulos arredondados**, a resposta vira aritmética
 * de duas linhas, exata, sem alocação e testável em milissegundos.
 *
 * ═══ ESTE É O ÚNICO ARQUIVO QUE PRECISA MUDAR PELO OFICIAL ═══
 *
 * O arranjo dos P's, a física e o desenho não sabem nada sobre a forma da
 * letra: eles só perguntam `dentroDoP()`. Quando o SVG oficial da SBP estiver
 * disponível, troca-se a descrição aqui — ou substitui-se `dentroDoP` por um
 * teste contra o contorno real — e **nada mais no sistema muda**.
 *
 * É a mesma inversão que o dossiê do `img2threejs` identifica como o ativo
 * central daquele projeto: a representação intermediária é o produto, e o que
 * se desenha a partir dela é derivado, descartável e regerável.
 *
 * ═══ AS PROPORÇÕES ═══
 *
 * Medidas sobre a arte oficial (o logotipo do site da SBP, 136 × 163 px, onde
 * o P tem 72 × 89 px), convertidas para `0..LARGURA` por `0..ALTURA`:
 *
 * - haste estreita, com 18 das 80 unidades de largura;
 * - bojo nos dois terços de cima (66 de 100), com o lado direito bem redondo;
 * - contraforma GRANDE — mais da metade da largura da letra —, reta do lado
 *   da haste e redonda do lado de fora. Paredes finas em cima e embaixo, a da
 *   direita um pouco mais grossa.
 *
 * A primeira reconstrução errou justamente aqui: haste de um terço da letra e
 * um buraco oval pequeno. Com os P's pequenos por cima, a letra virava uma
 * mancha com um furo — e deixava de parecer a da SBP.
 */

export const LARGURA = 80
export const ALTURA = 100

/** Retângulo com raio por canto. Raio `0` é canto reto. */
interface RetanguloArredondado {
  readonly x: number
  readonly y: number
  readonly largura: number
  readonly altura: number
  readonly raioSuperiorEsquerdo: number
  readonly raioSuperiorDireito: number
  readonly raioInferiorDireito: number
  readonly raioInferiorEsquerdo: number
}

/**
 * A haste. Canto reto em cima e embaixo — ela é cortada pela borda do
 * logotipo, não arredondada.
 */
const HASTE: RetanguloArredondado = {
  x: 0,
  y: 0,
  largura: 18,
  altura: ALTURA,
  raioSuperiorEsquerdo: 0,
  raioSuperiorDireito: 0,
  raioInferiorDireito: 0,
  raioInferiorEsquerdo: 0,
}

/**
 * O bojo. Só os cantos da DIREITA são arredondados: os da esquerda encostam na
 * haste e desapareceriam sob ela — arredondá-los abriria uma fresta.
 */
const BOJO: RetanguloArredondado = {
  x: 0,
  y: 0,
  largura: 80,
  altura: 66,
  raioSuperiorEsquerdo: 0,
  raioSuperiorDireito: 26,
  raioInferiorDireito: 26,
  raioInferiorEsquerdo: 0,
}

/**
 * A contraforma — o vazado do P.
 *
 * Subtraída das duas formas acima. É ela que faz a letra ser um P e não um D
 * grosso, e é o detalhe que mais denuncia uma reconstrução malfeita: se ficar
 * redonda demais vira um "b" de fonte geométrica; quadrada demais, vira um
 * carimbo. Na arte, os cantos do lado da haste são quase retos e os de fora
 * acompanham a curva do bojo.
 */
const CONTRAFORMA: RetanguloArredondado = {
  x: 18,
  y: 15,
  largura: 42,
  altura: 36,
  raioSuperiorEsquerdo: 3,
  raioSuperiorDireito: 14,
  raioInferiorDireito: 14,
  raioInferiorEsquerdo: 3,
}

/**
 * Ponto dentro de um retângulo de cantos arredondados.
 *
 * Fora da faixa dos cantos é uma comparação de intervalo. Dentro dela, a
 * distância ao centro do arco. Sem `sqrt`: comparar quadrados dá a mesma
 * resposta e evita a raiz no laço mais quente do módulo.
 */
function dentroDoRetangulo(x: number, y: number, r: RetanguloArredondado): boolean {
  const esquerda = r.x
  const direita = r.x + r.largura
  const topo = r.y
  const base = r.y + r.altura

  if (x < esquerda || x > direita || y < topo || y > base) return false

  const raio = (() => {
    const naEsquerda = x < esquerda + Math.max(r.raioSuperiorEsquerdo, r.raioInferiorEsquerdo)
    const noTopo = y < topo + Math.max(r.raioSuperiorEsquerdo, r.raioSuperiorDireito)
    if (noTopo) return naEsquerda ? r.raioSuperiorEsquerdo : r.raioSuperiorDireito
    return naEsquerda ? r.raioInferiorEsquerdo : r.raioInferiorDireito
  })()

  if (raio <= 0) return true

  // Centro do arco do canto mais próximo.
  const centroX = x < esquerda + raio ? esquerda + raio : x > direita - raio ? direita - raio : x
  const centroY = y < topo + raio ? topo + raio : y > base - raio ? base - raio : y

  // Fora da zona de canto: já está dentro pelo teste de intervalo.
  if (centroX === x && centroY === y) return true

  const dx = x - centroX
  const dy = y - centroY
  return dx * dx + dy * dy <= raio * raio
}

/**
 * `true` quando o ponto está sobre a tinta do P.
 *
 * É a única pergunta que o resto do sistema faz sobre a forma da letra.
 * Trocar a marca é reescrever esta função — e mais nada.
 */
export function dentroDoP(x: number, y: number): boolean {
  const naLetra = dentroDoRetangulo(x, y, HASTE) || dentroDoRetangulo(x, y, BOJO)
  if (!naLetra) return false
  return !dentroDoRetangulo(x, y, CONTRAFORMA)
}

/**
 * Distância aproximada até a borda mais próxima da tinta.
 *
 * Usada para não deixar um P grande nascer encavalado na borda — sem isso, os
 * glifos maiores vazam para fora da letra e o contorno vira franja. A busca é
 * radial e para no primeiro raio que escapa: barata, e a precisão de um passo
 * é mais do que suficiente para decidir o tamanho de um glifo.
 */
export function folgaAteABorda(x: number, y: number, maxima: number): number {
  if (!dentroDoP(x, y)) return 0

  const PASSOS_ANGULARES = 8
  for (let raio = 1; raio <= maxima; raio += 1) {
    for (let i = 0; i < PASSOS_ANGULARES; i += 1) {
      const angulo = (i / PASSOS_ANGULARES) * Math.PI * 2
      if (!dentroDoP(x + Math.cos(angulo) * raio, y + Math.sin(angulo) * raio)) {
        return raio - 1
      }
    }
  }
  return maxima
}
