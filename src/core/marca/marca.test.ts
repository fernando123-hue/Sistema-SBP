import { describe, expect, it } from 'vitest'

import { ALTURA, LARGURA, dentroDoP, folgaAteABorda } from './contorno'
import { PARTICULAS_DA_MARCA, SEMENTE, gerarParticulas } from './especificacao'
import { assentou, criarEstado, passo, pulsar, type Ponteiro } from './fisica'

/**
 * A marca é identidade visual, e identidade visual que muda sozinha não é
 * identidade. Estes testes guardam três propriedades que o olho não confere
 * de forma confiável:
 *
 *   - o arranjo é o MESMO sempre (senão a marca muda a cada carregamento, e o
 *     React ainda acusa erro de hidratação por servidor e cliente discordarem);
 *   - nenhum glifo VAZA para fora da letra (é o defeito mais provável de uma
 *     construção procedural, e o que passa despercebido em telas pequenas);
 *   - o campo SEMPRE volta ao repouso (senão a marca fica torta para sempre
 *     depois que alguém passa o ponteiro por cima).
 */

const SEM_PONTEIRO: Ponteiro = { x: 0, y: 0, ativo: false }

describe('contorno do P', () => {
  it('a haste é tinta e a contraforma é vazio', () => {
    // Um ponto no meio da haste, à esquerda.
    expect(dentroDoP(10, 50)).toBe(true)
    // O centro da contraforma — o buraco do P. Se isto virar `true`, a letra
    // deixou de ser um P.
    expect(dentroDoP(42, 28)).toBe(false)
  })

  it('a perna do P não tem bojo — é o que o separa de um D', () => {
    // Bem abaixo do bojo, à direita da haste: tem de ser vazio.
    expect(dentroDoP(50, 85)).toBe(false)
    // Na mesma altura, sobre a haste: tem de ser tinta.
    expect(dentroDoP(10, 85)).toBe(true)
  })

  it('fora da caixa não é tinta', () => {
    expect(dentroDoP(-1, 50)).toBe(false)
    expect(dentroDoP(LARGURA + 1, 50)).toBe(false)
    expect(dentroDoP(10, -1)).toBe(false)
    expect(dentroDoP(10, ALTURA + 1)).toBe(false)
  })

  it('a folga é zero fora da tinta e cresce no miolo', () => {
    expect(folgaAteABorda(42, 28, 8)).toBe(0)
    expect(folgaAteABorda(10, 50, 8)).toBeGreaterThan(3)
  })
})

