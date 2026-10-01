import { concluidosHoje } from '../../../../servicos/fila'
import { responder, responderErro, rota, semCache } from '../../../../servidor/http'
import { obterPrisma } from '../../../../servidor/prisma'
import { exigirAtor } from '../../../../servidor/sessao'

/**
 * "Hoje você concluiu N" da Minha fila (`A69`, 5A; `A71`).
 *
 * Só de quem está na sessão. Ao contrário de `GET /api/fila`, que aceita
 * `?colaborador=` para operador e gestor remanejarem carga, aqui qualquer
 * parâmetro é RECUSADO, e não ignorado: quem tentar `?colaborador=fulano`
 * recebe 400 em vez do próprio número com cara de ser o de fulano
 * (invariante 5).
 *
 * O Painel de operador e gestor ainda mostra concluídos por pessoa em
 * qualquer período, hoje inclusive (`A24`). Se isso continua é pergunta ao
 * dono em `DECISOES.md § H.4` (revisão de segurança do #171); até a resposta,
 * a tela da fila não diz "só você vê".
 *
 * Sem cache: é dado de uma pessoa, e um cache compartilhado o entregaria a
 * outra.
 */
export async function GET(requisicao: Request): Promise<Response> {
  return semCache(
    await rota(async () => {
      const ator = await exigirAtor()
      if (new URL(requisicao.url).search !== '') {
        return responderErro('Este número é sempre de quem está conectado; a rota não aceita parâmetros.', 400)
      }
      return responder(await concluidosHoje(obterPrisma(), ator))
    }),
  )
}
