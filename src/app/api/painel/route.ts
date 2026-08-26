import { conferirConservacao, porCategoria, porPessoa } from '../../../servicos/painel'
import { responder, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { exigirAtor } from '../../../servidor/sessao'

/**
 * Painel.
 *
 * Só leitura. Não existe rota de escrita para métrica — é a garantia estrutural
 * de que nenhum número do painel é digitável.
 */
export async function GET(): Promise<Response> {
  return rota(async () => {
    await exigirAtor()
    const banco = obterPrisma()

    const [categorias, pessoas, conservacao] = await Promise.all([
      porCategoria(banco),
      porPessoa(banco),
      conferirConservacao(banco),
    ])

    return responder({ categorias, pessoas, conservacao })
  })
}
