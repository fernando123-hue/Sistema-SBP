import { DataIsoSchema } from '../../../core/esquemas'
import {
  conferirConservacao,
  periodoPadrao,
  porCategoria,
  porPessoa,
  type Periodo,
} from '../../../servicos/painel'
import { responder, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { exigirAtor } from '../../../servidor/sessao'

/**
 * Painel.
 *
 * Só leitura. Não existe rota de escrita para métrica — é a garantia estrutural
 * de que nenhum número do painel é digitável.
 *
 * `?de=&ate=` recorta o período (`AAAA-MM-DD`). Sem eles, o mês corrente, que é
 * a unidade da planilha e portanto a unidade da comparação lado a lado.
 */
export async function GET(requisicao: Request): Promise<Response> {
  return rota(async () => {
    await exigirAtor()
    const banco = obterPrisma()

    const periodo = interpretarPeriodo(new URL(requisicao.url).searchParams)

    const [categorias, pessoas, conservacao] = await Promise.all([
      porCategoria(banco, periodo),
      porPessoa(banco),
      conferirConservacao(banco),
    ])

    return responder({ periodo, categorias, pessoas, conservacao })
  })
}

/**
 * Lê o período pedido, ou devolve o padrão.
 *
 * Data torta cai no padrão em vez de estourar: pedir o painel com um parâmetro
 * errado é erro de link, não de sistema. Mas `de` depois de `ate` é invertido em
 * vez de aceito — um período de duração negativa produziria saldo inicial maior
 * que o aberto, e a tela mostraria pendência negativa.
 */
function interpretarPeriodo(parametros: URLSearchParams): Periodo {
  const padrao = periodoPadrao()

  const de = DataIsoSchema.safeParse(parametros.get('de'))
  const ate = DataIsoSchema.safeParse(parametros.get('ate'))
  if (!de.success || !ate.success) return padrao

  return de.data <= ate.data
    ? { de: de.data, ate: ate.data }
    : { de: ate.data, ate: de.data }
}
