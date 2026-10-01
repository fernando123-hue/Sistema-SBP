import { CASOS_DO_GABARITO, emailDoCaso } from '../core/avaliacao/casos'
import {
  pontuarCaso,
  pontuarFalha,
  resumirAvaliacao,
  type CasoDoGabarito,
  type NotaDoCaso,
  type ResumoDaAvaliacao,
} from '../core/avaliacao/gabarito'
import { limiarConfiancaSemente } from '../core/config'
import type { MotivoDaConferencia } from '../core/conferencia-da-extracao'
import { InterpretacaoSchema, type EmailBruto, type Interpretacao } from '../core/esquemas'
import { FalhaDeInterpretacao, type AiPort } from '../ports/ia'
import { conferirItens, motivoDeRevisaoDoItem } from './ingestao'

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
  /** Um por caso, na ordem dos casos. */
  medicoes: MedicaoDoCaso[]
}

/**
 * O que a nota não diz e a linha de chegada pede (`ESTADO.md`): quanto tempo
 * cada e-mail leva — decide se a sincronização vira rotina em segundo plano —
 * e quanto a conferência da pendência 17 muda o destino dos itens.
 *
 * Só números e motivos: nenhum valor extraído, nenhum nome de campo, nenhum
 * texto do e-mail.
 *
 * O tempo é um PISO do que a ingestão gasta por e-mail: não inclui a segunda
 * opinião do classificador nem a gravação, e os e-mails do gabarito são curtos.
 */
export interface MedicaoDoCaso {
  id: string
  /** Do pedido à resposta (ou à falha) da porta, em milissegundos. */
  ms: number
  /** `null` quando o caso falhou: sem itens não há o que conferir. */
  conferencia: EfeitoDaConferencia | null
}

export interface EfeitoDaConferencia {
  itens: number
  /** Itens em que a conferência achou algum problema. */
  comProblema: number
  /**
   * Itens que, sem a conferência, entrariam APROVADOS e com ela vão para a
   * Revisão. É o efeito real: problema num item que já iria para a Revisão
   * por outro motivo não muda nada para quem trabalha.
   */
  mudamDeDestino: number
  motivos: Partial<Record<MotivoDaConferencia, number>>
}

export async function avaliarInterpretacao(
  porta: AiPort,
  casos: readonly CasoDoGabarito[] = CASOS_DO_GABARITO,
  // Injetável só para o teste: com o relógio de verdade, o tempo seria o que
  // a máquina do teste quisesse.
  agora: () => number = () => performance.now(),
): Promise<ResultadoDaAvaliacao> {
  const notas: NotaDoCaso[] = []
  const medicoes: MedicaoDoCaso[] = []
  const modelos = new Set<string>()
  const versoesPrompt = new Set<string>()

  // Um caso por vez, de propósito: a camada gratuita do Gemini tem limite por
  // minuto, e o servidor local de 8 GB (`A56`) atende uma chamada por vez.
  // É também o que deixa o tempo medido ser o de UM e-mail.
  for (const caso of casos) {
    const email = emailDoCaso(caso)
    const inicio = agora()
    const nota = await avaliarCaso(porta, caso, email)
    const ms = Math.round(agora() - inicio)
    notas.push(nota.nota)
    medicoes.push({ id: caso.id, ms, conferencia: nota.resposta ? efeitoDaConferencia(email, nota.resposta) : null })
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
    medicoes,
  }
}

async function avaliarCaso(
  porta: AiPort,
  caso: CasoDoGabarito,
  email: EmailBruto,
): Promise<{ nota: NotaDoCaso; resposta: Interpretacao | null }> {
  let bruta: unknown
  try {
    bruta = await porta.interpretar(email)
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

export interface ResumoDasMedicoes {
  /** Tempo do caso do meio — um e-mail lento não puxa a conta como na média. */
  msMediana: number
  msMaximo: number
  msTotal: number
  itens: number
  comProblema: number
  mudamDeDestino: number
}

export function resumirMedicoes(medicoes: readonly MedicaoDoCaso[]): ResumoDasMedicoes {
  const tempos = medicoes.map((m) => m.ms).sort((a, b) => a - b)
  const meio = Math.floor(tempos.length / 2)
  const msMediana =
    tempos.length === 0 ? 0 : tempos.length % 2 === 1 ? tempos[meio]! : Math.round((tempos[meio - 1]! + tempos[meio]!) / 2)
  const somar = (campo: 'itens' | 'comProblema' | 'mudamDeDestino') =>
    medicoes.reduce((total, m) => total + (m.conferencia?.[campo] ?? 0), 0)
  return {
    msMediana,
    msMaximo: tempos.at(-1) ?? 0,
    msTotal: tempos.reduce((total, ms) => total + ms, 0),
    itens: somar('itens'),
    comProblema: somar('comProblema'),
    mudamDeDestino: somar('mudamDeDestino'),
  }
}

/**
 * O destino de cada item com e sem a conferência, pela mesma regra da
 * ingestão (`motivoDeRevisaoDoItem`, `conferirItens`). O limiar é o de nascença da
 * categoria: o gabarito roda sem banco, e o operador ainda não ajustou nenhum.
 * O gabarito não tem anexo, então "anexo rejeitado" é sempre falso aqui.
 */
function efeitoDaConferencia(email: EmailBruto, interpretacao: Interpretacao): EfeitoDaConferencia {
  const conferencias = conferirItens(email, interpretacao)
  // Mesma guarda da ingestão: item sem conferência contaria como "sem
  // problema" em silêncio (invariante 7, revisão técnica do #166).
  if (conferencias.length !== interpretacao.itens.length) {
    throw new Error('a conferência da extração não corresponde aos itens da interpretação')
  }
  const motivos: Partial<Record<MotivoDaConferencia, number>> = {}
  let comProblema = 0
  let mudamDeDestino = 0
  for (const [posicao, item] of interpretacao.itens.entries()) {
    const problema = conferencias[posicao]!.problema
    if (!problema) continue
    comProblema += 1
    motivos[problema.motivo] = (motivos[problema.motivo] ?? 0) + 1
    const limiar = limiarConfiancaSemente(item.categoriaCodigo)
    const semConferencia = motivoDeRevisaoDoItem(item, limiar, interpretacao, 0, null)
    const comConferencia = motivoDeRevisaoDoItem(item, limiar, interpretacao, 0, problema.motivo)
    if (semConferencia === null && comConferencia !== null) mudamDeDestino += 1
  }
  return { itens: interpretacao.itens.length, comProblema, mudamDeDestino, motivos }
}
