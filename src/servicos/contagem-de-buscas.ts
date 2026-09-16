import { exigirPrazoValido } from '../core/retencao'
import { deslocarDias, hojeIso } from '../core/util/datas'
import type { Banco } from '../servidor/prisma'

/**
 * Medição da busca por CPF ou matrícula — `DECISOES.md § A44(h)` e `§ A48`.
 *
 * ═══ SÓ CONTA ═══
 *
 * Nada aqui bloqueia, avisa ou mostra. Os limites da proteção contra varredura
 * só existem depois de semanas olhando estes números; antes disso, qualquer
 * limite seria chute, e chute errado para o trabalho de alguém.
 *
 * ═══ POR QUE NINGUÉM LÊ ═══
 *
 * Não existe função de leitura neste arquivo, e é de propósito (`A44(g)`): um
 * placar, mesmo só para a gestora, vira meta invisível que a equipe passa a
 * administrar. A calibração é feita por quem mantém o sistema, direto no banco.
 */

function codigoDoPrisma(erro: unknown): unknown {
  return erro !== null && typeof erro === 'object' && 'code' in erro
    ? (erro as { code?: unknown }).code
    : undefined
}

/**
 * `P2034` é o código do Prisma para conflito de escrita ou deadlock. No InnoDB,
 * inserções simultâneas na mesma chave podem terminar assim, em vez de em
 * `P2002` — e o banco pede exatamente isto: tente de novo.
 */
const TENTATIVAS_EM_CONFLITO = 3

/**
 * Soma uma busca na linha (pessoa, dia).
 *
 * A primeira busca do dia cria a linha. Duas primeiras buscas ao mesmo tempo
 * tentam criar a mesma; a que perde cai na unicidade (`P2002`) e soma por
 * `increment`, que o banco resolve sem ler antes — nenhuma das duas se perde.
 *
 * Deadlock é tentado de novo, porque a medição não pode derrubar uma busca que
 * já achou o item (`A44(h)`: só conta). Se persistir, falha alto: contagem
 * perdida em silêncio é medição que mente.
 */
export async function contarBusca(
  banco: Banco,
  colaboradorId: string,
  encontrou: boolean,
  hoje: string = hojeIso(),
): Promise<void> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      await somar(banco, colaboradorId, encontrou ? 0 : 1, hoje)
      return
    } catch (erro) {
      if (codigoDoPrisma(erro) !== 'P2034' || tentativa >= TENTATIVAS_EM_CONFLITO) throw erro
    }
  }
}

async function somar(banco: Banco, colaboradorId: string, semResultado: number, hoje: string): Promise<void> {
  const soma = { buscas: { increment: 1 }, semResultado: { increment: semResultado } }

  const { count } = await banco.contagemDeBusca.updateMany({ where: { colaboradorId, dia: hoje }, data: soma })
  if (count === 1) return

  try {
    await banco.contagemDeBusca.create({ data: { colaboradorId, dia: hoje, buscas: 1, semResultado } })
  } catch (erro) {
    if (codigoDoPrisma(erro) !== 'P2002') throw erro
    await banco.contagemDeBusca.update({
      where: { colaboradorId_dia: { colaboradorId, dia: hoje } },
      data: soma,
    })
  }
}

export interface ResultadoDoExpurgoDaContagem {
  apagadas: number
}

/**
 * Apaga os dias que completaram o prazo.
 *
 * A linha do dia D sai no dia D + prazo: com 90 dias, a contagem de 18/06 sai
 * em 16/09. Não vai para a trilha linha a linha — isso copiaria para a memória
 * permanente justamente o número que o prazo existe para tirar; o total apagado
 * fica no resumo da rotina.
 */
export async function expurgarContagemDeBuscas(
  banco: Banco,
  opcoes: { diasDeRetencao: number; hoje?: string },
): Promise<ResultadoDoExpurgoDaContagem> {
  exigirPrazoValido(opcoes.diasDeRetencao)

  const hoje = opcoes.hoje ?? hojeIso()
  const ultimoDiaQueSai = deslocarDias(hoje, -opcoes.diasDeRetencao)

  const { count } = await banco.contagemDeBusca.deleteMany({ where: { dia: { lte: ultimoDiaQueSai } } })
  return { apagadas: count }
}
