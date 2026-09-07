import { criarAssistentePort } from '../../../adapters/fabrica'
import { PerguntaDoAssistenteSchema } from '../../../core/assistente/esquemas'
import { perguntarAoAssistente } from '../../../servicos/assistente'
import { corpoJson, limitar, responder, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { exigirAtor } from '../../../servidor/sessao'

/**
 * Assistente de ajuda.
 *
 * Exige sessão e NÃO exige papel: a ajuda é para todo mundo que usa o sistema.
 * O papel entra como filtro do que é respondido — em `montarMaterial`, antes do
 * prompt, e de novo sobre a tela sugerida, no serviço. Nunca como permissão de
 * chamar a rota.
 *
 * ═══ POR QUE O LIMITE É POR PESSOA, E NÃO POR ORIGEM ═══
 *
 * `limitarPorOrigem` protege rota PRÉ-autenticação, onde não se sabe quem
 * chama. Aqui se sabe: a rota já passou por `exigirAtor`, então a chave é o
 * colaborador. Um balde por origem seria pior nos dois sentidos — atrás de NAT
 * a equipe inteira dividiria o mesmo balde, e sem proxy confiável declarado a
 * chave é global e não separa ninguém.
 *
 * O número é generoso para uso humano e apertado para laço: quem tira dúvida
 * faz três ou quatro perguntas seguidas, não trinta. Cada pergunta pode custar
 * uma chamada paga ao modelo, e é isso que o teto protege.
 */
const PERGUNTAS_POR_MINUTO = 12

export async function POST(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()

    const recusa = limitar(`assistente:${ator.colaboradorId}`, PERGUNTAS_POR_MINUTO, 60)
    if (recusa) return recusa

    // O esquema recusa pergunta vazia ou longa demais ANTES de qualquer contato
    // com o modelo — mensagem melhor para quem digitou, e uma chamada paga a
    // menos para quem paga.
    const { pergunta } = PerguntaDoAssistenteSchema.parse(await corpoJson(requisicao))

    return responder(
      await perguntarAoAssistente(
        { banco: obterPrisma(), assistente: criarAssistentePort() },
        pergunta,
        ator,
      ),
    )
  })
}
