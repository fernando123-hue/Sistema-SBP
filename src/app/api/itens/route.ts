import { listarCaixa, resumirCaixa } from '../../../servicos/caixa'
import { registrarManual } from '../../../servicos/itens'
import { corpoJson, responder, rota } from '../../../servidor/http'
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

/**
 * Registro manual de item.
 *
 * A contrapartida do `Mov. Extra` da planilha, e o único caminho de criação de
 * `INADIMP.`/`ISENTO` — categorias que estavam no cadastro e eram inalcançáveis.
 *
 * Papel é conferido dentro do serviço, junto com as regras que dependem da
 * categoria: quem registra não escolhe quem recebe trabalho do rateio.
 */
export async function POST(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    return responder(await registrarManual(obterPrisma(), await corpoJson(requisicao), ator), 201)
  })
}
