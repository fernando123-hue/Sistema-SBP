import { ALTURA, LARGURA, dentroDoP, folgaAteABorda } from './contorno'

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
 *      vaza para fora da letra — o defeito visual mais provável aqui, e o que
 *      um olho distraído deixa passar.
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
  /** Altura do glifo. Também define a massa: grande resiste, pequeno foge. */
  readonly tamanho: number
  /** Giro em graus. Sutil — a marca tem variação, não bagunça. */
  readonly giro: number
  /** Peso tipográfico. A marca real mistura pesos, e é isso que lhe dá textura. */
  readonly peso: 400 | 600 | 800
}

/**
 * Semente do arranjo.
 *
 * Mudar este número redesenha a marca inteira. É o único botão de "gerar outra
 * versão", e existe para poder escolher um arranjo bonito uma vez e travá-lo.
 */
export const SEMENTE = 20260907

/**
 * Espaçamento da grade de amostragem.
 *
 * Menor = mais P's = mais denso e mais caro. Em `4.2` a letra fica com pouco
 * menos de cem glifos: densidade suficiente para ler como textura, e leve o
 * bastante para animar no celular sem pensar duas vezes.
 */
const PASSO_DA_GRADE = 3.2

/**
 * Tamanhos possíveis do glifo, do menor ao maior.
 *
 * A média é DELIBERADAMENTE maior que o passo da grade. Com glifos menores que
 * a célula, sobra fundo entre eles e a letra lê como chuvisco — foi o primeiro
 * resultado, e o erro era exatamente esse. Na marca real os P's se encostam e
 * às vezes se sobrepõem: é isso que faz a silhueta ser sólida de longe e
 * revelar as peças de perto.
 *
 * O menor da lista existe para a BORDA: onde a folga é de um ponto ou dois, só
 * ele cabe. Sem essa opção o contorno ficaria serrilhado, com buracos onde
 * nenhum tamanho passou no teste de folga.
 */
const TAMANHOS = [2.2, 3.2, 4.2, 5.4, 6.8] as const
const PESOS = [400, 600, 800] as const

/**
 * Quanto um glifo pode passar do contorno, em unidades da letra.
 *
 * Pequeno de propósito: o suficiente para a borda parecer composta, longe do
 * bastante para a silhueta continuar sendo um P reconhecível a 24 pixels na
 * barra de navegação. O teste guarda este número — se alguém aumentá-lo até a
 * letra perder a forma, a suíte acusa.
 */
export const TRANSBORDO_DA_BORDA = 0.9

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

/**
 * Monta o arranjo.
 *
 * Grade com deslocamento aleatório em vez de sorteio livre de pontos: o
 * sorteio puro cria aglomerados e buracos — e um buraco no meio de uma letra
 * lê como defeito de impressão, não como textura. A grade garante cobertura
 * uniforme; o deslocamento tira a aparência de tabela.
 *
 * O tamanho de cada glifo é limitado pela folga até a borda, o que faz a letra
 * ficar naturalmente com peças grandes no miolo e pequenas no contorno — que é
 * exatamente o que a marca original faz, e pelo mesmo motivo: é a única forma
 * de a silhueta continuar nítida.
 */
export function gerarParticulas(semente: number = SEMENTE): ParticulaDaMarca[] {
  const sortear = sorteador(semente)
  const particulas: ParticulaDaMarca[] = []
  let id = 0

  for (let y = PASSO_DA_GRADE / 2; y < ALTURA; y += PASSO_DA_GRADE) {
    for (let x = PASSO_DA_GRADE / 2; x < LARGURA; x += PASSO_DA_GRADE) {
      // Deslocamento dentro da própria célula: quebra o alinhamento sem
      // permitir que dois vizinhos troquem de lugar.
      const desvioX = (sortear() - 0.5) * PASSO_DA_GRADE * 0.85
      const desvioY = (sortear() - 0.5) * PASSO_DA_GRADE * 0.85
      const px = x + desvioX
      const py = y + desvioY

      if (!dentroDoP(px, py)) continue

      // O glifo não pode ser maior que a folga até a borda, ou vaza da letra.
      // O teste `nenhum glifo vaza` depende desta linha.
      const folga = folgaAteABorda(px, py, 12)
      // TRANSBORDO DELIBERADO. A marca real deixa os P's da borda passarem um
      // pouco do contorno — é isso que faz a silhueta parecer feita de letras
      // em vez de recortada a tesoura. Sem a tolerância, a borda fica com
      // buracos onde nenhum tamanho passou no teste, e a letra vira renda.
      const maiorCabivel = (folga + TRANSBORDO_DA_BORDA) * 1.6
      const disponiveis = TAMANHOS.filter((t) => t <= maiorCabivel)
      if (disponiveis.length === 0) continue

      // Enviesado para os MAIORES entre os que cabem.
      //
      // A primeira versão puxava para os menores, e a letra saiu com aparência
      // de chuvisco: cada glifo menor que a própria célula, fundo visível entre
      // todos. A marca real faz o contrário — usa a maior peça que couber, e a
      // variação de tamanho vem da FORMA da letra (miolo largo, borda estreita),
      // não de sorteio. O teste de folga acima já garante que só entra o que
      // cabe; aqui a preferência é pelo topo dessa lista.
      const sorte = sortear() ** 2
      const indice = Math.floor((1 - sorte) * disponiveis.length)
      const tamanho = disponiveis[Math.min(indice, disponiveis.length - 1)] ?? disponiveis[0]!

      particulas.push({
        id,
        x: px,
        y: py,
        tamanho,
        // ±22°: o suficiente para nenhum P parecer alinhado com o vizinho, sem
        // que nenhum chegue a parecer de cabeça para baixo.
        giro: (sortear() - 0.5) * 44,
        peso: PESOS[Math.floor(sortear() * PESOS.length)] ?? 600,
      })
      id += 1
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
