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
 * lista de opções numeradas, o modelo responde UM algarismo, e a probabilidade
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
 * Os códigos das opções: algarismos de 1 a 9.
 *
 * Um algarismo cabe num token em todo tokenizador comum; o rótulo nosso
 * (`FICHA_CADASTRO`) não caberia, e o primeiro token de dois rótulos
 * parecidos seria o mesmo. ALGARISMO, e não letra: "A", "E" e "O" são
 * artigo e conjunção em português, e com um token só, "A opção certa é C"
 * viraria a opção A com certeza alta, sem aviso (revisão técnica do #160).
 *
 * E no máximo nove: o topo de logprobs tem 20 tokens, repartidos entre as
 * variantes de cada código ("1", "␣1", "1)"). Com opções demais, uma
 * plausível ficaria fora do topo e valeria 0 sem falhar.
 */
const CODIGOS = '123456789'

/**
 * Quanto da probabilidade do primeiro token precisa cair nos códigos pedidos.
 *
 * Abaixo disso o modelo não respondeu à pergunta — começou uma frase, pôs
 * uma cerca, repetiu o texto —, e normalizar o resto inventaria certeza a
 * partir de sobra. Metade é o mínimo para que a resposta seja, de fato, uma
 * das opções.
 */
export const MASSA_MINIMA = 0.5

/** Quanto a soma do topo pode passar de 1 por arredondamento do servidor. */
const FOLGA_DA_SOMA = 0.05

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

// ─── A pergunta como lista numerada ───────────────────────────────────────────

interface Opcao {
  /** O rótulo NOSSO que o código representa. */
  readonly rotulo: string
  readonly descricao: string | null
}

/**
 * As opções de cada tipo de pergunta, na ordem em que viram códigos (1, 2…).
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
  // Pergunta com mais opções que códigos é defeito de quem a escreveu, no
  // código — sobe como `Error` comum, para a suíte pegar.
  if (opcoes.length > CODIGOS.length) throw new Error(`pergunta com mais de ${CODIGOS.length} opções`)
  return opcoes
}

/**
 * As instruções da pergunta, com as opções numeradas.
 *
 * Tudo aqui é texto NOSSO: `instrucoes`, rótulos e descrições são constantes
 * do código (`ports/classificador.ts`). O texto de fora vai na outra
 * mensagem, já delimitado.
 */
export function instrucoesDaPergunta(pergunta: Pergunta): string {
  const linhas = opcoesDaPergunta(pergunta).map((opcao, indice) => {
    // Na nota, o nível vai por extenso: "1) nível 0" e não "1) 0", que
    // confundiria o código com o nível.
    const nome =
      pergunta.tipo === 'sim_ou_nao'
        ? opcao.rotulo === 'sim'
          ? 'Sim'
          : 'Não'
        : pergunta.tipo === 'nota'
          ? `nível ${opcao.rotulo}`
          : opcao.rotulo
    return `${CODIGOS[indice]}) ${nome}${opcao.descricao ? `: ${opcao.descricao}` : ''}`
  })
  return (
    'Você responde a uma pergunta fechada sobre um texto. Responda com UM algarismo, o da opção certa, ' +
    'e nada mais.\n\n' +
    `Pergunta: ${pergunta.instrucoes}\n\n` +
    `Opções:\n${linhas.join('\n')}`
  )
}

/**
 * A opção que um token representa — ou `null`.
 *
 * Espaço antes ("␣1") e uma pontuação depois ("1)", "1.") são o mesmo 1 em
 * tokenizadores diferentes. Qualquer outra coisa ("12", "Sim") não é código
 * de opção e não soma em nada.
 */
function opcaoDoToken(token: string, quantas: number): number | null {
  const limpo = token.trim().replace(/[).:]$/, '')
  if (limpo.length !== 1) return null
  const indice = CODIGOS.indexOf(limpo)
  return indice >= 0 && indice < quantas ? indice : null
}

/**
 * As probabilidades das opções, a partir do topo de logprobs do 1º token.
 *
 * Soma o que cai em cada código (o mesmo 1 pode vir em mais de um token),
 * confere a massa mínima e normaliza. Exportada para o teste conferir a
 * conta sem servidor.
 */
