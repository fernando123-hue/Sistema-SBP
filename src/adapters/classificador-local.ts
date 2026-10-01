import { z } from 'zod'

import { ehNomeDeModelo } from '../core/ia/nome-de-modelo'
import type { Pergunta, Resposta } from '../ports/classificador'
import { ambiente } from '../servidor/ambiente'
import type { ClienteDeClassificacao, PerfilDoClassificador } from './classificador-externo'

/**
 * Classificador próprio — a IA local respondendo perguntas fechadas (`A70`).
 *
 * ═══ O QUE ELE É ═══
 *
 * O "Jev próprio" do caminho (a) da Parte IV de
 * `docs/arquitetura/2026-09-29-jev-harness-e-operacao-autonoma.md`: o mesmo
 * modelo que interpreta os e-mails (`A59`), no mesmo servidor compatível com
 * OpenAI (`A56 (b)`), recebe uma pergunta fechada com as opções em LETRAS e
 * responde UMA letra. A probabilidade de cada opção não é pedida ao modelo em
 * texto — seria um número que ele inventa —: ela sai dos *logprobs* que o
 * servidor devolve para aquele único token. É a mesma porta do Jev, então a
 * política comum (`ClassificadorExterno`) vale inteira: camada de defesa,
 * detecção de injeção, conferência de coerência e cópia só do que foi
 * perguntado.
 *
 * ═══ POR QUE CADA PERGUNTA É UMA CHAMADA ═══
 *
 * Um token por resposta é o que torna a probabilidade honesta: com várias
 * respostas num texto só, a probabilidade de cada letra dependeria do que o
 * modelo escreveu antes. O custo é ler o texto uma vez por pergunta; por isso
 * o texto vem ANTES da pergunta na mensagem, e o prefixo igual entre as
 * perguntas deixa o servidor reaproveitar a leitura (Ollama e llama.cpp
 * guardam o prefixo).
 *
 * ═══ FALHA ALTA, NUNCA OPINIÃO INVENTADA ═══
 *
 * - Servidor sem *logprobs* (versão antiga, ou que ignora o campo): falha de
 *   forma, nunca "probabilidade 1 para a letra escrita".
 * - Modelo que gasta o token com outra coisa ("Resposta", "Olá"): se as letras
 *   das opções não somam pelo menos `MASSA_MINIMA` das probabilidades
 *   devolvidas, ele não respondeu à pergunta. Renormalizar o resto daria uma
 *   certeza que ninguém teve.
 *
 * ═══ O QUE NÃO MUDA ═══
 *
 * Só opina em MODO SOMBRA, como o Jev (`A62`, `§ H.4` 37). E não recebe
 * e-mail de associado enquanto o dono não decidir: a trava é
 * `CLASSIFICADOR_PARA_DADO_REAL.local`, em `servidor/ambiente.ts`, pela mesma
 * condição da IA local (`A56 (e)`).
 */

/**
 * Prazo por pergunta. É uma letra, mas o texto inteiro é lido antes dela, e na
 * máquina da IA local (CPU de 2012, sem GPU, `A59`) a leitura leva dezenas de
 * segundos. Dois minutos cobrem isso com folga e ainda transformam a chamada
 * pendurada em falha de transporte.
 */
export const TEMPO_LIMITE_MS = 120_000

/** O protocolo OpenAI aceita no máximo 20 alternativas por token. */
const MAXIMO_DE_ALTERNATIVAS = 20

/**
 * Quanto das probabilidades devolvidas precisa cair nas letras das opções.
 *
 * Abaixo disso o modelo não respondeu à pergunta: escreveu outra coisa. Metade
 * é o mínimo para a escolha mais provável ser, de fato, uma das opções.
 */
export const MASSA_MINIMA = 0.5

/** Uma resposta de verdade tem poucas centenas de bytes. */
const MAIOR_RESPOSTA_BYTES = 256 * 1024

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * O que o modelo lê antes de cada pergunta. Literal deste arquivo: nenhuma
 * parte vem do e-mail (as perguntas e as opções também não — `ports/classificador.ts`).
 */
const PAPEL =
  'Você classifica textos. Leia o texto e responda à pergunta com UMA letra, a da opção certa. ' +
  'Escreva só a letra, sem explicação.'

export const PERFIL_CLASSIFICADOR_LOCAL: PerfilDoClassificador = {
  nome: 'local',
  // Vazio de propósito, como em `ia-local.ts`: cada servidor serve o que
  // baixaram nele, e `ambiente()` exige o nome quando este classificador liga.
  modeloPadrao: '',
  ehCredencialRecusada: (erro) => {
    if (typeof erro !== 'object' || erro === null) return false
    const status = (erro as { status?: unknown }).status
    return status === 401 || status === 403
  },
}

