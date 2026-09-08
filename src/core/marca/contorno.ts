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
 * Espaço normalizado de `0..LARGURA` por `0..ALTURA`, medido sobre a arte:
 * haste vertical cheia à esquerda, bojo ocupando os 60% superiores com o lado
 * direito arredondado, e a contraforma (o vazado) como um quadrado de cantos
 * suaves. A espessura do traço superior é levemente menor que a do inferior —
 * correção óptica que existe na marca e que uma reconstrução ingênua perderia.
 */

export const LARGURA = 70
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
  largura: 24,
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
  largura: 70,
  altura: 58,
  raioSuperiorEsquerdo: 0,
  raioSuperiorDireito: 21,
  raioInferiorDireito: 21,
  raioInferiorEsquerdo: 0,
}

/**
 * A contraforma — o vazado do P.
 *
 * Subtraída das duas formas acima. É ela que faz a letra ser um P e não um D
 * grosso, e é o detalhe que mais denuncia uma reconstrução malfeita: se ficar
 * redonda demais vira um "b" de fonte geométrica; quadrada demais, vira um
 * carimbo.
 */
const CONTRAFORMA: RetanguloArredondado = {
  x: 32,
  y: 15,
  largura: 19,
  altura: 25,
  raioSuperiorEsquerdo: 7,
  raioSuperiorDireito: 7,
  raioInferiorDireito: 7,
  raioInferiorEsquerdo: 7,
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
