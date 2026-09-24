import { NOTAS_POR_MINUTO, listar, paraContexto, registrar } from '../../../servicos/notas'
import { corpoJson, limitar, responder, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { exigirAtor } from '../../../servidor/sessao'

/**
 * Notas do setor — o que a equipe aprendeu operando.
 *
 * `GET` tem dois modos, e QUAL DELES É O PADRÃO é a decisão que importa:
 *
 * - **padrão — a SELEÇÃO**, `paraContexto`. Ordenada da mais específica para a
 *   mais geral, cortada no teto, e — o ponto — **descartando toda nota cujo
 *   vínculo não bate com o contexto pedido**. É o que as quatro telas de
 *   trabalho consomem, e é a mesma função que um dia montará o contexto do
 *   modelo (ver `core/notas.ts`). Contexto vazio é um pedido legítimo: devolve
 *   as notas do setor inteiro, que é a resposta certa para "ainda não sei de
 *   que categoria este trabalho é".
 * - **`todas=1` — a listagem plana**, para administrar a memória do setor.
 *   `arquivadas=1` inclui as que saíram de circulação; `categoriaCodigo`
 *   filtra.
 *
 * ═══ POR QUE O PADRÃO INVERTEU ═══
 *
 * A primeira versão fazia o contrário: a listagem plana era o padrão e a
 * seleção exigia parâmetro. Isso tinha um defeito real — três das quatro telas
 * passam contexto vazio, então elas caíam na listagem e recebiam TODAS as
 * notas, inclusive as presas a categorias em que a pessoa não estava
 * trabalhando. A rota anulava, do lado de fora, a única garantia que
 * `selecionarNotas` existe para dar. Testes de núcleo verdes o tempo todo: o
 * defeito não estava na regra, estava em quem a chamava.
 *
 * A lição que fica na forma do código: o modo perigoso é o que precisa ser
 * pedido por escrito, nunca o que se recebe por omissão.
 *
 * Exigir sessão e não exigir papel é deliberado: a nota é escrita por quem
 * opera e serve a quem opera. Nenhuma nota decide distribuição, altera cota ou
 * entra em métrica de painel.
 */

export async function GET(requisicao: Request): Promise<Response> {
  return rota(async () => {
    await exigirAtor()

    const parametros = new URL(requisicao.url).searchParams

    if (parametros.get('todas') === '1') {
      return responder(
        await listar(obterPrisma(), {
          categoriaCodigo: parametros.get('categoriaCodigo'),
          incluirArquivadas: parametros.get('arquivadas') === '1',
        }),
      )
    }

    return responder(
      await paraContexto(obterPrisma(), {
        categoriaId: parametros.get('categoriaId'),
        categoriaCodigo: parametros.get('categoriaCodigo'),
        ligaId: parametros.get('ligaId'),
      }),
    )
  })
}

export async function POST(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()

    // Antes de ler o corpo e de gravar: cada nota é uma linha que toda tela
    // considera e uma linha em `LogAuditoria`, que nunca é apagada (C-16).
    const recusa = limitar(`nota:${ator.colaboradorId}`, NOTAS_POR_MINUTO, 60)
    if (recusa) return recusa

    return responder(await registrar(obterPrisma(), await corpoJson(requisicao), ator))
  })
}
