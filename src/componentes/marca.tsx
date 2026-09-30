/**
 * O logotipo da SBP — a arte oficial, como imagem.
 *
 * ═══ POR QUE IMAGEM, E NÃO UMA RECONSTRUÇÃO ═══
 *
 * Até 30/09 o P era desenhado em código: um contorno analítico, dezenas de P's
 * pequenos sorteados com semente fixa e uma física de mola que reagia ao
 * ponteiro (`A16`, `A65`). Comparado ampliado com a arte oficial, nunca ficou
 * igual — a arte mistura caligrafias diferentes em cada P pequeno, e cada
 * ajuste chegava mais perto sem chegar. Decisão do dono (`A66`): usar a arte
 * original. Identidade visual não se aproxima; ou é a marca, ou não é.
 *
 * O arquivo é `public/marca-sbp.png`, 136 × 163, tirado da arte que o dono
 * mandou. Só os pixels de borda que eram resto do recorte da página (duas
 * linhas cinza em cima, uma linha embaixo, uma coluna branca à direita)
 * foram repintados no azul do próprio logotipo. Quando houver o SVG oficial, a
 * troca é o arquivo e as constantes de tamanho abaixo.
 *
 * ═══ DUAS FORMAS, PELO TAMANHO ═══
 *
 * - **Completa** (`comNome`): a arte inteira, com o nome. É a da tela de
 *   entrada e a do menu lateral. O nome acessível é o `alt`.
 * - **Reduzida**: só o P, recortado da mesma arte, num bloco quadrado. É a da
 *   barra de cima, que o menu vira abaixo de 1024 px: nessa altura o nome
 *   sairia com uns cinco pixels, e letra que ninguém lê não é marca, é ruído.
 *   Ela é decoração: o nome do link vem do texto ao lado.
 *
 * ═══ `ocupado` ═══
 *
 * O P desenhado "respirava" enquanto havia requisição em voo, e era o único
 * aviso de trabalho em andamento no menu. A imagem não respira; o aviso
 * passa a ser uma faixa fina que pulsa na base do bloco. Com "reduzir
 * movimento" ligado ela fica parada, mas continua aparecendo — o fato de o
 * sistema estar trabalhando não some junto com a animação.
 */

/** Tamanho da arte, em pixels. */
export const LARGURA_DA_ARTE = 136
export const ALTURA_DA_ARTE = 163

/**
 * O P dentro da arte, em pixels, medido na imagem (`marca.test.ts` confere
 * contra os pixels): o bojo inteiro e a haste até o pé, sem o nome ao lado
 * da haste. É o recorte da forma reduzida. Limites exclusivos à direita e
 * embaixo.
 *
 * A primeira versão tinha a borda esquerda em 35 — o P começa em 33 — e
 * comia duas colunas da letra (revisão técnica do #152).
 */
export const P_NA_ARTE = {
  esquerda: 33,
  direita: 105,
  topo: 34,
  /** Primeira linha abaixo do bojo: dali para baixo só a haste é do P. */
  fimDoBojo: 97,
  /** No vão entre a haste (até a coluna 50) e "sociedade" (a partir da 55). */
  direitaDaHaste: 53,
  /**
   * O pé da haste: a linha 124 é o vão vazio antes de "de pediatria", que
   * começa logo abaixo, alinhado à esquerda do P. Cortar mais baixo traria
   * o topo dessas letras para dentro do P.
   */
  pe: 124,
} as const

/** Altura do P em relação ao bloco reduzido. */
const P_NO_BLOCO_REDUZIDO = 0.72

const SRC = '/marca-sbp.png'

export interface BlocoDaMarcaProps {
  /** Altura do bloco em pixels. */
  readonly altura: number
  /** A arte inteira, com o nome da SBP (forma completa). */
  readonly comNome?: boolean
  /** `true` enquanto há requisição em voo. */
  readonly ocupado?: boolean
  readonly className?: string
}

export function BlocoDaMarca({ altura, comNome = false, ocupado = false, className }: BlocoDaMarcaProps) {
  const largura = comNome ? Math.round((altura * LARGURA_DA_ARTE) / ALTURA_DA_ARTE) : altura

  return (
    <span
      className={['relative inline-block shrink-0 overflow-hidden bg-marca', className].filter(Boolean).join(' ')}
      style={{ width: largura, height: altura }}
    >
      {comNome ? (
        // Arquivo estático pequeno: o otimizador de imagem do Next não ganha nada aqui.
        <img src={SRC} alt="Sociedade Brasileira de Pediatria" width={largura} height={altura} className="block" />
      ) : (
        <PRecortado altura={altura} />
      )}
      {ocupado ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-[3px] animate-pulse bg-sobre-marca/70 motion-reduce:animate-none"
        />
      ) : null}
    </span>
  )
}

/** Só o P da arte, centrado no bloco quadrado. */
function PRecortado({ altura }: { readonly altura: number }) {
  const p = P_NA_ARTE
  const escala = (altura * P_NO_BLOCO_REDUZIDO) / (p.pe - p.topo)
  const larguraDoP = (p.direita - p.esquerda) * escala
  const alturaDoP = (p.pe - p.topo) * escala
  // O recorte segue a letra, não a caixa dela: a caixa do P inclui o começo de
  // "sociedade" e "brasileira", ao lado da haste.
  const pontos: readonly (readonly [number, number])[] = [
    [p.esquerda, p.topo],
    [p.direita, p.topo],
    [p.direita, p.fimDoBojo],
    [p.direitaDaHaste, p.fimDoBojo],
    [p.direitaDaHaste, p.pe],
    [p.esquerda, p.pe],
  ]
  const recorte = `polygon(${pontos
    .map(([px, py]) => `${((px / LARGURA_DA_ARTE) * 100).toFixed(2)}% ${((py / ALTURA_DA_ARTE) * 100).toFixed(2)}%`)
    .join(', ')})`

  return (
    <img
      src={SRC}
      alt=""
      aria-hidden="true"
      width={Math.round(LARGURA_DA_ARTE * escala)}
      height={Math.round(ALTURA_DA_ARTE * escala)}
      className="absolute block max-w-none"
      style={{
        left: Math.round((altura - larguraDoP) / 2 - p.esquerda * escala),
        top: Math.round((altura - alturaDoP) / 2 - p.topo * escala),
        clipPath: recorte,
      }}
    />
  )
}
