import { CASOS_DO_GABARITO, emailDoCaso } from '../core/avaliacao/casos'
import {
  pontuarCaso,
  pontuarFalha,
  resumirAvaliacao,
  type CasoDoGabarito,
  type NotaDoCaso,
  type ResumoDaAvaliacao,
} from '../core/avaliacao/gabarito'
import { InterpretacaoSchema } from '../core/esquemas'
import { FalhaDeInterpretacao, type AiPort } from '../ports/ia'

/**
 * Roda um `AiPort` qualquer contra o gabarito e devolve a nota.
 *
 * Recebe a porta pronta — quem escolhe o fornecedor continua sendo
 * `criarAiPort()`. Por isso a mesma avaliação mede Anthropic, Gemini, o mock
 * e o modelo local que ainda vai existir (`A56`), sem `if` por fornecedor.
 *
 * Nada aqui grava no banco nem em arquivo: o resultado é só números e
 * identificadores de caso, e quem chama decide onde ele vai.
 */

export interface ResultadoDaAvaliacao {
  adapter: string
  /** Os modelos que responderam, na ordem em que apareceram. */
  modelos: string[]
  versoesPrompt: string[]
  notas: NotaDoCaso[]
  resumo: ResumoDaAvaliacao
}

export async function avaliarInterpretacao(
  porta: AiPort,
  casos: readonly CasoDoGabarito[] = CASOS_DO_GABARITO,
): Promise<ResultadoDaAvaliacao> {
  const notas: NotaDoCaso[] = []
  const modelos = new Set<string>()
  const versoesPrompt = new Set<string>()

  // Um caso por vez, de propósito: a camada gratuita do Gemini tem limite por
  // minuto, e o servidor local de 8 GB (`A56`) atende uma chamada por vez.
  for (const caso of casos) {
    const nota = await avaliarCaso(porta, caso)
    notas.push(nota.nota)
    if (nota.resposta) {
      modelos.add(nota.resposta.modelo)
      versoesPrompt.add(nota.resposta.versaoPrompt)
    }
  }

  return {
    adapter: porta.nome,
    modelos: [...modelos],
    versoesPrompt: [...versoesPrompt],
    notas,
    resumo: resumirAvaliacao(notas),
  }
}

async function avaliarCaso(
  porta: AiPort,
  caso: CasoDoGabarito,
): Promise<{ nota: NotaDoCaso; resposta: { modelo: string; versaoPrompt: string } | null }> {
  let bruta: unknown
  try {
    bruta = await porta.interpretar(emailDoCaso(caso))
  } catch (erro) {
    // Só a falha DESTE e-mail vira nota. Fornecedor indisponível (chave,
    // crédito) e defeito de código sobem: nota zero esconderia uma variável de
    // ambiente errada atrás de "o modelo é ruim" (invariante 7).
    if (erro instanceof FalhaDeInterpretacao) return { nota: pontuarFalha(caso, erro.causa), resposta: null }
    throw erro
  }

  // A porta promete validar, mas a nota não confia na promessa: um adapter
  // novo que esquecesse o esquema seria medido com resposta que o sistema
  // real recusaria.
  const resposta = InterpretacaoSchema.safeParse(bruta)
  if (!resposta.success) {
    return { nota: pontuarFalha(caso, 'resposta fora do esquema de interpretação'), resposta: null }
  }
  return { nota: pontuarCaso(caso, resposta.data), resposta: resposta.data }
}
