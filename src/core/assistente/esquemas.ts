import { z } from 'zod'

import { TELAS } from './conhecimento'

/**
 * Contratos do assistente.
 *
 * O que entra é uma pergunta e nada mais. O que sai é texto e, no máximo, o
 * nome de uma tela existente. **Não há campo de ação em lugar nenhum** — e
 * isso não é omissão a corrigir depois: é o desenho.
 *
 * Um assistente que pudesse devolver `{acao: 'distribuir', data: '...'}` seria
 * um caminho para operar o sistema por texto livre, sujeito a quem escrever a
 * pergunta mais persuasiva. Toda operação deste sistema continua acontecendo
 * pela rota da operação, com o papel conferido e a trilha gravada. O assistente
 * explica onde fica o botão; quem aperta é gente.
 */

/**
 * Teto da pergunta.
 *
 * Baixo de propósito. Pergunta de operação cabe em duas linhas; o que passa
 * disso costuma ser corpo de e-mail colado — que é justamente o conteúdo que
 * não deve virar prompt (invariante 6). O truncamento das três camadas ainda
 * roda depois, mas recusar cedo dá mensagem melhor a quem digitou.
 */
export const TAMANHO_MAXIMO_DA_PERGUNTA = 500

/** Teto da resposta. Resposta longa em painel de ajuda ninguém lê. */
export const TAMANHO_MAXIMO_DA_RESPOSTA = 1200

export const PerguntaDoAssistenteSchema = z.object({
  pergunta: z.string().trim().min(3).max(TAMANHO_MAXIMO_DA_PERGUNTA),
})

export type PerguntaDoAssistente = z.infer<typeof PerguntaDoAssistenteSchema>

/**
 * O que o modelo devolve.
 *
 * `telaSugerida` é uma união fechada das telas que existem, e não texto livre:
 * assim o modelo não inventa um caminho, e um link quebrado deixa de ser
 * possível por construção. O papel de quem perguntou é conferido DEPOIS, no
 * servidor — o enum garante que a tela existe, não que aquela pessoa a alcança.
 *
 * `verbetesUsados` existe para poder desconfiar da resposta: o servidor confere
 * se os ids citados estavam mesmo no material enviado. Citação de verbete que
 * não existe é sinal de resposta inventada, e o sistema registra isso.
 */
export const RespostaDoModeloAssistenteSchema = z.object({
  resposta: z.string().min(1).max(TAMANHO_MAXIMO_DA_RESPOSTA),
  /**
   * `false` quando o manual não cobre a pergunta.
   *
   * Existe para o assistente poder dizer "não sei" de um jeito que a tela
   * reconheça e trate — em vez de inventar uma resposta plausível, que é o
   * modo de falhar mais caro de um assistente: quem pergunta não tem como
   * distinguir a invenção da informação.
   */
  respondida: z.boolean(),
  verbetesUsados: z.array(z.string().max(60)).max(8),
  telaSugerida: z.enum(TELAS).nullable(),
})

export type RespostaDoModeloAssistente = z.infer<typeof RespostaDoModeloAssistenteSchema>

/** O que a rota devolve à tela, depois das conferências do servidor. */
export interface RespostaDoAssistente {
  resposta: string
  respondida: boolean
  telaSugerida: string | null
  /** Nome do adapter que atendeu. A tela mostra para ninguém confundir mock com modelo real. */
  origem: string
}
