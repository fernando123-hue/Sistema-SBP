import { LimiteDeListagemSchema } from '../../../core/esquemas'
import { listarCaixa, resumirCaixa } from '../../../servicos/caixa'
import { registrarManual } from '../../../servicos/itens'
import { corpoJson, responder, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { exigirAtor } from '../../../servidor/sessao'

export async function GET(requisicao: Request): Promise<Response> {
  return rota(async () => {
    // O ator decide O QUE a resposta pode conter: colaborador vê só os itens
    // dele (`A24`). O recorte acontece no serviço, nunca na tela.
    const ator = await exigirAtor()

    const url = new URL(requisicao.url)
    const banco = obterPrisma()

    const [itens, resumo] = await Promise.all([
      listarCaixa(
        banco,
        {
          status: url.searchParams.get('status') ?? undefined,
          categoriaCodigo: url.searchParams.get('categoria') ?? undefined,
          ligaId: url.searchParams.get('liga') ?? undefined,
          // `Number('abc')` é `NaN`, e `NaN` chegava a `take:` do Prisma como
          // erro de driver — 500 com id de correlação, em vez de "parâmetro
          // inválido". Um link torto não é falha de servidor.
          //
          // O teto também deixa de ser sugestão: sem ele, `?limite=999999`
          // atravessava a caixa inteira numa consulta, e a resposta cresce com
          // o tempo de vida do sistema.
          limite: LimiteDeListagemSchema.parse(url.searchParams.get('limite')),
        },
        ator,
      ),
      resumirCaixa(banco, ator),
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
