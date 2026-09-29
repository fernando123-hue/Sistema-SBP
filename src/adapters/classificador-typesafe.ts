import { z } from 'zod'

import type { Pergunta, Resposta } from '../ports/classificador'
import { ambiente } from '../servidor/ambiente'
import { registrarLog } from '../servidor/observabilidade'
import { ehNomeDeModelo, type ClienteDeClassificacao, type PerfilDoClassificador } from './classificador-externo'

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
export const TEMPO_LIMITE_MS = 10_000

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
 * Maior resposta aceita. Uma resposta boa, com meia dúzia de perguntas, tem
 * poucas centenas de bytes; o teto é mil vezes isso. Sem ele, em 10 s um
 * fornecedor com defeito (ou um proxy no meio) enche a memória do servidor.
 */
export const MAIOR_RESPOSTA_BYTES = 256 * 1024

/**
 * Forma de um id de pedido e de um nome de modelo. Os dois vêm do fornecedor
 * e vão para mensagem, log e `UsoDaIa` (cuja chave primária tem `modelo` em
 * `VARCHAR(191)`: um nome maior derrubaria a gravação, e a chamada sumiria da
 * conta do teto diário). Fora da forma, o valor é descartado — não cortado:
 * um pedaço de texto estranho continua estranho.
 */
const ID_DO_PEDIDO = /^[A-Za-z0-9_-]{1,64}$/

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
    const id = idDoPedido && ID_DO_PEDIDO.test(idDoPedido) ? idDoPedido : null
    super(`a TypeSafe respondeu ${status}${id ? ` (pedido ${id})` : ''}`)
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

/**
 * O envelope, com as respostas ainda SEM validar. Elas são validadas uma a
 * uma, depois de conferido que as chaves são as perguntas — ver `lerResultado`.
 */
const ResultadoNoFioSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), z.unknown()),
  // Lido para validar a forma; o registro de uso conta chamadas, não tokens.
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional(),
})

/**
 * Defeito de forma com o caminho que NÓS escolhemos.
 *
 * Um `ZodError` sobre `answers` traria no caminho a chave que o fornecedor
 * escreveu — e `resumoDeValidacao` deixa passar identificador de até 40
 * caracteres (`MariaFicticia_Rua123` passa). Aqui a chave de `answers` já foi
 * conferida contra as perguntas, e o caminho para no nome do campo do NOSSO
 * esquema: a chave de `probabilities` embaixo dele, também do fornecedor,
 * nunca entra. Só o código do defeito é copiado; `message`, `input` e o resto
 * do issue ficam para trás.
 *
 * O código vai em `code`, que é o único campo que `resumoDeValidacao` lê. No
 * primeiro contato com a API real, a diferença entre `invalid_type` e
 * `unrecognized_keys` no log é o diagnóstico (rodada 2 do #142: com o código
 * em `message`, tudo saía como `custom`).
 *
 * O issue NÃO tem os campos próprios de cada código (`keys`, `errors`…): leia-o
 * só com `resumoDeValidacao`. `z.treeifyError` sobre um `invalid_union` sem
 * `errors` lança (rodada 3 do #142).
 */
function defeitoDeForma(caminho: (string | number)[], codigo: string): z.ZodError {
  return new z.ZodError([{ code: codigo, path: caminho, message: '' } as z.core.$ZodIssue])
}

