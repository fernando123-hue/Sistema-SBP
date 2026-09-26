import { DataIsoSchema } from '../../../core/esquemas'
import {
  CONSULTAS_DO_PAINEL_POR_MINUTO,
  conferirConservacao,
  periodoPadrao,
  porCategoria,
  porPessoa,
  type Periodo,
} from '../../../servicos/painel'
import { limitar, responder, rota } from '../../../servidor/http'
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
    // `A24`: o colaborador recebe só os próprios números; operador e gestor, os
    // de todos. O recorte é do serviço — filtrar na tela deixaria os números da
    // equipe inteira dentro da resposta.
    const ator = await exigirAtor()

    // Antes de ler: cada pedido faz três leituras sobre o período pedido, e sem
    // limite qualquer sessão as multiplicava em paralelo (pendência 9, C-21).
    const recusa = limitar(`painel:${ator.colaboradorId}`, CONSULTAS_DO_PAINEL_POR_MINUTO, 60)
    if (recusa) return recusa

    const banco = obterPrisma()

    const periodo = interpretarPeriodo(new URL(requisicao.url).searchParams)

    const [categorias, pessoas, conservacao] = await Promise.all([
      porCategoria(banco, periodo),
      porPessoa(banco, ator, periodo),
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
