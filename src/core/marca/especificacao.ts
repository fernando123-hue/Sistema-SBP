import { ALTURA, LARGURA, dentroDoP } from './contorno'

/**
 * O arranjo dos P's pequenos que formam o P grande.
 *
 * ═══ ISTO É A REPRESENTAÇÃO INTERMEDIÁRIA, NÃO O DESENHO ═══
 *
 * O dossiê do `img2threejs` identifica como ativo central daquele projeto uma
 * inversão simples: **o spec declarativo é o produto; o código que desenha é
 * saída derivada, descartável e regerável.** É a inversão adotada aqui.
 *
 * Este módulo devolve uma lista de partículas — posição, tamanho, giro, peso.
 * Ele não sabe o que é SVG, não sabe o que é React, não toca no DOM e não lê
 * relógio. Quem desenha consome isto; quem anima consome isto. Trocar SVG por
 * canvas amanhã não encosta neste arquivo.
 *
 * ═══ DETERMINÍSTICO POR CONSTRUÇÃO, E ISSO NÃO É DETALHE ═══
 *
 * O sorteio usa um gerador com semente fixa. A mesma semente devolve
 * exatamente o mesmo arranjo, em qualquer máquina, hoje e daqui a um ano.
 *
 * Três razões:
 *
 *   1. **A marca precisa ser a mesma sempre.** Um logotipo que se rearranja a
 *      cada carregamento não é um logotipo — é um protetor de tela.
 *   2. **Servidor e cliente têm de concordar.** O Next renderiza esta árvore
 *      duas vezes; `Math.random()` produziria HTML diferente nos dois lados e
 *      o React acusaria erro de hidratação.
 *   3. **Dá para testar.** É o que permite a suíte afirmar que nenhum glifo
 *      vaza para fora da letra nem cai por cima de outro — os defeitos visuais
 *      mais prováveis aqui, e os que um olho distraído deixa passar.
 *
 * ═══ POR QUE NÃO UM ARQUIVO DE DADOS GERADO ═══
 *
 * O arranjo poderia ser gerado uma vez e comitado como JSON. Não foi, porque
 * o gerador é menor que a saída dele e o resultado é idêntico — e porque um
 * JSON comitado esconde a regra que o produziu. Aqui a regra está à vista, e o
 * teste prova que ela é estável.
 */

/** Um P pequeno. Tudo em coordenadas do contorno (`0..LARGURA`, `0..ALTURA`). */
export interface ParticulaDaMarca {
  /** Índice estável. É a identidade da peça — nunca reordene a lista. */
  readonly id: number
  /** Posição de REPOUSO. A física desloca a partir daqui e sempre volta para cá. */
  readonly x: number
  readonly y: number
  /**
   * Altura da maiúscula do glifo. Também define a massa: grande resiste,
   * pequeno foge.
   */
  readonly tamanho: number
  /** Giro em graus. Sutil — a marca tem variação, não bagunça. */
  readonly giro: number
  /** Peso tipográfico. A marca real mistura pesos, e é isso que lhe dá textura. */
  readonly peso: 400 | 600 | 800
  /**
   * Opacidade da tinta, de 0 a 1. Na arte, parte dos P's é branca e parte é
   * cinza-clara: é essa diferença que faz a letra ler como mosaico de letras,
   * e não como bloco branco.
   */
  readonly tom: number
}

/**
 * Semente do arranjo.
 *
 * Mudar este número redesenha a marca inteira. É o único botão de "gerar outra
 * versão", e existe para poder escolher um arranjo bonito uma vez e travá-lo.
 */
export const SEMENTE = 20260930

/**
 * Largura da tinta de um "P" sobre a altura da maiúscula.
 *
 * É a caixa que o encaixe reserva para cada glifo. O teste de transbordo usa a
 * elipse inscrita nela (`0,39` de raio horizontal).
 */
export const LARGURA_DO_GLIFO = 0.78

/**
 * Folga mínima entre duas caixas, em unidades da letra.
 *
 * ═══ POR QUE AS PEÇAS NÃO PODEM SE ENCOSTAR ═══
 *
 * A versão anterior espalhava os glifos numa grade mais apertada que o tamanho
 * deles, de propósito, para a silhueta "ficar sólida". Visto na tela, os P's
 * se sobrepunham até virar uma mancha branca granulada: ninguém enxergava letra
 * nenhuma, e o dono chamou de "bugado" (30/09). Na arte oficial cada P pequeno
 * é LEGÍVEL, com o azul aparecendo entre eles; a silhueta vem da borda alinhada
 * ao contorno, não de tinta empilhada. O teste `nenhum glifo cai por cima de
 * outro` guarda isto.
 */
