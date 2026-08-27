import { SugestaoIaGravadaSchema, ValorFinalDaRevisaoSchema } from '../core/esquemas'
import { calcularTaxaDeAcerto, type ParDeRevisao, type TaxaDeAcerto } from '../core/qualidade-ia'
import { deslocarDias, hojeIso } from '../core/util/datas'
import { arredondar } from '../core/util/numero'
import type { Banco } from '../servidor/prisma'

/**
 * Qualidade da interpretação — leitura.
 *
 * Lê o par (sugestão da IA, decisão do humano) que já está gravado em cada
 * `Revisao` resolvida desde sempre, e entrega ao núcleo puro. Nenhum dado novo
 * precisou ser coletado: o dataset existe desde que a fila de revisão passou a
 * guardar `sugestaoIa` ao lado de `valorFinal`.
 *
 * Só leitura. Como todo o painel, não há rota de escrita — invariante 4.
 *
 * ═══ UM UNIVERSO SÓ ═══
 *
 * Tudo aqui é recortado pela data de criação do ITEM, nunca pela data em que a
 * revisão foi resolvida. A pergunta que a tela responde é *"dos itens que a IA
 * classificou neste período, quantos foram conferidos e quantos passaram sem
 * correção?"* — e as três contagens só compõem se saírem do mesmo conjunto.
 *
 * Recortar o numerador por `resolvidoEm` e o denominador por `criadoEm` produz
 * frações acima de 100% no caso mais banal que existe: fila acumulada, item
 * velho, decisão nova. Foi o que este arquivo fazia antes, e o `Math.min` que
 * limitava em 1 não corrigia o erro — escondia, devolvendo um número redondo e
 * falso, que é pior do que a fração absurda.
 */

/** Janela padrão. O critério nº 5 fala em "após 2 semanas"; 30 dias dá margem. */
export const JANELA_PADRAO_DE_DIAS = 30

export interface Cobertura {
  /** Itens que a IA classificou (têm `modeloIa`). Itens criados à mão ficam de fora. */
  itensDeIa: number
  /** Desses, quantos um humano de fato conferiu. */
  revisados: number
  /** Aprovados direto pela confiança, sem ninguém olhar. */
  naoRevisados: number
  /**
   * Que fração passou por humano.
   *
   * Anda junto com a taxa de aceitação e nunca deve ser lida sem ela: 95% de
   * acerto sobre 2% de cobertura é ruído com aparência de resultado.
   */
  fracaoRevisada: number | null
}

export interface QualidadeDaIa {
  /** Início da janela em ISO, ou `null` quando a medida é desde sempre. */
  desde: string | null
  taxa: TaxaDeAcerto
  cobertura: Cobertura
  /**
   * Revisões resolvidas cujo JSON gravado não pôde ser lido.
   *
   * Contadas e mostradas em vez de silenciosamente ignoradas. Uma linha
   * ilegível desfalca a amostra, e amostra desfalcada sem aviso é o defeito
   * que este sistema existe para eliminar — só que numa métrica de qualidade,
   * onde ninguém iria procurar.
   */
  ignoradas: number
}

/**
 * @param dias janela em dias a contar de hoje. `null` = desde sempre.
 */
export async function medirQualidadeDaIa(
  banco: Banco,
  dias: number | null = JANELA_PADRAO_DE_DIAS,
): Promise<QualidadeDaIa> {
  const desde = dias === null ? null : deslocarDias(hojeIso(), -dias)
  const corte = desde === null ? undefined : new Date(`${desde}T00:00:00.000Z`)

  // O MESMO recorte nas três consultas. Ver a nota de cabeçalho.
  const itemNaJanela = corte ? { criadoEm: { gte: corte } } : {}

  const [resolvidas, itensDeIa, revisados] = await Promise.all([
    banco.revisao.findMany({
      where: {
        resolvidoEm: { not: null },
        valorFinal: { not: null },
        item: { modeloIa: { not: null }, ...itemNaJanela },
      },
      // `resolvidoPor` deliberadamente ausente do select: medir acerto por
      // revisor seria vigiar pessoa, não observar modelo. Invariante 10.
      select: { sugestaoIa: true, valorFinal: true },
    }),
    banco.item.count({ where: { modeloIa: { not: null }, ...itemNaJanela } }),
    banco.revisao.count({
      where: {
        resolvidoEm: { not: null },
        item: { modeloIa: { not: null }, ...itemNaJanela },
      },
    }),
  ])

  const pares: ParDeRevisao[] = []
  let ignoradas = 0

  for (const registro of resolvidas) {
    const par = lerPar(registro.sugestaoIa, registro.valorFinal)
    if (par === null) {
      ignoradas += 1
      continue
    }
    pares.push(par)
  }

  return {
    desde,
    taxa: calcularTaxaDeAcerto(pares),
    cobertura: {
      itensDeIa,
      revisados,
      // Com o mesmo recorte nos dois lados, `revisados <= itensDeIa` vale por
      // construção: cada revisão pertence a um item que está no denominador.
      // A guarda fica como rede — se algum dia a invariante quebrar, é melhor
      // a tela mostrar zero do que uma pendência negativa, que é o defeito
      // `E.9` da planilha.
      naoRevisados: Math.max(0, itensDeIa - revisados),
      fracaoRevisada: itensDeIa === 0 ? null : arredondar(revisados / itensDeIa),
    },
    ignoradas,
  }
}

/**
 * Lê o par gravado, ou `null` se o JSON não fizer sentido.
 *
 * Devolver um par "vazio" em vez de `null` contaminaria a média com uma
 * revisão que ninguém fez.
 */
function lerPar(sugestaoIa: string, valorFinal: string | null): ParDeRevisao | null {
  if (valorFinal === null) return null

  try {
    const sugestao = SugestaoIaGravadaSchema.parse(JSON.parse(sugestaoIa))
    const final = ValorFinalDaRevisaoSchema.parse(JSON.parse(valorFinal))

    return {
      sugestao: {
        categoriaCodigo: sugestao.categoriaCodigo,
        titulo: sugestao.titulo,
        confianca: sugestao.confianca,
        campos: sugestao.campos,
      },
      decisao: {
        categoriaCodigo: final.categoriaCodigo ?? null,
        titulo: final.titulo ?? null,
        campos: final.campos ?? null,
        aprovado: final.aprovado,
        itensExtras: final.itensExtras,
      },
    }
  } catch {
    return null
  }
}
