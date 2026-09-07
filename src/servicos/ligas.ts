import type { Banco } from '../servidor/prisma'

/**
 * Ligas — leitura.
 *
 * A liga é entidade de primeira classe deste sistema desde o `A4`: é a unidade
 * que não se separa no rateio, e `agruparPorLiga` decide a distribuição inteira
 * de `LIGANTE` e `EMAIL_LIGA` a partir dela. Só que até 07/09/2026 **ela não
 * aparecia em tela nenhuma** — existia no banco, governava o motor, e era
 * invisível para quem opera.
 *
 * Isso cobrou na entrega das notas do setor: o vínculo de nota com liga estava
 * no banco, na API e nos testes, e não havia como criá-lo pela interface,
 * porque não havia como escolher uma liga. Metade de uma decisão do dono
 * (`A14(b)`) construída por baixo e inalcançável por cima.
 *
 * ═══ SÓ LEITURA, E DE PROPÓSITO ═══
 *
 * Não há criação nem edição de liga aqui. Liga nasce da ingestão, quando a IA
 * menciona um nome e `identidadeDeLiga` o resolve (`AT-10`) — é assim que ela
 * fica amarrada ao que de fato chegou por e-mail. Um cadastro manual paralelo
 * criaria ligas que nenhum item aponta, e a primeira consequência seria uma
 * lista de escolha cheia de nomes que não significam trabalho nenhum.
 */

export interface LigaListada {
  id: string
  nome: string
  instituicao: string | null
  uf: string | null
  /** Itens já vinculados a esta liga, em qualquer status. Dá peso à escolha. */
  itens: number
  /** Notas vivas do setor sobre esta liga. */
  notas: number
}

/**
 * As ligas que a operação reconhece.
 *
 * Ordenadas por nome porque a lista é para ESCOLHER numa tela, e quem escolhe
 * procura pelo nome que leu no e-mail — não pela liga mais movimentada. A
 * contagem vai junto para a escolha não ser às cegas, não para ordenar.
 */
export async function listar(banco: Banco): Promise<LigaListada[]> {
  const ligas = await banco.liga.findMany({
    where: { status: 'ativa' },
    orderBy: { nome: 'asc' },
    select: {
      id: true,
      nome: true,
      instituicao: true,
      uf: true,
      _count: { select: { itens: true } },
      // Conta só as vivas: nota arquivada não orienta ninguém, e um número que
      // inclui arquivadas prometeria memória que a tela não vai mostrar.
      notas: { where: { arquivadaEm: null }, select: { id: true } },
    },
  })

  return ligas.map((liga) => ({
    id: liga.id,
    nome: liga.nome,
    instituicao: liga.instituicao,
    uf: liga.uf,
    itens: liga._count.itens,
    notas: liga.notas.length,
  }))
}
