/**
 * Identidade de liga a partir de texto livre (`A4`, `AT-10`).
 *
 * O `A4` precisa saber QUAL liga é, para não separar o lote dela. O que existe
 * é `ligaMencionada` — um nome que a IA extraiu do e-mail, escrito como o
 * remetente escreveu. Este arquivo transforma esse texto numa chave estável de
 * comparação, e é só isso que ele faz.
 *
 * **A comparação é exata sobre o nome normalizado. Nunca aproximada**, e a
 * assimetria dos dois erros possíveis é a razão:
 *
 *   separar uma liga em duas   → duas pessoas podem atendê-la no mesmo dia;
 *                                 o operador VÊ a repetição — as duas aparecem
 *                                 na Caixa. CORRIGIR ainda não existe: não há
 *                                 fundir nem renomear liga pela tela
 *                                 (`DECISOES.md § H.4` item 18)
 *   unir duas ligas diferentes → trabalho de uma entregue como se fosse da
 *                                 outra; ninguém descobre, nunca
 *
 * Casar por semelhança troca um erro visível e corrigível por um invisível e
 * permanente. Este projeto existe para eliminar o segundo tipo.
 */

/**
 * Chave de comparação de um nome de liga.
 *
 * Minúsculas, sem acento, sem pontuação de borda, espaços colapsados. Cobre a
 * variação de DIGITAÇÃO — "Liga de Cardiologia", "liga de cardiologia " e
 * "LIGA DE CARDIOLOGIA." são a mesma coisa e devem ser.
 *
 * NÃO cobre variação de NOME: "Liga de Cardiologia da UFMG" e "Liga Cardio
 * UFMG" continuam sendo duas ligas. Adivinhar que são a mesma é exatamente o
 * erro que não se descobre depois.
 *
 * Devolve `null` quando não sobra nada — texto vazio, só espaço ou só
 * pontuação não identificam liga nenhuma, e um item sem liga é um lote de um
 * item só.
 */
export function chaveDaLiga(nome: string | null | undefined): string | null {
  if (!nome) return null

  const normalizado = nome
    .normalize('NFD')
    // Remove os diacríticos que o NFD separou. `café` e `cafe` são a mesma
    // palavra digitada por duas pessoas diferentes.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Pontuação e símbolos viram espaço; o colapso seguinte cuida do resto.
    // `Liga-de Cardiologia.` e `Liga de Cardiologia` são a mesma.
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')

  return normalizado === '' ? null : normalizado
}
