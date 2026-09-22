/**
 * O que o usuário do banco PODE fazer com a trilha.
 *
 * ═══ POR QUE ISTO EXISTE ═══
 *
 * A trilha é append-only em duas camadas (`AT-39`): a varredura de código e a
 * TRIGGER que recusa `UPDATE`. O `DELETE` ficou de fora da trigger de
 * propósito — a suíte limpa as tabelas entre casos e `db:limpar` reinicia a
 * demo —, e a promessa era que, em produção, quem o impede é o privilégio do
 * usuário do banco.
 *
 * Só que promessa de implantação é exatamente o que esta rodada de auditoria
 * existe para eliminar. Se o servidor for provisionado com as credenciais de
 * desenvolvimento (o erro mais comum que existe), a trilha deixa de ser
 * append-only na prática e nada acusa. Aqui ela vira conferência: o texto de
 * `SHOW GRANTS` entra, e sai a lista do que ainda pode reescrever o passado.
 *
 * Função PURA de propósito: quem fala com o banco é o script. Assim o caso
 * difícil — `GRANT ALL PRIVILEGES`, privilégio por tabela, `WITH GRANT OPTION` —
 * é testado sem precisar de um MySQL por perto.
 */

/** As tabelas cujo passado o sistema promete nunca reescrever. */
export const TABELAS_DA_TRILHA = ['LogAuditoria', 'EventoProcessamento'] as const

/** Os privilégios que, nessas tabelas, quebrariam a promessa. */
const PRIVILEGIOS_PROIBIDOS = ['UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRIGGER'] as const

export interface AchadoDePrivilegio {
  /** A linha de `SHOW GRANTS` que concede o privilégio. */
  readonly concessao: string
  /** O privilégio concedido, em maiúsculas. */
  readonly privilegio: string
  /** A tabela alcançada, ou `'*'` quando a concessão vale para a base inteira. */
  readonly alvo: string
}

interface ConcessaoLida {
  readonly privilegios: readonly string[]
  readonly alvo: string
}

/**
 * Lê uma linha de `SHOW GRANTS`.
 *
 * Formato do MySQL:
 *   GRANT SELECT, INSERT ON `sbp`.`LogAuditoria` TO `app`@`%`
 *   GRANT ALL PRIVILEGES ON `sbp`.* TO `app`@`%`
 *   GRANT USAGE ON *.* TO `app`@`%`
 */
function lerConcessao(linha: string): ConcessaoLida | null {
  const partes = /^GRANT\s+(.+?)\s+ON\s+(\S+)\s+TO\s+/i.exec(linha.trim())
  if (!partes) return null

  const [, listaDePrivilegios, escopo] = partes as unknown as [string, string, string]
  const privilegios = listaDePrivilegios
    .split(',')
    // `SELECT (coluna)` existe: o privilégio é o que vem antes do parêntese.
    .map((bruto) => bruto.trim().replace(/\s*\(.*$/, '').toUpperCase())
    .filter((privilegio) => privilegio.length > 0)

  // `sbp`.`LogAuditoria` → LogAuditoria; `sbp`.* → *; *.* → *
  const alvo = (escopo.split('.').pop() ?? '*').replace(/[`"']/g, '')
  return { privilegios, alvo }
}

function alcanca(alvo: string, tabela: string): boolean {
  // A caixa do nome não conta: no Windows o MySQL guarda em minúsculas
  // (`AT-32`), e uma conferência que dependesse disso passaria verde no
  // servidor errado.
  return alvo === '*' || alvo.toLowerCase() === tabela.toLowerCase()
}

/**
 * O que, nestas concessões, ainda consegue reescrever ou apagar a trilha.
 *
 * Lista vazia significa append-only também pelo privilégio — que é o único
 * jeito de a promessa valer contra um cliente de linha de comando aberto
 * direto no servidor, onde nem o código nem a aplicação estão no caminho.
 */
export function privilegiosQueAmeacamATrilha(
  linhasDeGrants: readonly string[],
): AchadoDePrivilegio[] {
  const achados: AchadoDePrivilegio[] = []

  for (const linha of linhasDeGrants) {
    const concessao = lerConcessao(linha)
    if (!concessao) continue

    const temTudo = concessao.privilegios.includes('ALL PRIVILEGES')
    for (const tabela of TABELAS_DA_TRILHA) {
      if (!alcanca(concessao.alvo, tabela)) continue

      for (const privilegio of PRIVILEGIOS_PROIBIDOS) {
        if (!temTudo && !concessao.privilegios.includes(privilegio)) continue
        achados.push({
          concessao: linha.trim(),
          privilegio: temTudo ? 'ALL PRIVILEGES' : privilegio,
          alvo: tabela,
        })
        if (temTudo) break
      }
    }
  }

  return achados
}
