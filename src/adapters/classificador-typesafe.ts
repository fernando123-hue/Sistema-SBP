import { z } from 'zod'

import type { Pergunta, Resposta } from '../ports/classificador'
import { ambiente } from '../servidor/ambiente'
import type { ClienteDeClassificacao, PerfilDoClassificador } from './classificador-externo'

/**
 * Classificador — Jev, da TypeSafe AI (`DECISOES.md § A62`).
 *
 * ═══ DE ONDE VEM O QUE ESTÁ AQUI ═══
 *
 * A documentação e a API estavam fora do alcance da rede da sessão que
 * escreveu isto (26/09/2026). A forma do pedido e da resposta foi lida na
 * fonte primária que estava ao alcance: os tipos e o código do SDK oficial,
 * `@typesafe-ai/sdk` 0.6.0 (`POST {base}/v1/systemone`, `Authorization:
 * Bearer`, base `https://api.typesafe.ai`, modelo padrão `jev-latest`, 10 s de
 * prazo e duas repetições por padrão). O SDK NÃO é dependência: são quinze
 * linhas de `fetch`, e o Zod abaixo espelha os tipos dele — se a API mudar, a
 * resposta deixa de passar e vira falha alta, nunca opinião errada.
 *
 * ═══ O QUE ESTE ARQUIVO NÃO FAZ ═══
 *
 * - **Não recebe texto cru.** Quem o chama é `ClassificadorExterno`, que
 *   mascara, corta e delimita antes. E a trava de `servidor/ambiente.ts`
 *   (`CLASSIFICADOR_PARA_DADO_REAL.typesafe = false`) recusa ligar este
 *   adaptador com caixa de e-mail real até o dono decidir (`§ H.4` item 35).
 * - **Não repete.** O SDK repete duas vezes; aqui, uma falha é "sem segunda
 *   opinião para este texto", e a interpretação segue.
 * - **Não troca de endereço.** A base é constante, não variável de ambiente:
 *   um endereço configurável mandaria o texto para onde a variável dissesse.
 */

const ENDERECO = 'https://api.typesafe.ai/v1/systemone'

/**
 * O prazo do SDK. Classificar é rápido; uma chamada que passa disto está
 * presa, e o item não pode esperar uma opinião que é só complemento.
 */
const TEMPO_LIMITE_MS = 10_000

export const PERFIL_TYPESAFE: PerfilDoClassificador = {
  nome: 'typesafe',
  modeloPadrao: 'jev-latest',
  // Pelo status, nunca pelo texto da mensagem: texto pode vir do remetente
  // (pendência 30, o mesmo defeito no perfil do Gemini).
  ehCredencialRecusada: (erro) => {
    if (typeof erro !== 'object' || erro === null) return false
    const status = (erro as { status?: unknown }).status
    return status === 401 || status === 403
  },
}

/**
 * O erro da API, **sem o corpo**. O corpo de erro pode citar o que recebeu, e
 * o que recebeu é texto de e-mail (mascarado, mas nome fica). O status diz o
 * que arrumar; o id do pedido é o que o suporte deles pede.
 */
class FalhaDaTypeSafe extends Error {
  constructor(
    readonly status: number,
    idDoPedido: string | null,
  ) {
    super(`a TypeSafe respondeu ${status}${idDoPedido ? ` (pedido ${idDoPedido})` : ''}`)
  }
}

// ─── O fio: a forma da API, espelhando `@typesafe-ai/sdk` 0.6.0 ───────────────

const Probabilidade = z.number().min(0).max(1)

const RespostaNoFioSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('noul'), noul: Probabilidade }),
  z.object({
    type: z.literal('choice'),
    choice: z.string(),
    confidence: Probabilidade,
    probabilities: z.record(z.string(), Probabilidade),
  }),
  z.object({
    type: z.literal('score'),
    score: z.number(),
    confidence: Probabilidade,
    probabilities: z.record(z.string(), Probabilidade),
  }),
])

const ResultadoNoFioSchema = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), RespostaNoFioSchema),
  // Lido para validar a forma; o registro de uso conta chamadas, não tokens.
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional(),
})

function paraOFio(pergunta: Pergunta): unknown {
  switch (pergunta.tipo) {
    case 'sim_ou_nao':
      return {
        type: 'noul',
        instructions: pergunta.instrucoes,
        ...(pergunta.seSim !== undefined || pergunta.seNao !== undefined
          ? { criteria: { true: pergunta.seSim ?? null, false: pergunta.seNao ?? null } }
          : {}),
      }
    case 'escolha':
      return { type: 'choice', instructions: pergunta.instrucoes, criteria: pergunta.opcoes }
    case 'nota':
      return { type: 'score', instructions: pergunta.instrucoes, criteria: pergunta.niveis }
  }
}

function doFio(resposta: z.infer<typeof RespostaNoFioSchema>): Resposta {
  switch (resposta.type) {
    case 'noul':
      return { tipo: 'sim_ou_nao', probabilidadeDeSim: resposta.noul }
    case 'choice':
      return {
        tipo: 'escolha',
        escolha: resposta.choice,
        confianca: resposta.confidence,
        probabilidades: resposta.probabilities,
      }
    case 'score':
      return {
        tipo: 'nota',
        nota: resposta.score,
        confianca: resposta.confidence,
        probabilidades: resposta.probabilities,
      }
  }
}

export function clienteTypeSafe(chave: string | undefined = ambiente().TYPESAFE_API_KEY): ClienteDeClassificacao {
  // `ambiente()` já recusa `CLASSIFICADOR_ADAPTER=typesafe` sem chave; esta é
  // a segunda tranca, para quem construir o cliente direto.
  if (!chave) throw new Error('TYPESAFE_API_KEY ausente: o classificador da TypeSafe não pode subir.')

  return {
    async perguntar({ estado, perguntas, modelo }) {
      const resposta = await fetch(ENDERECO, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${chave}`,
        },
        body: JSON.stringify({
          model: modelo,
          state: estado,
          questions: Object.fromEntries(
            Object.entries(perguntas).map(([nome, pergunta]) => [nome, paraOFio(pergunta)]),
          ),
        }),
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
        // Redirecionamento não é seguido: o Node reenviaria este POST, com o
        // texto dentro, para onde a resposta mandasse (achado do PR #74, no
        // adaptador local).
        redirect: 'manual',
      })

      if (!resposta.ok) {
        throw Object.assign(
          new FalhaDaTypeSafe(resposta.status, resposta.headers.get('x-typesafe-request-id')),
          { status: resposta.status },
        )
      }

      let corpo: unknown
      try {
        corpo = await resposta.json()
      } catch {
        throw new Error('a resposta da TypeSafe não é JSON')
      }

      // `parse`, não `safeParse`: o `ZodError` é o sinal de FORMA para
      // `especieDoErro`, e a política o resume sem o valor recebido.
      const resultado = ResultadoNoFioSchema.parse(corpo)
      return {
        respostas: Object.fromEntries(
          Object.entries(resultado.answers).map(([nome, dada]) => [nome, doFio(dada)]),
        ),
        modeloUsado: resultado.model,
      }
    },
  }
}
