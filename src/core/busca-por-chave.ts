import { z } from 'zod'

import { normalizarCpf, normalizarMatricula } from './chave-de-busca'

/**
 * O que a pessoa digitou em "Buscar por CPF ou matrícula" (`A23(b)`, `A40`
 * resposta 24) — a parte pura.
 *
 * Decide se é CPF, matrícula ou algo a corrigir. Proteger o CPF e consultar o
 * banco é do servidor.
 */

/**
 * As frases para quem digitou. Linguagem simples, dizendo o que fazer (pedido do
 * dono em 12/09/2026), e SEM repetir o número: vão para a tela e podem ir para
 * o registro de erro do servidor.
 */
export const MENSAGEM_CPF_NAO_CONFERE = 'Este CPF não confere. Confira os números e tente de novo.'
export const MENSAGEM_BUSCA_NAO_RECONHECIDA =
  'Digite o CPF, com 11 números, ou a matrícula, só com números.'

/** Teto do que se aceita digitar. CPF com pontos tem 14; matrícula, no máximo 10 dígitos. */
const MAIOR_TEXTO_DE_BUSCA = 40

export const BuscaPorChaveSchema = z.object({
  texto: z.string().max(MAIOR_TEXTO_DE_BUSCA, MENSAGEM_BUSCA_NAO_RECONHECIDA),
})

export type BuscaInterpretada =
  | { tipo: 'cpf'; cpf: string }
  | { tipo: 'matricula'; matricula: string }
  | { tipo: 'cpf_nao_confere' }
  | { tipo: 'nao_reconhecido' }

export function interpretarBusca(texto: string): BuscaInterpretada {
  const cpf = normalizarCpf(texto)
  if (cpf !== null) return { tipo: 'cpf', cpf }

  const matricula = normalizarMatricula(texto)
  if (matricula !== null) return { tipo: 'matricula', matricula }

  // Onze números que não conferem: a pessoa queria um CPF. Procurar como
  // matrícula devolveria "nada encontrado", e ela concluiria que o item não
  // existe — quando o erro foi um dígito.
  if (/^\d{11}$/.test(texto.replace(/[\s.-]/g, ''))) return { tipo: 'cpf_nao_confere' }

  return { tipo: 'nao_reconhecido' }
}
