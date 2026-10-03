/**
 * Confere se o usuário do banco consegue reescrever ou apagar a trilha.
 *
 *   npm run db:privilegios
 *
 * A trilha (`LogAuditoria`, `EventoProcessamento`) é append-only em duas
 * camadas — a varredura de código e a TRIGGER que recusa `UPDATE` (`AT-39`).
 * O `DELETE` ficou de fora da trigger de propósito: a suíte limpa as tabelas
 * entre casos, e `db:limpar` reinicia a demo. Em produção, quem o impede é o
 * privilégio do usuário do banco — e era só isso, uma promessa escrita num
 * comentário, até este script existir.
 *
 * Em DESENVOLVIMENTO ele apenas relata: a base local roda como root de
 * propósito, e transformar isso em erro treinaria a equipe a ignorar o aviso.
 * Em produção (ou com `EXIGIR_PRIVILEGIO_MINIMO=sim`), ele RECUSA: sai com
 * código 1 e lista cada concessão que ainda alcança a trilha.
 *
 * O SQL de concessão mínima está em `docs/03-SPEC.md`, seção de implantação.
 *
 * Confere também o MODO SQL DA SESSÃO deste usuário (`@@SESSION.sql_mode`), na
 * mesma conexão que a aplicação abre. `db:conferir-trilha` lê o `@@GLOBAL` com a
 * conta administradora, que não vê um `init_connect` (o MySQL isenta quem tem
 * `CONNECTION_ADMIN`) nem `sessionVariables` na `DATABASE_URL` — e é a sessão do
 * app que decide se linha sem domínio é recusada (#199). Revisão de segurança do
 * PR do `sql_mode`.
 */

import { ambiente } from '../src/servidor/ambiente'
import { encerrarBanco, obterPrisma } from '../src/servidor/prisma'
import { modoSqlEstrito, privilegiosQueAmeacamATrilha, TABELAS_DA_TRILHA } from '../src/servidor/privilegios'

function escrever(texto: string): void {
  process.stdout.write(`${texto}\n`)
}

async function principal(): Promise<void> {
  const config = ambiente()
  const banco = obterPrisma()

  // `SHOW GRANTS` devolve uma coluna com nome variável (`Grants for app@%`),
  // então a linha é lida como objeto e o primeiro valor é o texto.
  const linhas = await banco.$queryRawUnsafe<Record<string, string>[]>('SHOW GRANTS FOR CURRENT_USER()')
  const concessoes = linhas.map((linha) => Object.values(linha)[0] ?? '')

  const achados = privilegiosQueAmeacamATrilha(concessoes)
  const exigir = config.NODE_ENV === 'production' || process.env['EXIGIR_PRIVILEGIO_MINIMO'] === 'sim'

  const [linhaDoModo] = await banco.$queryRaw<{ modo: unknown }[]>`SELECT @@SESSION.sql_mode AS modo`
  const modoEstrito = modoSqlEstrito(linhaDoModo?.modo)

  // As duas análises saem SEMPRE, e a decisão é uma só, no fim: recusar no
  // primeiro problema escondia o segundo, e o TI precisaria de duas voltas
  // (revisões do PR do `sql_mode`).
  if (!modoEstrito) {
    escrever(`A sessão deste usuário NÃO está em modo estrito (sql_mode: ${String(linhaDoModo?.modo)}).`)
    escrever('Sem STRICT_TRANS_TABLES, linha sem domínio é gravada com aviso em vez de recusada (#199).')
    escrever('Confira o sql_mode e o init_connect do servidor, e a DATABASE_URL (docs/INSTALACAO.md, seção 1).')
    escrever('')
  }

  if (achados.length === 0) {
    escrever(`OK: nada nas concessões deste usuário alcança ${TABELAS_DA_TRILHA.join(' nem ')}.`)
    if (modoEstrito) return
    recusarOuAvisar(exigir, 'Recusado: em produção a sessão da aplicação precisa estar em modo estrito.')
    return
  }

  escrever('A trilha NÃO está protegida pelo privilégio do usuário do banco:')

  // Agrupado por concessão, e a concessão encurtada: um `GRANT ALL` do root
  // ocupa dez linhas de terminal e afoga justamente o que precisa ser lido.
  const porConcessao = new Map<string, Set<string>>()
  for (const achado of achados) {
    const resumo = porConcessao.get(achado.concessao) ?? new Set<string>()
    resumo.add(`${achado.privilegio} em ${achado.alvo}`)
    porConcessao.set(achado.concessao, resumo)
  }

  for (const [concessao, itens] of porConcessao) {
    for (const item of itens) escrever(`  - ${item}`)
    const curta = concessao.length > 120 ? `${concessao.slice(0, 117)}...` : concessao
    escrever(`    via: ${curta}`)
  }
  escrever('')
  escrever('O SQL de concessão mínima está em docs/03-SPEC.md, seção "Implantação".')

  recusarOuAvisar(
    exigir,
    'Recusado: em produção o usuário da aplicação não pode alterar nem apagar a trilha de auditoria' +
      (modoEstrito ? '.' : ', e a sessão dele precisa estar em modo estrito.'),
  )
}

/** Em produção, derruba o comando; em desenvolvimento, um aviso só. */
function recusarOuAvisar(exigir: boolean, motivo: string): void {
  if (exigir) throw new Error(motivo)
  escrever('(Aviso, não erro: esta base não é de produção. Em produção isto derruba o comando.)')
}

principal().catch((erro: unknown) => {
  process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`)
  process.exitCode = 1
}).finally(encerrarBanco)
