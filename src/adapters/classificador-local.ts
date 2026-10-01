import { z } from 'zod'

import type { Pergunta, Resposta } from '../ports/classificador'
import { ambiente, motivoDeEnderecoLocalInvalido } from '../servidor/ambiente'
import type { ClienteDeClassificacao, PerfilDoClassificador } from './classificador-externo'

/**
 * Classificador — a IA local respondendo perguntas fechadas (`A70`, o "Jev
 * próprio", fase P2 do IV.6 de `docs/arquitetura/2026-09-29-jev-harness-e-operacao-autonoma.md`).
 *
 * ═══ A IDEIA ═══
 *
 * O contrato do Jev já é nosso (`ports/classificador.ts`); só o modelo é da
 * TypeSafe. Aqui o modelo é o da máquina da associação (`A59`), pelo mesmo
 * servidor compatível com OpenAI de `ia-local.ts`. Cada pergunta vira uma
 * lista de opções com letras, o modelo responde UMA letra, e a probabilidade
 * de cada opção sai dos *logprobs* do primeiro token — não de um número que o
 * modelo escreve. Número escrito por modelo pequeno é palpite; logprob é a
 * conta que ele de fato fez.
 *
 * ═══ O QUE ESTE ARQUIVO NÃO FAZ ═══
 *
 * - **Não recebe texto cru.** Quem o chama é `ClassificadorExterno`, a mesma
 *   política do Jev: camada de defesa do dado, três camadas contra injeção e
 *   conferência da resposta. O texto não sai da casa, mas a comparação com o
 *   Jev só é justa se os dois lerem o MESMO texto mascarado (IV.6, P2).
 * - **Não recebe e-mail real.** `CLASSIFICADOR_PARA_DADO_REAL.local` nasce
 *   `false` em `servidor/ambiente.ts`, como `IA_PARA_DADO_REAL.local`.
 * - **Não repete nem sorteia.** Sem logprobs, a resposta é falha de forma, e
 *   alta: estimar a probabilidade sorteando várias respostas multiplicaria o
 *   tempo em CPU (IV.4) e daria um número de outra natureza com o mesmo nome.
 * - **Não segue redirecionamento**, pelo mesmo motivo de `ia-local.ts`.
 *
 * ═══ LIMITE CONHECIDO ═══
 *
 * Nenhum servidor real foi medido ainda (P1 depende da rede ou da máquina do
 * dono). O pedido segue o protocolo OpenAI (`logprobs` + `top_logprobs`), que
 * o llama.cpp implementa e o Ollama anuncia; se o servidor ignorar os campos,
 * a primeira chamada falha dizendo isso, e nada vira opinião.
 */

/**
 * Prazo por pergunta. A resposta é um token, então o tempo é quase só ler o
 * texto — em CPU fraca, dezenas de segundos para um e-mail longo. Mais que
 * isso é servidor preso, e a opinião é só complemento.
 */
export const TEMPO_LIMITE_MS = 60_000

/** O máximo que o protocolo OpenAI aceita. Opção fora do topo conta como 0. */
const TOP_LOGPROBS = 20

/**
 * Letras das opções. Uma letra por opção cabe num token em todo tokenizador
 * comum; o rótulo nosso (`FICHA_CADASTRO`) não caberia, e o primeiro token
 * de dois rótulos parecidos seria o mesmo.
 */
const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * Quanto da probabilidade do primeiro token precisa cair nas letras pedidas.
 *
 * Abaixo disso o modelo não respondeu à pergunta — começou uma frase, pôs
 * uma cerca, repetiu o texto —, e normalizar o resto inventaria certeza a
 * partir de sobra. Metade é o mínimo para que a resposta seja, de fato, uma
 * das opções.
 */
export const MASSA_MINIMA = 0.5

/** Teto do corpo, o mesmo da TypeSafe: a resposta boa tem poucos kB. */
export const MAIOR_RESPOSTA_BYTES = 256 * 1024