function lerResultado(
  corpo: unknown,
  perguntas: Readonly<Record<string, Pergunta>>,
): { respostas: Record<string, Resposta>; modelo: string | null } {
  const envelope = ResultadoNoFioSchema.safeParse(corpo)
  if (!envelope.success) {
    const problema = envelope.error.issues[0]!
    // O caminho do envelope tem só campos nossos até `answers`; o que vem
    // depois é chave do fornecedor.
    const caminho = problema.path.slice(0, 1).map((segmento) => (typeof segmento === 'symbol' ? '?' : segmento))
    throw defeitoDeForma(caminho, problema.code)
  }

  const nomes = Object.keys(envelope.data.answers)
  const perguntadas = Object.keys(perguntas)
  if (nomes.length !== perguntadas.length || nomes.some((nome) => !Object.hasOwn(perguntas, nome))) {
    // O código do Zod para chave a mais — sem as chaves, que são do fornecedor.
    throw defeitoDeForma(['answers'], 'unrecognized_keys')
  }

  const respostas: Record<string, Resposta> = {}
  for (const nome of perguntadas) {
    const dada = RespostaNoFioSchema.safeParse(envelope.data.answers[nome])
    if (!dada.success) {
      const problema = dada.error.issues[0]!
      const campo = problema.path[0]
      throw defeitoDeForma(['answers', nome, ...(typeof campo === 'string' ? [campo] : [])], problema.code)
    }
    respostas[nome] = doFio(dada.data)
  }

  if (!ehNomeDeModelo(envelope.data.model)) {
    // Troca de nome não é silenciosa: o tamanho diz o bastante, o valor não sai.
    registrarLog('aviso', 'a TypeSafe devolveu um nome de modelo fora da forma; vale o pedido', {
      fornecedor: PERFIL_TYPESAFE.nome,
      tamanho: envelope.data.model.length,
    })
    return { respostas, modelo: null }
  }
  return { respostas, modelo: envelope.data.model }
}

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

/**
 * Corpo que não vai ser lido é cancelado: pendurado, ele segura a conexão até
 * o prazo ou o coletor de lixo. Falhar ao cancelar não muda nada para quem
 * chamou — o erro que importa é o que vem depois.
 */
async function descartarCorpo(resposta: Response): Promise<void> {
  await resposta.body?.cancel().catch(() => {})
}

/**
 * O corpo, lido até `MAIOR_RESPOSTA_BYTES`. Acima disso a leitura é cancelada
 * — pelo tamanho declarado, antes de ler, ou pelo contado, durante.
 *
 * O prazo (`AbortSignal.timeout`) vale também aqui: um corpo que trava no meio
 * rejeita com `TimeoutError`, e ele sobe como é. Não passa pelo "não é JSON"
 * abaixo, que registraria o motivo errado.
 */
async function lerComTeto(resposta: Response): Promise<string> {
  const declarado = Number(resposta.headers.get('content-length'))
  if (declarado > MAIOR_RESPOSTA_BYTES) {
    await descartarCorpo(resposta)
    throw new Error('a resposta da TypeSafe passa do tamanho aceito')
  }
  if (!resposta.body) return ''

  const leitor = resposta.body.getReader()
  const partes: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await leitor.read()
    if (done) break
    total += value.byteLength
    if (total > MAIOR_RESPOSTA_BYTES) {
      await leitor.cancel()
      throw new Error('a resposta da TypeSafe passa do tamanho aceito')
    }
    partes.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(partes))
}

export function clienteTypeSafe(chave: string | undefined = ambiente().TYPESAFE_API_KEY): ClienteDeClassificacao {
  // `ambiente()` já recusa `CLASSIFICADOR_ADAPTER=typesafe` sem chave; esta é
  // a segunda tranca, para quem construir o cliente direto.
  if (!chave?.trim()) throw new Error('TYPESAFE_API_KEY ausente: o classificador da TypeSafe não pode subir.')

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
        await descartarCorpo(resposta)
        throw new FalhaDaTypeSafe(resposta.status, resposta.headers.get('x-typesafe-request-id'))
      }

      const texto = await lerComTeto(resposta)
      let corpo: unknown
      try {
        corpo = JSON.parse(texto)
      } catch {
        // 200 que não é JSON é TRANSPORTE, de propósito: é a página de um
        // proxy ou de manutenção no caminho, não uma resposta do Jev com a
        // forma errada. Conta no disjuntor — se durar, parar de perguntar é
        // o certo. (Na IA é o contrário, e lá faz sentido: o texto do modelo
        // chegou, e só o formato falhou.)
        throw new Error('a resposta da TypeSafe não é JSON')
      }

      // `lerResultado` lança `ZodError` — o sinal de FORMA para
      // `especieDoErro` —, com caminho só de nomes nossos.
      const resultado = lerResultado(corpo, perguntas)
      return { respostas: resultado.respostas, modeloUsado: resultado.modelo ?? modelo }
    },
  }
}
