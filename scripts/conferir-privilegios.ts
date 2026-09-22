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
 */

import { ambiente } from '../src/servidor/ambiente'
import { obterPrisma } from '../src/servidor/prisma'
import { privilegiosQueAmeacamATrilha, TABELAS_DA_TRILHA } from '../src/servidor/privilegios'

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

  if (achados.length === 0) {
    escrever(`OK: nada nas concessões deste usuário alcança ${TABELAS_DA_TRILHA.join(' nem ')}.`)
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

  const exigir = config.NODE_ENV === 'production' || process.env['EXIGIR_PRIVILEGIO_MINIMO'] === 'sim'
  if (exigir) {
    throw new Error(
      'Recusado: em produção o usuário da aplicação não pode alterar nem apagar a trilha de auditoria.',
    )
  }
  escrever('(Aviso, não erro: esta base não é de produção. Em produção isto derruba o comando.)')
}

principal().catch((erro: unknown) => {
  process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`)
  process.exitCode = 1
})
