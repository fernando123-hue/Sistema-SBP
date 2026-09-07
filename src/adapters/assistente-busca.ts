import { buscarNoManual } from '../core/assistente/busca'
import { selecionarVerbetes } from '../core/assistente/conhecimento'
import {
  RespostaDoModeloAssistenteSchema,
  TAMANHO_MAXIMO_DA_RESPOSTA,
  type RespostaDoModeloAssistente,
} from '../core/assistente/esquemas'
import type { QuemPergunta } from '../core/assistente/prompt'
import { analisarConteudo } from '../core/seguranca/conteudo-nao-confiavel'
import { TAMANHO_MAXIMO_DA_PERGUNTA } from '../core/assistente/esquemas'
import type { AssistentePort } from '../ports/assistente'
import { registrarLog } from '../servidor/observabilidade'

/**
 * Assistente por busca no manual — determinístico, sem rede, sem custo.
 *
 * É o que atende quando `IA_ADAPTER=mock`, que é o padrão do sistema. Não é um
 * stub: o texto que ele devolve é o MESMO texto do manual que iria para o
 * modelo. O que muda é que aqui ninguém reescreve nada — a resposta é o
 * verbete, não uma paráfrase dele.
 *
 * Isso o torna pior de ler e melhor de confiar: ele é incapaz de inventar,
 * porque só sabe repetir. Vale a pena lembrar disso antes de trocar o padrão
 * para um modelo real numa instalação nova.
 *
 * As três camadas: TRUNCAR e DETECTAR valem aqui; DELIMITAR não, porque não
 * existe prompt onde o texto pudesse escapar de um bloco. A detecção continua
 * rodando mesmo sem modelo — é ela que deixa o rastro de que alguém tentou.
 */
export class AssistentePorBusca implements AssistentePort {
  readonly nome = 'busca'

  // Assíncrono sem nada a esperar: o contrato do port é assíncrono porque os
  // outros adapters vão à rede, e uniformizar a assinatura é o que permite
  // trocar um pelo outro sem o chamador saber qual está atendendo.
  // eslint-disable-next-line @typescript-eslint/require-await
  async responder(quem: QuemPergunta, pergunta: string): Promise<RespostaDoModeloAssistente> {
    const analise = analisarConteudo(pergunta, TAMANHO_MAXIMO_DA_PERGUNTA)
    if (analise.suspeito) {
      registrarLog('aviso', 'pergunta ao assistente com padrão de injeção', {
        adapter: this.nome,
        padroes: analise.padroes,
        tamanho: pergunta.length,
      })
    }

    // Filtragem por papel ANTES da busca: um verbete de gestor não pode ser
    // encontrado por quem não é gestor, nem para dizer que ele existe.
    const achados = buscarNoManual(pergunta, selecionarVerbetes(quem.papel))
    const melhor = achados[0]

    if (!melhor) {
      return RespostaDoModeloAssistenteSchema.parse({
        resposta:
          'Não encontrei isso no que eu sei sobre o sistema. Tente perguntar com outras palavras — ' +
          'por exemplo "como distribuo o dia", "por que o item foi para revisão" ou "como devolvo um item". ' +
          'Se for uma dúvida sobre uma demanda específica ou sobre uma regra do setor, fale com quem coordena.',
        respondida: false,
        verbetesUsados: [],
        telaSugerida: null,
      } satisfies RespostaDoModeloAssistente)
    }

    // O segundo lugar entra como "veja também" quando chega perto do primeiro.
    // Perto, e não sempre: colar um verbete pouco relacionado embaixo da
    // resposta certa é ruído que faz a pessoa duvidar da parte boa.
    const segundo = achados[1]
    const complementa = segundo && segundo.pontuacao >= melhor.pontuacao * 0.6 ? segundo : undefined

    const corpo = complementa
      ? `${melhor.verbete.texto}\n\nVeja também — ${complementa.verbete.titulo}: ${complementa.verbete.texto}`
      : melhor.verbete.texto

    return RespostaDoModeloAssistenteSchema.parse({
      resposta: corpo.slice(0, TAMANHO_MAXIMO_DA_RESPOSTA),
      respondida: true,
      verbetesUsados: complementa
        ? [melhor.verbete.id, complementa.verbete.id]
        : [melhor.verbete.id],
      telaSugerida: melhor.verbete.tela,
    } satisfies RespostaDoModeloAssistente)
  }
}