export const PERFIL_CLASSIFICADOR_LOCAL: PerfilDoClassificador = {
  nome: 'local',
  // Vazio de propósito, como em `ia-local.ts`: cada servidor serve o modelo
  // que baixaram nele. `ambiente.ts` exige `CLASSIFICADOR_MODELO`.
  modeloPadrao: '',
  ehCredencialRecusada: (erro) => {
    if (typeof erro !== 'object' || erro === null) return false
    const status = (erro as { status?: unknown }).status
    return status === 401 || status === 403
  },
}

/** O status, nunca o corpo: servidor local costuma ecoar o pedido no erro. */
class FalhaDoServidorLocal extends Error {
  constructor(readonly status: number) {
    super(`o servidor de modelo respondeu ${status} (veja o log do próprio servidor)`)
  }
}

/**
 * Defeito de forma com caminho e código escolhidos AQUI — nunca o que o
 * servidor mandou. `especieDoErro` lê `ZodError` como forma, e
 * `resumoDeValidacao` imprime só `caminho: código`.
 */
function defeitoDeForma(caminho: string, codigo: 'invalid_type' | 'custom'): z.ZodError {
  return new z.ZodError([{ code: codigo, path: [caminho], message: '' } as z.core.$ZodIssue])
}

// ─── A pergunta como lista de letras ──────────────────────────────────────────

interface Opcao {
  /** O rótulo NOSSO que a letra representa. */
  readonly rotulo: string
  readonly descricao: string | null
}

/**
 * As opções de cada tipo de pergunta, na ordem em que viram letras.
 *
 * `nota` vira opção por nível ("0", "1"…), que é a chave das probabilidades
 * em `ports/classificador.ts`. `sim_ou_nao` vira duas opções; a probabilidade
 * de "sim" é a da primeira.
 */
export function opcoesDaPergunta(pergunta: Pergunta): Opcao[] {
  let opcoes: Opcao[]
  switch (pergunta.tipo) {
    case 'sim_ou_nao':
      opcoes = [
        { rotulo: 'sim', descricao: pergunta.seSim ?? null },
        { rotulo: 'nao', descricao: pergunta.seNao ?? null },
      ]
      break
    case 'escolha':
      opcoes = Object.entries(pergunta.opcoes).map(([rotulo, descricao]) => ({ rotulo, descricao }))
      break
    case 'nota':
      opcoes = pergunta.niveis.map((descricao, nivel) => ({ rotulo: String(nivel), descricao }))
      break
  }
  // Pergunta com mais opções que letras é defeito de quem a escreveu, no
  // código — sobe como `Error` comum, para a suíte pegar.
  if (opcoes.length > LETRAS.length) throw new Error(`pergunta com mais de ${LETRAS.length} opções`)
  return opcoes
}

/**
 * As instruções da pergunta, com as opções e as letras.
 *
 * Tudo aqui é texto NOSSO: `instrucoes`, rótulos e descrições são constantes
 * do código (`ports/classificador.ts`). O texto de fora vai na outra
 * mensagem, já delimitado.
 */
export function instrucoesDaPergunta(pergunta: Pergunta): string {
  const linhas = opcoesDaPergunta(pergunta).map((opcao, indice) => {
    const nome = pergunta.tipo === 'sim_ou_nao' ? (opcao.rotulo === 'sim' ? 'Sim' : 'Não') : opcao.rotulo
    return `${LETRAS[indice]}) ${nome}${opcao.descricao ? `: ${opcao.descricao}` : ''}`
  })
  return (
    'Você responde a uma pergunta fechada sobre um texto. Responda com UMA letra, a da opção certa, ' +
    'e nada mais.\n\n' +
    `Pergunta: ${pergunta.instrucoes}\n\n` +
    `Opções:\n${linhas.join('\n')}`
  )
}