describe('arranjo da marca', () => {
  it('é sempre o mesmo — a marca não muda a cada carregamento', () => {
    const primeiro = gerarParticulas(SEMENTE)
    const segundo = gerarParticulas(SEMENTE)

    expect(segundo).toHaveLength(primeiro.length)
    // Comparação campo a campo: `toEqual` sobre a lista inteira também serviria,
    // mas a mensagem de falha ficaria ilegível com uma centena de itens.
    for (let i = 0; i < primeiro.length; i += 1) {
      expect(segundo[i]).toEqual(primeiro[i])
    }
  })

  it('sementes diferentes dão arranjos diferentes', () => {
    // Prova que a semente É o botão de gerar outra versão — e que o teste
    // acima não está passando por o gerador ser constante.
    const outro = gerarParticulas(SEMENTE + 1)
    const iguais = outro.filter(
      (p, i) => PARTICULAS_DA_MARCA[i] && p.x === PARTICULAS_DA_MARCA[i]!.x,
    )
    expect(iguais.length).toBeLessThan(outro.length / 2)
  })

  it('todo glifo NASCE dentro da letra', () => {
    // O centro é inegociável: um glifo com centro fora do P não pertence à
    // letra, ele é sujeira ao lado dela.
    for (const p of PARTICULAS_DA_MARCA) {
      expect(dentroDoP(p.x, p.y), `glifo ${p.id} nasceu fora da letra`).toBe(true)
    }
  })

  it('o transbordo da borda é pequeno o bastante para a letra continuar legível', () => {
    // O transbordo é DELIBERADO — ver `TRANSBORDO_DA_BORDA`. A marca real deixa
    // os P's da borda passarem um pouco do contorno, e é isso que faz a
    // silhueta parecer feita de letras em vez de recortada a tesoura.
    //
    // O que o teste guarda não é a ausência de transbordo, e sim o TETO dele.
    // Sem teto, aumentar a tolerância até a letra virar uma nuvem passaria
    // despercebido: cada passo parece pequeno, e a forma se perde aos poucos.
    const TETO = 2

    let maiorTransbordo = 0
    for (const p of PARTICULAS_DA_MARCA) {
      // Amostra o contorno do glifo. A largura de um "P" é cerca de 0,78 da
      // altura, então o raio horizontal é menor que o vertical.
      const raioY = p.tamanho / 2
      const raioX = p.tamanho * 0.39

      for (let i = 0; i < 12; i += 1) {
        const angulo = (i / 12) * Math.PI * 2
        const px = p.x + Math.cos(angulo) * raioX
        const py = p.y + Math.sin(angulo) * raioY
        if (dentroDoP(px, py)) continue

        // Fora: mede quanto passou, recuando até reencontrar a tinta.
        let excesso = 0
        for (let recuo = 0.1; recuo <= TETO + 0.5; recuo += 0.1) {
          const fator = 1 - recuo / Math.max(raioX, raioY)
          if (fator <= 0) break
          if (
            dentroDoP(p.x + Math.cos(angulo) * raioX * fator, p.y + Math.sin(angulo) * raioY * fator)
          ) {
            excesso = recuo
            break
          }
        }
        maiorTransbordo = Math.max(maiorTransbordo, excesso)
      }
    }

    expect(
      maiorTransbordo,
      `algum glifo passa ${maiorTransbordo.toFixed(2)} do contorno — a silhueta está virando nuvem`,
    ).toBeLessThanOrEqual(TETO)
  })

  it('tem densidade suficiente para ler como textura, e leve para animar', () => {
    // Faixa larga de propósito: o número exato é consequência do passo da
    // grade e vai mudar quando o contorno oficial entrar. O que o teste guarda
    // é a ORDEM DE GRANDEZA — poucos demais e some a textura que É a marca;
    // muitos demais e o celular sofre.
    expect(PARTICULAS_DA_MARCA.length).toBeGreaterThan(120)
    expect(PARTICULAS_DA_MARCA.length).toBeLessThan(450)
  })

  it('mistura tamanhos e pesos — marca de peça única não é esta marca', () => {
    expect(new Set(PARTICULAS_DA_MARCA.map((p) => p.tamanho)).size).toBeGreaterThan(2)
    expect(new Set(PARTICULAS_DA_MARCA.map((p) => p.peso)).size).toBeGreaterThan(1)
  })

  it('o giro é sutil — nenhum P fica de cabeça para baixo', () => {
    for (const p of PARTICULAS_DA_MARCA) {
      expect(Math.abs(p.giro)).toBeLessThanOrEqual(22)
    }
  })
})

