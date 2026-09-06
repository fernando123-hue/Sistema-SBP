import type { ColaboradorId, ResultadoRodada } from '../tipos'

/**
 * Narrativa da rodada — o que foi feito, como, e por quê (`A6`).
 *
 * A decisão do dono do negócio pede que o sistema distribua sozinho e deixe um
 * relatório legível do que fez. A regra de ouro veio junto com o pedido e está
 * inteira aqui: **o algoritmo decide; a narrativa só descreve.**
 *
 * Por isso este arquivo é uma FUNÇÃO PURA que não calcula nada. Ele lê o
 * snapshot que `distribuir()` já gravou — critério, base, resto, cota justa,
 * ordem, crédito antes e depois — e o escreve em português. Se a narrativa
 * precisasse recalcular qualquer coisa para se explicar, existiriam duas fontes
 * para o mesmo número, e a segunda cedo ou tarde divergiria da primeira: é o
 * `SUBTOTAL(109)` da planilha reconstruído em forma de texto.
 *
 * **Não há IA aqui, de propósito.** O `A6` permite que a IA redija a frase, e
 * essa porta continua aberta — mas o texto abaixo é determinístico, roda em
 * microssegundos, não custa crédito, não falha por rede e não pode alucinar um
 * número. Trocar isto por um modelo teria de ser decisão, não conveniência.
 */

/** Como o narrador chama cada pessoa. Sem isto a narrativa citaria ids. */
export type NomeDeColaborador = (id: ColaboradorId) => string

/**
 * Arredondamento de EXIBIÇÃO.
 *
 * O crédito é mantido em float64 cheio no motor de propósito (§ C9): arredondar
 * o livro-razão vazaria fração a cada rodada. Aqui é a borda de leitura, que é
 * exatamente onde arredondar é seguro.
 */
function numero(valor: number): string {
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

function plural(quantidade: number, singular: string, plural: string): string {
  return `${quantidade} ${quantidade === 1 ? singular : plural}`
}

function listar(nomes: string[]): string {
  if (nomes.length === 0) return 'ninguém'
  if (nomes.length === 1) return nomes[0]!
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]!}`
}

/**
 * A rodada em frases.
 *
 * Devolve linhas independentes em vez de um parágrafo único para a tela poder
 * hierarquizar sem precisar cortar texto — e para cada afirmação ficar
 * rastreável ao campo que a originou.
 */
export function narrarRodada(
  rodada: ResultadoRodada,
  rotuloDaCategoria: string,
  nomeDe: NomeDeColaborador,
): string[] {
  if (rodada.criterio === 'sem_demanda') {
    // Rodada vazia é registrada de propósito: responde "por que não houve
    // distribuição de LIGA no dia 12?" — pergunta que a planilha deixa sem
    // resposta porque lá a ausência de linha e o dia sem trabalho são a mesma
    // coisa.
    return [
      `Nada entrou em ${rotuloDaCategoria} neste dia.`,
      'A rodada fica registrada assim mesmo — dia sem trabalho e dia sem registro não podem ser a mesma coisa.',
    ]
  }

  const linhas: string[] = []
  const pessoas = rodada.ordemDesempate.length

  linhas.push(
    `Entraram ${plural(rodada.quantidadeEntrada, 'item', 'itens')} de ${rotuloDaCategoria}, ` +
      `com ${plural(pessoas, 'pessoa de plantão', 'pessoas de plantão')}.`,
  )

  if (rodada.criterio === 'indivisivel') {
    const unico = rodada.ordemDesempate[0]!
    linhas.push(
      `O lote foi inteiro para ${nomeDe(unico)}: é pequeno o bastante para a categoria não fragmentar, ` +
        'e dividir volume baixo custa mais atenção do que equilibra.',
    )
  } else {
    const contemplados = rodada.ordemDesempate
      .slice(0, rodada.resto)
      .map((id) => nomeDe(id))

    linhas.push(
      rodada.base > 0
        ? `Cada uma levou ${plural(rodada.base, 'item', 'itens')}.`
        : 'Não havia itens suficientes para todas receberem.',
    )

    if (rodada.resto > 0) {
      linhas.push(
        `${plural(rodada.resto, 'item ficou', 'itens ficaram')} de sobra, e ` +
          `${rodada.resto === 1 ? 'foi' : 'foram'} para ${listar(contemplados)} — ` +
          'quem estava mais credor no início da rodada.',
      )
    }
  }

  // O PORQUÊ: o estado que decidiu a ordem, na ordem em que decidiu. É o que a
  // planilha nunca conseguiu responder, porque lá a escolha vivia na memória de
  // uma pessoa.
  const abertura = rodada.elegiveis
    .map((elegivel) => {
      const credito = rodada.creditoCategoriaAntes[elegivel.colaboradorId] ?? elegivel.creditoCategoria
      return `${nomeDe(elegivel.colaboradorId)} (${numero(credito)})`
    })
    .join(' · ')

  if (abertura.length > 0) {
    linhas.push(
      `A ordem saiu do crédito acumulado na categoria, do mais credor ao menos: ${abertura}.`,
    )
  }

  linhas.push(
    `A cota justa era ${numero(rodada.cotaJusta)} por pessoa, em unidades ponderadas — ` +
      'quem recebeu menos que isso fica credor e leva a próxima sobra.',
  )

  return linhas
}