export function probabilidadesDasOpcoes(
  topo: readonly { readonly token: string; readonly logprob: number | null }[],
  quantas: number,
): number[] {
  // O mesmo token repetido no topo conta uma vez: um servidor que o repita não
  // pode dobrar o voto de uma opção. `null` é como servidores escrevem
  // -Infinity em JSON — probabilidade zero, não motivo para recusar a resposta.
  const porToken = new Map<string, number>()
  for (const { token, logprob } of topo) {
    const probabilidade = logprob === null ? 0 : Math.exp(logprob)
    porToken.set(token, Math.max(porToken.get(token) ?? 0, probabilidade))
  }
  const comProbabilidade = [...porToken].filter(([, probabilidade]) => probabilidade > 0)

  // Uma alternativa só com probabilidade é o servidor devolvendo o que SORTEOU
  // (amostragem gulosa com `temperature: 0`), não o que o modelo achava de
  // cada opção. Normalizar isso daria certeza a quem não teve (revisões do #159).
  if (comProbabilidade.length < 2) throw defeitoDeForma('opcao', 'custom')

  // Probabilidades que somam bem mais que 1 não são uma distribuição: é o
  // servidor respondendo outra coisa (vários `logprob: 0`, por exemplo), e
  // normalizar daria número a uma resposta incoerente (revisão de segurança
  // do #169). A folga cobre o arredondamento do servidor.
  const soma = comProbabilidade.reduce((total, [, probabilidade]) => total + probabilidade, 0)
  if (soma > 1 + FOLGA_DA_SOMA) throw defeitoDeForma('opcao', 'custom')

  const massa = new Array<number>(quantas).fill(0)
  let melhorFora = 0
  for (const [token, probabilidade] of comProbabilidade) {
    const indice = opcaoDoToken(token, quantas)
    if (indice !== null) massa[indice]! += probabilidade
    else melhorFora = Math.max(melhorFora, probabilidade)
  }

  // A opção mais provável precisa vencer o que o modelo preferia escrever
  // FORA das opções. Sem isto, "1" 0,26 + "2" 0,25 passava a massa mínima com
  // "Olá" a 0,49 no topo: ele queria escrever outra coisa (revisões do #159).
  // A comparação é com a MASSA da opção, somadas as variantes ("2", "␣2"):
  // token a token, "2" 0,30 + "␣2" 0,30 perdia para "Olá" 0,35, e uma
  // resposta boa virava falha (revisão técnica do #169).
  if (Math.max(...massa) < melhorFora) throw defeitoDeForma('opcao', 'custom')

  const total = massa.reduce((acumulado, valor) => acumulado + valor, 0)
  if (!(total >= MASSA_MINIMA)) throw defeitoDeForma('opcao', 'custom')
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

/**
 * Sequências que o servidor local pode tomar por marcação do próprio diálogo
 * (`<|im_start|>`, `[INST]`, `</s>`, `<start_of_turn>`): o template de chat é
 * aplicado DEPOIS de montada a mensagem, e um e-mail que as escrevesse
 * poderia abrir um papel novo fora dos delimitadores. Ganham um espaço no meio
 * e deixam de ser o que eram. Não toca nos marcadores `<<<…>>>`. Cobertura
 * conhecida e limites: revisões do #159 (não cobre `<<SYS>>` nem as variantes
 * de largura total do DeepSeek, que só importam se o modelo trocar).
 */
export function semMarcacaoDeDialogo(texto: string): string {
  return texto
    .replace(/<\|/g, '< |')
    .replace(/\|>/g, '| >')
    .replace(/\[(\/?)INST\]/gi, '[$1 INST]')
    .replace(/<(\/?)s>/gi, '<$1 s>')
    .replace(/<(start|end)_of_turn>/gi, '< $1_of_turn>')
}

// ─── O fio: protocolo OpenAI ──────────────────────────────────────────────────

const TopoSchema = z.array(z.object({ token: z.string(), logprob: z.number().max(0).nullable() }))

const RespostaNoFioSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        logprobs: z
          .object({ content: z.array(z.object({ top_logprobs: TopoSchema })).nullable() })
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
  // Ausente, nulo ou vazio é o mesmo diagnóstico: não veio logprob
  // (revisão técnica do #160 — vazio saía como `choices`).
  const primeiro = lido.data.choices[0]!.logprobs?.content?.[0]
  if (!primeiro) throw defeitoDeForma('logprobs', 'invalid_type')
  return { topo: primeiro.top_logprobs, modelo: lido.data.model }
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
          { role: 'user', content: semMarcacaoDeDialogo(estado) },
        ],
        temperature: 0,
        // Um token: o algarismo. O tempo fica quase todo na leitura do texto.
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
      throw new FalhaDoServidorLocal(resposta.status)
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
    const probabilidades = probabilidadesDasOpcoes(topo, opcoesDaPergunta(pergunta).length)
    return { resposta: respostaDasProbabilidades(pergunta, probabilidades), modeloUsado }
  }

  return {
    async perguntar({ estado, perguntas, modelo }) {
      const respostas: Record<string, Resposta> = {}
      let modeloUsado: string | undefined
      // Uma pergunta por chamada, em série: cada uma precisa do seu
      // algarismo, e o servidor de 8 GB atende uma chamada por vez (`A56`).
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

/**
 * O cliente visto como uma pergunta por `perguntar`.
 *
 * O teto diário e o disjuntor (`fabrica.ts`) contam por `perguntar`, e este
 * cliente faz um pedido HTTP por pergunta. Sem isto, o teto que protege a
 * máquina contaria duas ou três vezes menos do que ela recebe, e uma chamada
 * controlada poderia durar N × o prazo (revisões técnica e de segurança do
 * #160). Por fora do controle, as respostas se juntam de volta.
 */
export function umaPerguntaPorChamada(cliente: ClienteDeClassificacao): ClienteDeClassificacao {
  return {
    async perguntar({ estado, perguntas, modelo }) {
      const respostas: Record<string, Resposta> = {}
      let modeloUsado: string | undefined
      for (const [nome, pergunta] of Object.entries(perguntas)) {
        const uma = await cliente.perguntar({ estado, perguntas: { [nome]: pergunta }, modelo })
        respostas[nome] = uma.respostas[nome]!
        modeloUsado ??= uma.modeloUsado
      }
      return { respostas, modeloUsado: modeloUsado || modelo }
    },
  }
}