export const FOLGA_ENTRE_GLIFOS = 0.25

/**
 * Tamanhos, do maior ao menor, e quantos de cada o encaixe aceita.
 *
 * Os grandes são poucos e entram primeiro — são os P's que se leem de longe
 * na arte. Os pequenos não têm teto: preenchem o que sobrou até a letra ficar
 * coberta, inclusive a borda, onde só eles cabem. `null` = sem teto.
 */
const CAMADAS: readonly { readonly tamanho: number; readonly teto: number | null }[] = [
  { tamanho: 8, teto: 6 },
  { tamanho: 6.6, teto: 14 },
  { tamanho: 5.4, teto: 40 },
  { tamanho: 4.4, teto: null },
  { tamanho: 3.6, teto: null },
  { tamanho: 2.9, teto: null },
]

/**
 * Passo da varredura de candidatos, em unidades da letra.
 *
 * Cada camada experimenta TODAS as posições desta grade, em ordem embaralhada.
 * A primeira versão do encaixe sorteava 1400 posições soltas por camada e
 * deixou a letra rala — 77 peças, com buracos que o sorteio não achou. A
 * varredura acha toda fresta em que o glifo cabe; o embaralhamento tira a
 * aparência de tabela.
 */
const PASSO_DA_VARREDURA = 1

/**
 * Pesos, com repetição para dar a proporção da arte: a maioria média, um em
 * cada seis em negrito. Com os três pesos na mesma proporção, os negritos
 * dominavam e a letra ficava manchada; só com o regular, apagada.
 */
const PESOS = [400, 600, 600, 600, 600, 800] as const

/**
 * Quanto um glifo pode passar do contorno, em unidades da letra.
 *
 * Pequeno de propósito: o suficiente para a borda parecer composta, longe do
 * bastante para a silhueta continuar sendo um P reconhecível a 24 pixels na
 * barra de navegação. O teste guarda este número — se alguém aumentá-lo até a
 * letra perder a forma, a suíte acusa.
 */
export const TRANSBORDO_DA_BORDA = 0.6

/**
 * Gerador pseudoaleatório de 32 bits (mulberry32).
 *
 * Doze linhas, sem dependência, e — o que importa aqui — **reprodutível**.
 * `Math.random()` não serve: ele não aceita semente, então quebraria a
 * hidratação e tornaria o teste de contenção impossível de escrever.
 */