/** O erro do servidor, sem o corpo: ele pode ecoar o pedido, que leva o e-mail. */
class FalhaDoServidorLocal extends Error {
  constructor(readonly status: number) {
    super(`o servidor de modelo respondeu ${status} (veja o log do próprio servidor)`)
  }
}

// ─── O fio ───────────────────────────────────────────────────────────────────

const AlternativaSchema = z.object({ token: z.string(), logprob: z.number() })

const RespostaNoFioSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        logprobs: z.object({
          content: z
            .array(z.object({ top_logprobs: z.array(AlternativaSchema).min(1) }))
            .min(1),
        }),
      }),
    )
    .min(1),
})

/**
 * Defeito de forma com caminho só de nomes NOSSOS, para `especieDoErro` ler
 * `validacao` e `resumoDeValidacao` não citar nada que veio do servidor
 * (o mesmo cuidado de `classificador-typesafe.ts`).
 */
function defeitoDeForma(caminho: string[], codigo: string): z.ZodError {
  return new z.ZodError([{ code: codigo, path: caminho, message: '' } as z.core.$ZodIssue])
}

/** Cada opção da pergunta, com a letra que a representa e o rótulo NOSSO. */
interface Opcao {
  readonly letra: string
  readonly rotulo: string
  readonly descricao: string | null
}

export function opcoesDaPergunta(pergunta: Pergunta): Opcao[] {
  const pares: [string, string | null][] =
    pergunta.tipo === 'sim_ou_nao'
      ? [
          ['sim', pergunta.seSim ?? null],
          ['nao', pergunta.seNao ?? null],
        ]
      : pergunta.tipo === 'escolha'
        ? Object.entries(pergunta.opcoes)
        : pergunta.niveis.map((descricao, nivel) => [String(nivel), descricao])
  if (pares.length > LETRAS.length) {
    // Defeito de quem escreveu a pergunta, no código — não do servidor.
    throw new Error(`pergunta com ${pares.length} opções; o classificador local aceita até ${LETRAS.length}`)
  }
  return pares.map(([rotulo, descricao], indice) => ({ letra: LETRAS[indice]!, rotulo, descricao }))
}

/** A mensagem da pergunta: o texto primeiro (prefixo comum), a pergunta depois. */
export function mensagemDaPergunta(estado: string, pergunta: Pergunta, opcoes: readonly Opcao[]): string {
  const rotuloLegivel = (rotulo: string) => (rotulo === 'nao' ? 'não' : rotulo)
  const linhas = opcoes.map(({ letra, rotulo, descricao }) =>
    pergunta.tipo === 'escolha' || pergunta.tipo === 'sim_ou_nao'
      ? `${letra}) ${rotuloLegivel(rotulo)}${descricao ? ` — ${descricao}` : ''}`
      : `${letra}) nível ${rotulo}${descricao ? ` — ${descricao}` : ''}`,
  )
  return `${estado}\n\nPergunta: ${pergunta.instrucoes}\n\nOpções:\n${linhas.join('\n')}\n\nResposta (só a letra):`
}

/**
 * A letra que um token representa, ou `null`. Tokens chegam com espaço antes,
 * em minúscula ou com a pontuação colada (" A", "a", "A)"): todos são a letra A.
 */
function letraDoToken(token: string): string | null {
  const limpo = token.trim().replace(/[).:]$/, '').toUpperCase()
  return limpo.length === 1 && LETRAS.includes(limpo) ? limpo : null
}

/**
 * As probabilidades de cada opção, a partir das alternativas do primeiro token.
 *
 * Alternativas que são a mesma letra somam; o que não é letra de opção fica
 * fora. Se as letras não chegam a `MASSA_MINIMA`, o modelo não respondeu à
 * pergunta — e isso é forma errada, não opinião.
 */
export function probabilidadesDasOpcoes(
  alternativas: readonly { token: string; logprob: number }[],
  opcoes: readonly Opcao[],
  nome: string,
): Record<string, number> {
  const massa = new Map<string, number>()
  let total = 0
  for (const { token, logprob } of alternativas) {
    const probabilidade = Math.exp(logprob)
    if (!Number.isFinite(probabilidade)) continue
    const letra = letraDoToken(token)
    if (letra === null || !opcoes.some((opcao) => opcao.letra === letra)) continue
    massa.set(letra, (massa.get(letra) ?? 0) + probabilidade)
    total += probabilidade
  }
  if (total < MASSA_MINIMA) throw defeitoDeForma(['respostas', nome], 'too_small')
  return Object.fromEntries(opcoes.map(({ letra, rotulo }) => [rotulo, (massa.get(letra) ?? 0) / total]))
}

