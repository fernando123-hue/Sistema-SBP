import { medirQualidadeDaIa, JANELA_PADRAO_DE_DIAS } from '../../../servicos/qualidade'
import { responder, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { exigirAtor } from '../../../servidor/sessao'

/**
 * Qualidade da interpretação da IA.
 *
 * Só leitura, como todo o painel — não existe rota de escrita para métrica, e
 * é isso que garante estruturalmente que nenhum número aqui é digitável.
 *
 * `?dias=N` recorta a janela; `?dias=tudo` mede desde sempre. Um valor
 * inválido cai na janela padrão em vez de estourar: pedir o painel com um
 * parâmetro torto é erro de link, não de sistema.
 */
export async function GET(requisicao: Request): Promise<Response> {
  return rota(async () => {
    await exigirAtor()

    const pedido = new URL(requisicao.url).searchParams.get('dias')
    const dias = interpretarJanela(pedido)

    return responder(await medirQualidadeDaIa(obterPrisma(), dias))
  })
}

/** Teto de 5 anos: janela absurda vira varredura de tabela inteira. */
const JANELA_MAXIMA_DE_DIAS = 1826

function interpretarJanela(pedido: string | null): number | null {
  if (pedido === null) return JANELA_PADRAO_DE_DIAS
  if (pedido === 'tudo') return null

  const dias = Number(pedido)
  if (!Number.isInteger(dias) || dias < 1 || dias > JANELA_MAXIMA_DE_DIAS) {
    return JANELA_PADRAO_DE_DIAS
  }
  return dias
}
