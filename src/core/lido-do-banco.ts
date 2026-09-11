import type { z } from 'zod'

/**
 * Valor de domínio fechado lido de uma coluna `String` do banco.
 *
 * O banco guarda texto (para o schema portar de SQLite para PostgreSQL sem mudar
 * model nenhum), e a leitura fazia `linha.tipo as TipoDeAfastamento`. A asserção
 * não confere nada: um valor fora da lista entrava no domínio com o tipo certo e
 * o conteúdo errado. Achado 23 da auditoria de 08/09/2026.
 *
 * Por que não `Esquema.parse` direto: um `ZodError` que escapa de um serviço vira
 * `400` em `rota()` — "o seu pedido está errado" — quando o defeito é do BANCO, e
 * a mensagem ainda sairia inteira para a tela. Aqui a falha é `Error` comum: cai
 * no ramo dos 500, com correlação e registro, que é onde defeito de dado mora.
 */
export function lerDoBanco<T>(esquema: z.ZodType<T>, valor: unknown, onde: string): T {
  const resultado = esquema.safeParse(valor)
  if (resultado.success) return resultado.data
  throw new Error(
    `Valor inválido no banco em ${onde}: ${JSON.stringify(valor)}. ` +
      `Nenhuma leitura deve tratá-lo como válido — corrija a linha, não o leitor.`,
  )
}