/** A resposta da porta, no tipo que a pergunta pediu. */
export function respostaDaPergunta(pergunta: Pergunta, probabilidades: Record<string, number>): Resposta {
  if (pergunta.tipo === 'sim_ou_nao') return { tipo: 'sim_ou_nao', probabilidadeDeSim: probabilidades['sim']! }
  const rotulos = Object.keys(probabilidades)
  const escolha = rotulos.reduce((melhor, rotulo) => (probabilidades[rotulo]! > probabilidades[melhor]! ? rotulo : melhor))
  if (pergunta.tipo === 'escolha') {
    return { tipo: 'escolha', escolha, confianca: probabilidades[escolha]!, probabilidades }
  }
  const nota = rotulos.reduce((soma, rotulo) => soma + Number(rotulo) * probabilidades[rotulo]!, 0)
  return { tipo: 'nota', nota, confianca: probabilidades[escolha]!, probabilidades }
}

async function lerComTeto(resposta: Response): Promise<string> {
  const declarado = Number(resposta.headers.get('content-length'))
  if (declarado > MAIOR_RESPOSTA_BYTES) {
    await resposta.body?.cancel().catch(() => {})
    throw new Error('a resposta do servidor de modelo passa do tamanho aceito')
  }
  const texto = await resposta.text()
  if (texto.length > MAIOR_RESPOSTA_BYTES) throw new Error('a resposta do servidor de modelo passa do tamanho aceito')
  return texto
}

export function clienteClassificadorLocal(
  base: string = ambiente().IA_LOCAL_URL,
  chave: string | undefined = ambiente().IA_LOCAL_CHAVE,
): ClienteDeClassificacao {
  // `ambiente()` já recusa `CLASSIFICADOR_ADAPTER=local` sem endereço; esta é
  // a segunda tranca, para quem construir o cliente direto.
  if (!base) throw new Error('IA_LOCAL_URL ausente: o classificador local não pode subir.')
  const alvo = `${base.replace(/\/+$/, '')}/chat/completions`

  async function perguntarUma(estado: string, nome: string, pergunta: Pergunta, modelo: string) {
    const opcoes = opcoesDaPergunta(pergunta)
    const resposta = await fetch(alvo, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(chave ? { authorization: `Bearer ${chave}` } : {}) },
      body: JSON.stringify({
        model: modelo,
        messages: [
          { role: 'system', content: PAPEL },
          { role: 'user', content: mensagemDaPergunta(estado, pergunta, opcoes) },
        ],
        temperature: 0,
        max_tokens: 1,
        logprobs: true,
        top_logprobs: Math.min(MAXIMO_DE_ALTERNATIVAS, Math.max(5, opcoes.length + 5)),
      }),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      // Não segue redirecionamento: o POST, com o texto dentro, iria para onde
      // a resposta mandasse (achado do PR #74, no adaptador da IA local).
      redirect: 'manual',
    })

    if (resposta.status >= 300 && resposta.status < 400) {
      await resposta.body?.cancel().catch(() => {})
      throw new Error(`o servidor de modelo respondeu com redirecionamento (${resposta.status}), que não é seguido`)
    }
    if (!resposta.ok) {
      await resposta.body?.cancel().catch(() => {})
      throw Object.assign(new FalhaDoServidorLocal(resposta.status), { status: resposta.status })
    }

    let corpo: unknown
    try {
      corpo = JSON.parse(await lerComTeto(resposta))
    } catch (erro) {
      if (erro instanceof Error && erro.message.includes('tamanho aceito')) throw erro
      throw new Error('a resposta do servidor de modelo não é JSON')
    }

    const lido = RespostaNoFioSchema.safeParse(corpo)
    // Sem `logprobs` não há probabilidade honesta — só a letra que o modelo
    // escreveu. Isso é forma errada, e o caminho só cita nomes nossos.
    if (!lido.success) throw defeitoDeForma(['respostas', nome, 'logprobs'], lido.error.issues[0]!.code)

    const alternativas = lido.data.choices[0]!.logprobs.content[0]!.top_logprobs
    const probabilidades = probabilidadesDasOpcoes(alternativas, opcoes, nome)
    return { resposta: respostaDaPergunta(pergunta, probabilidades), modelo: lido.data.model }
  }

  return {
    async perguntar({ estado, perguntas, modelo }) {
      const respostas: Record<string, Resposta> = {}
      let modeloUsado = modelo
      for (const [nome, pergunta] of Object.entries(perguntas)) {
        const { resposta, modelo: devolvido } = await perguntarUma(estado, nome, pergunta, modelo)
        respostas[nome] = resposta
        if (devolvido && ehNomeDeModelo(devolvido)) modeloUsado = devolvido
      }
      return { respostas, modeloUsado }
    },
  }
}
