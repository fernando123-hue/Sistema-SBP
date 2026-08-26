import { PapelSchema, type Papel } from '../core/esquemas'

/**
 * Quem está agindo.
 *
 * PROBLEMA QUE ISTO RESOLVE: antes, todo serviço recebia `usuario`,
 * `executadoPor` ou `colaboradorId` como `string` solta. Quando a API HTTP
 * existir, nada impediria a rota de repassar `req.body.colaboradorId` direto —
 * e como `auditar()` grava exatamente esse valor, a trilha de auditoria
 * inteira seria forjável: qualquer chamador poderia concluir o trabalho de um
 * colega, ou transferir um item para si, e o log registraria a identidade que o
 * atacante escolheu, indistinguível de uma ação legítima.
 *
 * `Ator` é um tipo marcado: não dá para construir um a partir de uma string
 * qualquer. As únicas fábricas estão neste arquivo, e cada uma diz de onde a
 * identidade veio. Uma rota que tentasse fabricar um ator a partir do corpo da
 * requisição teria de chamar `atorDaSessao` explicitamente — o que é visível
 * em revisão e rastreável por busca, em vez de silencioso.
 *
 * Isto NÃO substitui autenticação (ver DECISOES.md § AT-08). É a fundação de
 * tipos para que, quando a sessão existir, seja impossível ligar o corpo da
 * requisição ao campo de auditoria por acidente.
 */

declare const marcaDeAtor: unique symbol

export interface Ator {
  readonly colaboradorId: string
  readonly papel: Papel
  readonly [marcaDeAtor]: true
}

function construir(colaboradorId: string, papel: Papel): Ator {
  if (colaboradorId.trim().length === 0) {
    throw new Error('Ator sem identificador de colaborador.')
  }
  // A marca é fantasma: existe só no sistema de tipos (`declare const`), nunca
  // em runtime. O objeto real carrega apenas os dois campos úteis.
  return { colaboradorId, papel } as unknown as Ator
}

/**
 * Ator vindo de uma sessão autenticada.
 *
 * O chamador é responsável por já ter validado o token. Os valores DEVEM vir da
 * sessão do servidor, nunca do corpo ou da query da requisição.
 */
export function atorDaSessao(sessao: { colaboradorId: string; papel: string }): Ator {
  return construir(sessao.colaboradorId, PapelSchema.parse(sessao.papel))
}

/**
 * Ator para tarefas automáticas (cron de ingestão, reprocessamento).
 * Não representa pessoa nenhuma e não pode concluir nem transferir item.
 */
export const ATOR_SISTEMA: Ator = construir('sistema', 'operador')

export class PermissaoNegadaError extends Error {
  readonly codigo = 'PERMISSAO_NEGADA'

  constructor(ator: Ator, operacao: string, permitidos: readonly Papel[]) {
    super(
      `Papel "${ator.papel}" não pode executar "${operacao}". ` +
        `Permitidos: ${permitidos.join(', ')}.`,
    )
    this.name = 'PermissaoNegadaError'
  }
}

export function exigirPapel(ator: Ator, operacao: string, ...permitidos: Papel[]): void {
  if (!permitidos.includes(ator.papel)) {
    throw new PermissaoNegadaError(ator, operacao, permitidos)
  }
}

/** `true` quando o ator é a própria pessoa dona do registro. */
export function ehOProprio(ator: Ator, colaboradorId: string): boolean {
  return ator.colaboradorId === colaboradorId
}