/**
 * A letra que um token representa — ou `null`.
 *
 * Espaço antes ("␣A") e uma pontuação depois ("A)", "A.") são o mesmo A em
 * tokenizadores diferentes; minúscula também. Qualquer outra coisa ("An",
 * "Sim") não é letra de opção e não soma em nada.
 */
function letraDoToken(token: string, quantas: number): number | null {
  const limpo = token.trim().replace(/[).:]$/, '').toUpperCase()
  if (limpo.length !== 1) return null
  const indice = LETRAS.indexOf(limpo)
  return indice >= 0 && indice < quantas ? indice : null
}

/**
 * As probabilidades das opções, a partir do topo de logprobs do 1º token.
 *
 * Soma o que cai em cada letra (o mesmo A pode vir em mais de um token),
 * confere a massa mínima e normaliza. Exportada para o teste conferir a
 * conta sem servidor.
 */
export function probabilidadesDasLetras(
  topo: readonly { readonly token: string; readonly logprob: number }[],
  quantas: number,
): number[] {
  const massa = new Array<number>(quantas).fill(0)
  for (const { token, logprob } of topo) {
    const indice = letraDoToken(token, quantas)
    if (indice !== null) massa[indice]! += Math.exp(logprob)
  }
  const total = massa.reduce((soma, valor) => soma + valor, 0)
  if (!(total >= MASSA_MINIMA)) throw defeitoDeForma('letra', 'custom')
  return massa.map((valor) => valor / total)
}

/** A resposta na forma da porta, a partir das probabilidades por opção. */
export function respostaDasProbabilidades(pergunta: Pergunta, probabilidades: readonly number[]): Resposta {
  if (pergunta.tipo === 'sim_ou_nao') return { tipo: 'sim_ou_nao', probabilidadeDeSim: probabilidades[0]! }

  const opcoes = opcoesDaPergunta(pergunta)
  const porRotulo = Object.fromEntries(opcoes.map((opcao, indice) => [opcao.rotulo, probabilidades[indice]!]))
  // Empate fica com a primeira opção: determinístico, e a política aceita.
  let maior = 0
  for (let indice = 1; indice < probabilidades.length; indice++) {
    if (probabilidades[indice]! > probabilidades[maior]!) maior = indice
  }
  const confianca = probabilidades[maior]!
  if (pergunta.tipo === 'escolha') {
    return { tipo: 'escolha', escolha: opcoes[maior]!.rotulo, confianca, probabilidades: porRotulo }
  }
  const nota = probabilidades.reduce((soma, valor, nivel) => soma + valor * nivel, 0)
  return { tipo: 'nota', nota, confianca, probabilidades: porRotulo }
}

// ─── O fio: protocolo OpenAI ──────────────────────────────────────────────────

const TopoSchema = z.array(z.object({ token: z.string(), logprob: z.number().max(0) }))

const RespostaNoFioSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        logprobs: z
          .object({ content: z.array(z.object({ top_logprobs: TopoSchema })).min(1) })
          .nullable()
          .optional(),
      }),
    )
    .min(1),
})

/**
 * O topo de logprobs do primeiro token, ou falha de FORMA.
 *
 * Os caminhos são nossos: sem `logprobs` o diagnóstico é "o servidor não
 * devolve logprobs" — a pergunta do P1 —, e ele precisa aparecer assim no log,
 * não como um erro genérico de JSON.
 */
function topoDoPrimeiroToken(corpo: unknown): { topo: z.infer<typeof TopoSchema>; modelo: string | undefined } {
  const lido = RespostaNoFioSchema.safeParse(corpo)
  if (!lido.success) throw defeitoDeForma('choices', 'invalid_type')
  const logprobs = lido.data.choices[0]!.logprobs
  if (!logprobs) throw defeitoDeForma('logprobs', 'invalid_type')
  return { topo: logprobs.content[0]!.top_logprobs, modelo: lido.data.model }
}

