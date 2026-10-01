/**
 * Confere se a trava da trilha está de pé no banco.
 *
 *   npm run db:conferir-trilha
 *
 * Rode com a conta ADMINISTRADORA do MySQL, depois de migrar e depois de
 * restaurar um backup. O MySQL só mostra as triggers a quem tem `TRIGGER` na
 * tabela, e o usuário da aplicação não tem, de propósito (`AT-64`): com ele,
 * este comando sempre recusa.
 *
 * Existe porque a trava some sem nenhum erro na aplicação: uma migração que
 * parou no meio e foi dada como aplicada à mão, ou uma restauração
 * interrompida, deixam o sistema subindo normal com o passado reescrevível
 * (`AT-66`, revisões do #184). Sai com código 1 se faltar alguma coisa.
 */

import { encerrarBanco, obterPrisma } from '../src/servidor/prisma'
import { problemasDaTravaDaTrilha, type TriggerNoBanco } from '../src/servidor/privilegios'

async function principal(): Promise<void> {
  const triggers = await obterPrisma().$queryRaw<TriggerNoBanco[]>`
    SELECT TRIGGER_NAME AS nome, EVENT_OBJECT_TABLE AS tabela, EVENT_MANIPULATION AS evento,
           ACTION_TIMING AS momento, ACTION_STATEMENT AS corpo
    FROM information_schema.TRIGGERS
    WHERE TRIGGER_SCHEMA = DATABASE()`

  const problemas = problemasDaTravaDaTrilha(triggers)
  if (problemas.length === 0) {
    process.stdout.write('OK: LogAuditoria e EventoProcessamento recusam UPDATE, e as triggers voltam de um backup.\n')
    return
  }
  process.stdout.write('A trava da trilha NÃO está de pé:\n')
  for (const problema of problemas) process.stdout.write(`  - ${problema}\n`)
  if (triggers.length > 0) {
    process.stdout.write('Para recriá-la: npx prisma migrate deploy, com a conta administradora do MySQL.\n')
  }
  process.exitCode = 1
}

principal()
  .catch((erro: unknown) => {
    process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`)
    process.exitCode = 1
  })
  .finally(encerrarBanco)
