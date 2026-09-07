import { listar, paraContexto, registrar } from '../../../servicos/notas'
import { corpoJson, responder, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { exigirAtor } from '../../../servidor/sessao'

/**
 * Notas do setor — o que a equipe aprendeu operando.
 *
 * `GET` tem dois modos, e a diferença importa:
 *
 * - **com `categoriaId` ou `ligaId`** — devolve a SELEÇÃO para aquele contexto,
 *   já ordenada da mais específica para a mais geral e cortada no teto. É o que
 *   as telas de trabalho consomem, e é a mesma função que um dia montará o
 *   contexto do modelo (ver `core/notas.ts`).
 * - **sem nenhum dos dois** — devolve a listagem plana, para administrar a
 *   memória do setor. `arquivadas=1` inclui as que saíram de circulação.
 *
 * Exigir sessão e não exigir papel é deliberado: a nota é escrita por quem
 * opera e serve a quem opera. Nenhuma nota decide distribuição, altera cota ou
 * entra em métrica de painel.
 */

export async function GET(requisicao: Request): Promise<Response> {
  return rota(async () => {
    await exigirAtor()

    const parametros = new URL(requisicao.url).searchParams
    const categoriaId = parametros.get('categoriaId')
    const categoriaCodigo = parametros.get('categoriaCodigo')
    const ligaId = parametros.get('ligaId')

    if (categoriaId !== null || categoriaCodigo !== null || ligaId !== null) {
      return responder(
        await paraContexto(obterPrisma(), { categoriaId, categoriaCodigo, ligaId }),
      )
    }

    return responder(
      await listar(obterPrisma(), { incluirArquivadas: parametros.get('arquivadas') === '1' }),
    )
  })
}

export async function POST(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    return responder(await registrar(obterPrisma(), await corpoJson(requisicao), ator))
  })
}
