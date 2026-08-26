import { listarCaixa, resumirCaixa } from '../../../servicos/caixa'
import { responder, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { exigirAtor } from '../../../servidor/sessao'

export async function GET(requisicao: Request): Promise<Response> {
  return rota(async () => {
    await exigirAtor()

    const url = new URL(requisicao.url)
    const banco = obterPrisma()

    const [itens, resumo] = await Promise.all([
      listarCaixa(banco, {
        status: url.searchParams.get('status') ?? undefined,
        categoriaCodigo: url.searchParams.get('categoria') ?? undefined,
        limite: Number(url.searchParams.get('limite') ?? 100),
      }),
      resumirCaixa(banco),
    ])

    return responder({ itens, resumo })
  })
}