async function descartarCorpo(resposta: Response): Promise<void> {
  await resposta.body?.cancel().catch(() => {})
}

/** O corpo, lido até `MAIOR_RESPOSTA_BYTES` — pelo tamanho declarado e pelo contado. */
async function lerComTeto(resposta: Response): Promise<string> {
  const declarado = Number(resposta.headers.get('content-length'))
  if (declarado > MAIOR_RESPOSTA_BYTES) {
    await descartarCorpo(resposta)
    throw new Error('a resposta do servidor de modelo passa do tamanho aceito')
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
      throw new Error('a resposta do servidor de modelo passa do tamanho aceito')
    }
    partes.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(partes))
}

export function clienteClassificadorLocal(
  base: string = ambiente().IA_LOCAL_URL,
  chave: string | undefined = ambiente().IA_LOCAL_CHAVE,
): ClienteDeClassificacao {
  // `ambiente()` já confere o endereço quando `CLASSIFICADOR_ADAPTER=local`;
  // esta é a segunda tranca, para quem construir o cliente direto.
  if (!base) throw new Error('IA_LOCAL_URL ausente: o classificador local não pode subir.')
  const recusa = motivoDeEnderecoLocalInvalido(base)
  if (recusa) throw new Error(`IA_LOCAL_URL ${recusa}`)
  const alvo = `${base.replace(/\/+$/, '')}/chat/completions`

  async function perguntarUma(estado: string, pergunta: Pergunta, modelo: string) {
    const resposta = await fetch(alvo, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(chave ? { authorization: `Bearer ${chave}` } : {}),
      },
      body: JSON.stringify({
        model: modelo,
        messages: [
          { role: 'system', content: instrucoesDaPergunta(pergunta) },
          { role: 'user', content: estado },
        ],
        temperature: 0,
        // Um token: a letra. O tempo fica quase todo na leitura do texto.
        max_tokens: 1,
        logprobs: true,
        top_logprobs: TOP_LOGPROBS,
      }),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      redirect: 'manual',
    })

    if (resposta.status >= 300 && resposta.status < 400) {
      await descartarCorpo(resposta)
      throw new Error(
        `o servidor de modelo respondeu com redirecionamento (${resposta.status}), que não é seguido: ` +
          'IA_LOCAL_URL precisa apontar direto para o servidor.',
      )
    }
    if (!resposta.ok) {
      await descartarCorpo(resposta)
      throw Object.assign(new FalhaDoServidorLocal(resposta.status), { status: resposta.status })
    }

    // Fora do `try` do JSON: prazo e teto estourados na leitura sobem como são,
    // e não com o motivo errado.
    const texto = await lerComTeto(resposta)
    let corpo: unknown
    try {
      corpo = JSON.parse(texto)
    } catch {
      // 200 que não é JSON é transporte: página de proxy, não resposta de modelo.
      throw new Error('a resposta do servidor de modelo não é JSON')
    }

    const { topo, modelo: modeloUsado } = topoDoPrimeiroToken(corpo)
    const probabilidades = probabilidadesDasLetras(topo, opcoesDaPergunta(pergunta).length)
    return { resposta: respostaDasProbabilidades(pergunta, probabilidades), modeloUsado }
  }

  return {
    async perguntar({ estado, perguntas, modelo }) {
      const respostas: Record<string, Resposta> = {}
      let modeloUsado: string | undefined
      // Uma pergunta por chamada, em série: cada uma precisa da sua letra, e o
      // servidor de 8 GB atende uma chamada por vez (`A56`).
      for (const [nome, pergunta] of Object.entries(perguntas)) {
        const uma = await perguntarUma(estado, pergunta, modelo)
        respostas[nome] = uma.resposta
        modeloUsado ??= uma.modeloUsado
      }
      // A forma do nome é conferida na política (`ClassificadorExterno`).
      return { respostas, modeloUsado: modeloUsado || modelo }
    },
  }
}