function sorteador(semente: number): () => number {
  let estado = semente >>> 0
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0
    let t = estado
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher–Yates com o sorteador da semente: a mesma ordem em toda carga. */
function embaralhar<T>(lista: T[], sortear: () => number): void {
  for (let i = lista.length - 1; i > 0; i -= 1) {
    const j = Math.floor(sortear() * (i + 1))
    const troca = lista[i]!
    lista[i] = lista[j]!
    lista[j] = troca
  }
}

/**
 * A caixa do glifo cabe na letra?
 *
 * Confere o centro, os quatro cantos e o meio de cada lado, com a caixa
 * recolhida pelo `TRANSBORDO_DA_BORDA`. Os cantos são o que importa: é por
 * eles que um glifo invade a contraforma.
 */
function cabeNaLetra(x: number, y: number, tamanho: number): boolean {
  const meiaLargura = Math.max(0, (tamanho * LARGURA_DO_GLIFO) / 2 - TRANSBORDO_DA_BORDA)
  const meiaAltura = Math.max(0, tamanho / 2 - TRANSBORDO_DA_BORDA)
  for (const fx of [-1, 0, 1]) {
    for (const fy of [-1, 0, 1]) {
      if (!dentroDoP(x + fx * meiaLargura, y + fy * meiaAltura)) return false
    }
  }
  return true
}

interface Caixa {
  readonly x: number
  readonly y: number
  /** Meia largura e meia altura. */
  readonly mx: number
  readonly my: number
}

/** Lado da célula da grade de colisão, em unidades da letra. */
const LADO_DA_CELULA = 6
/** Maior meia medida de caixa possível: a do maior glifo. */
const MAIOR_MEIA_MEDIDA = CAMADAS[0]!.tamanho / 2

/**
 * As caixas já ocupadas, numa grade: cada tentativa só confere as vizinhas.
 *
 * Comparar com todas seria quadrático — milhares de tentativas contra centenas
 * de caixas, no carregamento de toda tela que mostra a marca.
 */
function criarOcupacao() {
  const celulas = new Map<number, Caixa[]>()
  const chave = (cx: number, cy: number) => cy * 1000 + cx

  return {
    colide(nova: Caixa): boolean {
      const margem = MAIOR_MEIA_MEDIDA + FOLGA_ENTRE_GLIFOS
      const cx0 = Math.floor((nova.x - nova.mx - margem) / LADO_DA_CELULA)
      const cx1 = Math.floor((nova.x + nova.mx + margem) / LADO_DA_CELULA)
      const cy0 = Math.floor((nova.y - nova.my - margem) / LADO_DA_CELULA)
      const cy1 = Math.floor((nova.y + nova.my + margem) / LADO_DA_CELULA)
      for (let cy = cy0; cy <= cy1; cy += 1) {
        for (let cx = cx0; cx <= cx1; cx += 1) {
          for (const c of celulas.get(chave(cx, cy)) ?? []) {
            if (
              Math.abs(c.x - nova.x) < c.mx + nova.mx + FOLGA_ENTRE_GLIFOS &&
              Math.abs(c.y - nova.y) < c.my + nova.my + FOLGA_ENTRE_GLIFOS
            ) {
              return true
            }
          }
        }
      }
      return false
    },
    ocupar(caixa: Caixa): void {
      const k = chave(Math.floor(caixa.x / LADO_DA_CELULA), Math.floor(caixa.y / LADO_DA_CELULA))
      const lista = celulas.get(k)
      if (lista) lista.push(caixa)
      else celulas.set(k, [caixa])
    },
  }
}

/**
 * Monta o arranjo.
 *
 * Encaixe em camadas, do maior para o menor: cada camada percorre os
 * candidatos em ordem embaralhada e aceita só aqueles em que a caixa do glifo
 * cabe na letra e não encosta em nenhuma já colocada. Os grandes ficam
 * espalhados e os pequenos ocupam as frestas — é o que dá à borda um contorno
 * nítido sem nenhuma peça por cima de outra.
 */
export function gerarParticulas(semente: number = SEMENTE): ParticulaDaMarca[] {
  const sortear = sorteador(semente)
  const ocupacao = criarOcupacao()
  const particulas: ParticulaDaMarca[] = []

  // Os candidatos: a grade inteira, só com os pontos que caem na tinta.
  const candidatos: [number, number][] = []
  for (let y = PASSO_DA_VARREDURA / 2; y < ALTURA; y += PASSO_DA_VARREDURA) {
    for (let x = PASSO_DA_VARREDURA / 2; x < LARGURA; x += PASSO_DA_VARREDURA) {
      if (dentroDoP(x, y)) candidatos.push([x, y])
    }
  }

  for (const { tamanho, teto } of CAMADAS) {
    const mx = (tamanho * LARGURA_DO_GLIFO) / 2
    const my = tamanho / 2
    let nestaCamada = 0
    embaralhar(candidatos, sortear)
    for (const [cx, cy] of candidatos) {
      if (teto !== null && nestaCamada >= teto) break
      // Desvio dentro da própria célula: quebra o alinhamento da grade.
      const x = cx + (sortear() - 0.5) * PASSO_DA_VARREDURA
      const y = cy + (sortear() - 0.5) * PASSO_DA_VARREDURA
      // Giro, peso e tom são sorteados SEMPRE, aceita ou não a posição: assim
      // a sequência não depende de quantas foram recusadas, e ajustar o teste
      // de encaixe não embaralha o resto da marca.
      const sorteioDoGiro = sortear()
      const sorteioDoPeso = sortear()
      const sorteioDoTom = sortear()
      if (!cabeNaLetra(x, y, tamanho)) continue
      const caixa = { x, y, mx, my }
      if (ocupacao.colide(caixa)) continue

      ocupacao.ocupar(caixa)
      const peso = PESOS[Math.floor(sorteioDoPeso * PESOS.length)] ?? 600
      particulas.push({
        id: particulas.length,
        x,
        y,
        tamanho,
        // Quase todos em pé, como na arte: ±7° na maioria; um em cada seis,
        // mais inclinado, até ±18°. Nenhum chega perto de cabeça para baixo.
        giro:
          sorteioDoGiro < 1 / 6 ? (sorteioDoGiro * 6 - 0.5) * 36 : (sorteioDoGiro - 0.5) * 14,
        peso,
        // Os negritos saem brancos; o resto, entre 78% e 100%.
        tom: peso === 800 ? 1 : 0.78 + sorteioDoTom * 0.22,
      })
      nestaCamada += 1
    }
  }

  return particulas
}

/**
 * O arranjo da marca. Calculado uma vez, no carregamento do módulo.
 *
 * Congelado porque é identidade visual, não estado: nada no sistema tem
 * permissão de reescrever a marca em tempo de execução. A física trabalha
 * sobre uma cópia mutável do estado, nunca sobre isto.
 */
export const PARTICULAS_DA_MARCA: readonly ParticulaDaMarca[] = Object.freeze(gerarParticulas())
