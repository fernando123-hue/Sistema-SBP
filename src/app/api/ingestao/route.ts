import {
  criarAiPort,
  criarArmazenamentoPort,
  criarClassificadorPort,
  criarIngestaoPort,
} from '../../../adapters/fabrica'
import { hojeIso, sequenciaDeDatas } from '../../../core/util/datas'
import { estadoDaBusca, iniciarBusca } from '../../../servicos/busca-em-segundo-plano'
import { exigirPapel } from '../../../servidor/ator'
import { limitar, responder, rota, semCache } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { exigirAtor } from '../../../servidor/sessao'

/**
 * Dispara a busca de e-mails, que roda no servidor (`busca-em-segundo-plano.ts`).
 *
 * Responde na hora: 202 quando começou, 200 com a que já estava rodando. A
 * tela acompanha pelo `GET`. Antes, a requisição esperava a busca inteira, e
 * com a IA local isso eram minutos de tela presa e um proxy cortando em 60 s.
 *
 * Qual adapter roda vem do ambiente, pela fábrica — não de um `new` fixo aqui.
 * Pedir um adapter não implementado falha AQUI, na hora do clique, em vez de
 * rodar o mock em silêncio ou falhar minutos depois.
 *
 * Limite de taxa apertado: cada busca chama o modelo de IA uma vez por e-mail
 * novo — e, com a segunda opinião ligada (`CLASSIFICADOR_ADAPTER`), o
 * classificador também. Com os adapters reais, isso custa dinheiro.
 */
export async function POST(): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    exigirPapel(ator, 'sincronizar ingestão', 'operador', 'gestor')

    const recusa = limitar(`ingestao:${ator.colaboradorId}`, 5, 60)
    if (recusa) return recusa

    const hoje = hojeIso()

    const pedido = iniciarBusca(
      {
        banco: obterPrisma(),
        // Idempotente por message-id: chamar de novo não duplica nada.
        ingestao: criarIngestaoPort({
          datas: sequenciaDeDatas(hoje, 1),
          semente: Number(hoje.replaceAll('-', '')),
        }),
        ia: criarAiPort(),
        armazenamento: criarArmazenamentoPort(),
        // `null` com `CLASSIFICADOR_ADAPTER=nenhum`, o padrão: sem segunda opinião.
        classificador: criarClassificadorPort(),
      },
      ator,
    )

    return semCache(responder(pedido.estado, pedido.iniciada ? 202 : 200))
  })
}

/**
 * Até onde a busca chegou, ou como terminou. Só números.
 *
 * Limite largo: a tela pergunta a cada poucos segundos enquanto a busca roda,
 * e uma busca longa são dezenas de perguntas. O teto existe para um laço sem
 * espera não ocupar o servidor.
 */
export async function GET(): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    exigirPapel(ator, 'acompanhar a busca de e-mails', 'operador', 'gestor')

    const recusa = limitar(`ingestao-estado:${ator.colaboradorId}`, 120, 60)
    if (recusa) return recusa

    return semCache(responder(estadoDaBusca(ator)))
  })
}
