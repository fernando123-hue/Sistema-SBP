import { listar } from '../../../servicos/ligas'
import { responder, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { exigirAtor } from '../../../servidor/sessao'

/**
 * Ligas — as que a operação reconhece.
 *
 * Só leitura, e não há par de escrita: liga nasce da ingestão, quando a IA
 * menciona um nome e `identidadeDeLiga` o resolve (`AT-10`). Ver
 * `servicos/ligas.ts` para por que um cadastro manual paralelo seria dano.
 *
 * Exige sessão, não exige papel — a lista é o vocabulário da operação, e quem
 * opera precisa dele para filtrar a caixa e para dizer de que liga é a nota que
 * está escrevendo.
 */
export async function GET(): Promise<Response> {
  return rota(async () => {
    await exigirAtor()
    return responder(await listar(obterPrisma()))
  })
}
