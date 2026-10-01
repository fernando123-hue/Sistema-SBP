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

/**
 * Os privilégios que, nessas tabelas, quebrariam a promessa.
 *
 * `INDEX` entrou com a pendência 41 (revisão de segurança do #182): quem pode
 * derrubar o índice do #147 reabre o oráculo de tempo da entrada. O SQL de
 * `sqlDeConcessaoMinima` não o concede, e o conferidor agora acusa quem o tem.
 */
const PRIVILEGIOS_PROIBIDOS = ['UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRIGGER', 'INDEX'] as const

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
    // Quem pode repassar privilégio sobre a trilha pode dar `DELETE` a outro
    // usuário, ou a si mesmo por outro login (revisão de segurança do #182).
    const repassa = /\bWITH\s+GRANT\s+OPTION\b/i.test(linha) || concessao.privilegios.includes('GRANT OPTION')
    for (const tabela of TABELAS_DA_TRILHA) {
      if (!alcanca(concessao.alvo, tabela)) continue
      if (repassa) achados.push({ concessao: linha.trim(), privilegio: 'GRANT OPTION', alvo: tabela })

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

export interface AlvoDaConcessao {
  /** A base da operação (`SELECT DATABASE()` com a credencial de manutenção). */
  base: string
  usuario: string
  host: string
  /** `%` no host só com este pedido explícito. */
  aceitaQualquerHost?: boolean
}

/** Nome de base, usuário ou tabela: só o que o MySQL aceita sem escapar. */
const IDENTIFICADOR = /^[A-Za-z0-9_]{1,64}$/
/** Host do usuário: nome, endereço, `%` e `_` coringa. Nada que feche a aspa. */
const HOST = /^[A-Za-z0-9_.%:-]{1,255}$/

/**
 * O SQL da concessão mínima, tabela a tabela (pendência 41).
 *
 * O roteiro antigo da `03-SPEC § 14` dava `SELECT, INSERT, UPDATE, DELETE` na
 * base inteira e tentava tirar `UPDATE, DELETE` das duas tabelas da trilha. O
 * MySQL não desfaz numa tabela o que foi dado na base: o `REVOKE` falha com
 * `ERROR 1147` (reproduzido em 01/10/2026), e o roteiro era impossível de
 * seguir. Aqui cada tabela recebe a sua linha: as da trilha só
 * `SELECT, INSERT`, as outras as quatro de sempre. Nenhuma recebe `INDEX`,
 * `ALTER`, `DROP` ou `TRIGGER`.
 *
 * A lista de tabelas vem da base, não deste arquivo: uma migração nova que
 * cria tabela entra na próxima geração sem ninguém lembrar de editar SQL.
 * `_prisma_migrations` fica de fora: a aplicação não migra.
 *
 * Os nomes viram texto de SQL, então são conferidos antes: um identificador
 * com aspa ou crase recusa, em vez de gerar SQL que faz outra coisa.
 */
export function sqlDeConcessaoMinima(tabelas: readonly string[], alvo: AlvoDaConcessao): string {
  for (const nome of [alvo.base, alvo.usuario, ...tabelas]) {
    if (!IDENTIFICADOR.test(nome)) throw new Error(`Nome fora do formato esperado para SQL: "${nome.slice(0, 64)}".`)
  }
  if (!HOST.test(alvo.host)) throw new Error(`Host fora do formato esperado para SQL: "${alvo.host.slice(0, 64)}".`)
  if (alvo.host.includes('%')) {
    // `%` é "de qualquer origem". Pode ser o certo (banco num contêiner), mas
    // copiado de um exemplo alarga o alcance do usuário sem ninguém decidir
    // (revisão de segurança do #182): só com o pedido explícito.
    if (!alvo.aceitaQualquerHost) {
      throw new Error('Host com "%" vale para conexões de qualquer origem. Se é isso mesmo, peça com --aceito-qualquer-host.')
    }
  }

  const daTrilha = new Set<string>(TABELAS_DA_TRILHA)
  const daAplicacao = tabelas.filter((tabela) => tabela !== '_prisma_migrations')
  const faltando = TABELAS_DA_TRILHA.filter((tabela) => !daAplicacao.includes(tabela))
  if (faltando.length > 0) {
    // Gerar sem elas daria à aplicação um usuário que nem grava a trilha, e o
    // erro só apareceria na primeira ação auditada. Base sem migração não é base.
    throw new Error(`A base não tem ${faltando.join(' nem ')}: rode as migrações antes de gerar as concessões.`)
  }

  const quem = `'${alvo.usuario}'@'${alvo.host}'`
  const linhas = [...daAplicacao].sort().map((tabela) =>
    daTrilha.has(tabela)
      ? `GRANT SELECT, INSERT ON \`${alvo.base}\`.\`${tabela}\` TO ${quem};`
      : `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${alvo.base}\`.\`${tabela}\` TO ${quem};`,
  )
  return linhas.join('\n')
}

/** Uma linha de `information_schema.TRIGGERS`, só o que a conferência usa. */
export interface TriggerNoBanco {
  nome: string
  tabela: string
  /** `INSERT`, `UPDATE` ou `DELETE`. */
  evento: string
  /** `BEFORE` ou `AFTER`. */
  momento: string
  corpo: string
}

/**
 * O que falta para a trava da trilha estar de pé, numa frase por problema.
 *
 * Lista vazia: cada tabela da trilha tem uma trigger `BEFORE UPDATE` que
 * recusa com `SIGNAL`, e toda trigger da base tem o corpo entre `BEGIN` e
 * `END`. Corpo fora dessa forma não volta de um `mysqldump` (`AT-66`).
 *
 * POR QUE uma conferência e não só a migração: a trava some sem nenhum erro na
 * aplicação. Uma migração que parou no meio e foi dada como aplicada à mão, ou
 * uma restauração interrompida, deixam o sistema subindo normal com o passado
 * reescrevível (revisão de segurança do #184).
 *
 * LIMITE: o MySQL só mostra as triggers a quem tem `TRIGGER` na tabela, e o
 * usuário da aplicação não tem, de propósito (`AT-64`). Nenhuma trigger
 * visível é tratado como problema, com a frase dizendo as duas causas
 * possíveis: errar para o lado de acusar é o lado certo.
 */
export function problemasDaTravaDaTrilha(triggers: readonly TriggerNoBanco[]): string[] {
  if (triggers.length === 0) {
    return [
      'Nenhuma trigger visível nesta base. Ou a trilha está sem trava, ou esta credencial não tem TRIGGER ' +
        '(a da aplicação não tem, de propósito). Rode com a conta administradora do MySQL.',
    ]
  }

  const problemas: string[] = []
  for (const tabela of TABELAS_DA_TRILHA) {
    const trava = triggers.some(
      (t) =>
        t.tabela === tabela &&
        t.evento.toUpperCase() === 'UPDATE' &&
        t.momento.toUpperCase() === 'BEFORE' &&
        /\bSIGNAL\s+SQLSTATE\s+'45000'/i.test(t.corpo),
    )
    if (!trava) problemas.push(`${tabela} sem a trigger BEFORE UPDATE que recusa reescrever o passado.`)
  }
  for (const t of triggers) {
    if (!corpoRestauravel(t.corpo)) {
      problemas.push(`A trigger ${t.nome} não tem o corpo entre BEGIN e END, a forma que o backup (mysqldump) restaura.`)
    }
  }
  return problemas
}

function corpoRestauravel(corpo: string): boolean {
  const limpo = corpo.trim().toUpperCase()
  return limpo.startsWith('BEGIN') && limpo.endsWith('END')
}