describe('física do campo', () => {
  it('em repouso, sem ponteiro, nada se move', () => {
    const estado = criarEstado(PARTICULAS_DA_MARCA.length)
    passo(estado, PARTICULAS_DA_MARCA, SEM_PONTEIRO, 1 / 60)
    expect(assentou(estado)).toBe(true)
  })

  it('o ponteiro afasta o que está perto e não toca no que está longe', () => {
    const estado = criarEstado(PARTICULAS_DA_MARCA.length)
    const alvo = PARTICULAS_DA_MARCA[0]!
    const ponteiro: Ponteiro = { x: alvo.x, y: alvo.y, ativo: true }

    for (let i = 0; i < 10; i += 1) passo(estado, PARTICULAS_DA_MARCA, ponteiro, 1 / 60)

    const perto = Math.hypot(estado.deslocX[0]!, estado.deslocY[0]!)
    expect(perto).toBeGreaterThan(0.05)

    const distante = PARTICULAS_DA_MARCA.findIndex(
      (p) => Math.hypot(p.x - alvo.x, p.y - alvo.y) > 40,
    )
    expect(distante).toBeGreaterThan(-1)
    expect(Math.hypot(estado.deslocX[distante]!, estado.deslocY[distante]!)).toBeLessThan(0.01)
  })

  it('o glifo pequeno cede mais que o grande — é a massa que vende o objeto', () => {
    const estado = criarEstado(PARTICULAS_DA_MARCA.length)

    const menor = PARTICULAS_DA_MARCA.reduce((a, b) => (a.tamanho <= b.tamanho ? a : b))
    // Um grande que esteja perto do menor, para os dois sentirem campo parecido.
    const maiorPerto = PARTICULAS_DA_MARCA.filter(
      (p) => p.tamanho >= 5.6 && Math.hypot(p.x - menor.x, p.y - menor.y) < 14,
    ).sort((a, b) => b.tamanho - a.tamanho)[0]

    // Se o arranjo não tiver esse par, o teste não tem o que provar — e dizer
    // isso é mais honesto que passar sem verificar nada.
    expect(maiorPerto, 'arranjo sem par pequeno/grande vizinho para comparar').toBeDefined()

    const ponteiro: Ponteiro = { x: menor.x, y: menor.y, ativo: true }
    for (let i = 0; i < 12; i += 1) passo(estado, PARTICULAS_DA_MARCA, ponteiro, 1 / 60)

    const deslocDoMenor = Math.hypot(estado.deslocX[menor.id]!, estado.deslocY[menor.id]!)
    const deslocDoMaior = Math.hypot(
      estado.deslocX[maiorPerto!.id]!,
      estado.deslocY[maiorPerto!.id]!,
    )
    expect(deslocDoMenor).toBeGreaterThan(deslocDoMaior)
  })

  it('SEMPRE volta ao repouso quando o ponteiro sai', () => {
    // A garantia que impede a marca de ficar torta para sempre.
    const estado = criarEstado(PARTICULAS_DA_MARCA.length)
    const alvo = PARTICULAS_DA_MARCA[10]!

    for (let i = 0; i < 30; i += 1) {
      passo(estado, PARTICULAS_DA_MARCA, { x: alvo.x, y: alvo.y, ativo: true }, 1 / 60)
    }
    expect(assentou(estado)).toBe(false)

    // Dois segundos simulados, sem esperar dois segundos: é para isso que `dt`
    // é argumento em vez de vir do relógio.
    for (let i = 0; i < 120; i += 1) passo(estado, PARTICULAS_DA_MARCA, SEM_PONTEIRO, 1 / 60)
    expect(assentou(estado)).toBe(true)
  })

  it('nunca se desmancha — o deslocamento tem teto', () => {
    const estado = criarEstado(PARTICULAS_DA_MARCA.length)
    const alvo = PARTICULAS_DA_MARCA[5]!

    // Pulso absurdo de propósito: mesmo assim a marca continua legível.
    pulsar(estado, PARTICULAS_DA_MARCA, alvo.x, alvo.y, 9000)
    for (let i = 0; i < 60; i += 1) {
      passo(estado, PARTICULAS_DA_MARCA, { x: alvo.x, y: alvo.y, ativo: true }, 1 / 60)
      for (let j = 0; j < PARTICULAS_DA_MARCA.length; j += 1) {
        expect(Math.hypot(estado.deslocX[j]!, estado.deslocY[j]!)).toBeLessThanOrEqual(9.5)
      }
    }
  })

  it('um passo enorme não explode a integração', () => {
    // Aba em segundo plano que volta: `dt` chega gigante. Com integração
    // explícita e sem teto, isso manda as partículas para o infinito.
    const estado = criarEstado(PARTICULAS_DA_MARCA.length)
    const alvo = PARTICULAS_DA_MARCA[3]!
    passo(estado, PARTICULAS_DA_MARCA, { x: alvo.x, y: alvo.y, ativo: true }, 5)

    for (let i = 0; i < PARTICULAS_DA_MARCA.length; i += 1) {
      expect(Number.isFinite(estado.deslocX[i]!)).toBe(true)
      expect(Number.isFinite(estado.deslocY[i]!)).toBe(true)
    }
  })

  it('o pulso afasta a partir da origem, em todas as direções', () => {
    const estado = criarEstado(PARTICULAS_DA_MARCA.length)
    pulsar(estado, PARTICULAS_DA_MARCA, LARGURA / 2, ALTURA / 2, 40)

    // Cada peça tem de estar se afastando do centro, não indo para um lado só.
    for (let i = 0; i < PARTICULAS_DA_MARCA.length; i += 1) {
      const p = PARTICULAS_DA_MARCA[i]!
      const dx = p.x - LARGURA / 2
      const dy = p.y - ALTURA / 2
      const produtoEscalar = dx * estado.velX[i]! + dy * estado.velY[i]!
      expect(produtoEscalar).toBeGreaterThanOrEqual(0)
    }
  })
})
