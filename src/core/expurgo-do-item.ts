import { z } from 'zod'

import {
  PayloadDoItemSchema,
  SugestaoIaGravadaSchema,
  ValorFinalDaRevisaoSchema,
  serializar,
} from './esquemas'
import { nomeDeCampoGravavel } from './nome-de-campo'

/**
 * O que sobra de um item depois do prazo (`A23(a)`) — a parte pura.
 *
 * Título, campos extraídos, observação digitada e os valores da revisão podem
 * ter nome e CPF de associado, e saem pelo mesmo relógio do texto do e-mail
 * (`A20`). O que fica é o que não é dado pessoal: categoria, liga, posição,
 * confiança, a decisão (aprovado, itens extras) e os NOMES de campo pela lista
 * fechada de `nome-de-campo.ts`.
 */

type PayloadDoItem = z.infer<typeof PayloadDoItemSchema>

const SEPARADOR = ' · '

/**
 * O título que o sistema monta no lugar do que a IA leu ou a pessoa digitou.
 *
 * Formato aprovado pelo dono (`A41`, resposta 22): categoria · liga · posição,
 * com a posição escrita só quando o e-mail gerou mais de um item. Item
 * registrado à mão não veio de e-mail (`itensNoEmail: null`): fica só a
 * categoria.
 */
export function tituloNeutro(item: {
  categoriaRotulo: string
  ligaNome: string | null
  sequencia: number
  itensNoEmail: number | null
}): string {
  const partes = [item.categoriaRotulo]
  if (item.ligaNome) partes.push(item.ligaNome)
  if (item.itensNoEmail !== null && item.itensNoEmail > 1) partes.push(String(item.sequencia))
  return partes.join(SEPARADOR)
}

/** Campos, liga mencionada e observação saem; os nomes dos campos ausentes ficam, pela lista fechada. */
export function reduzirPayloadDoItem(payload: PayloadDoItem): PayloadDoItem {
  return {
    campos: {},
    // O nome do campo também vem do modelo e pode ser o próprio CPF.
    camposAusentes: [...new Set(payload.camposAusentes.map(nomeDeCampoGravavel))],
    ligaMencionada: null,
    observacao: null,
    revisadoPorHumano: payload.revisadoPorHumano,
  }
}

/**
 * Da sugestão da IA ficam categoria e confiança — o que a medida de acerto usa
 * depois que o desfecho foi gravado.
 *
 * Ilegível sai inteira (`{}`): não dá para saber o que ela guardava, e guardar
 * por não conseguir ler seria o dado pessoal ficando por defeito.
 */
export function reduzirSugestaoIa(texto: string): string {
  const sugestao = lerJson(texto, SugestaoIaGravadaSchema)
  if (sugestao === null) return '{}'
  return serializar({ categoriaCodigo: sugestao.categoriaCodigo, confianca: sugestao.confianca })
}

/** Da decisão ficam categoria, aprovado, itens extras e origem. `null` (não resolvida) continua `null`. */
export function reduzirValorFinal(texto: string | null): string | null {
  if (texto === null) return null
  const final = lerJson(texto, ValorFinalDaRevisaoSchema)
  if (final === null) return '{}'
  return serializar({
    categoriaCodigo: final.categoriaCodigo ?? undefined,
    aprovado: final.aprovado,
    itensExtras: final.itensExtras,
    origem: final.origem ?? undefined,
  })
}

function lerJson<T>(texto: string, esquema: z.ZodType<T>): T | null {
  try {
    return esquema.parse(JSON.parse(texto))
  } catch {
    return null
  }
}
