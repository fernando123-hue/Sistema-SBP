/**
 * Confere se a trava da trilha está como a migração a deixa.
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
 * (`AT-66`, revisões do #184). Sai com código 1 se algo não estiver certo.
 */

import { encerrarBanco, obterPrisma } from '../src/servidor/prisma'
import { conferirTravaDaTrilha, type TriggerNoBanco } from '../src/servidor/privilegios'

function escrever(texto: string): void {
  process.stdout.write(`${texto}\n`)
}

async function principal(): Promise<void> {
  const triggers = await obterPrisma().$queryRaw<TriggerNoBanco[]>`
    SELECT TRIGGER_NAME AS nome, EVENT_OBJECT_TABLE AS tabela, EVENT_MANIPULATION AS evento,
           ACTION_TIMING AS momento, ACTION_STATEMENT AS corpo
    FROM information_schema.TRIGGERS
    WHERE TRIGGER_SCHEMA = DATABASE()`
  const [{ caixa }] = await obterPrisma().$queryRaw<[{ caixa: number | bigint }]>`
    SELECT @@lower_case_table_names AS caixa`

  const { semTrava, foraDaForma, nenhumaVisivel } = conferirTravaDaTrilha(triggers, Number(caixa))

  if (nenhumaVisivel) {
    escrever('Nenhuma trigger visível nesta base. Ou a trilha está sem trava, ou esta credencial não tem TRIGGER')
    escrever('(a da aplicação não tem, de propósito). Rode com a conta administradora do MySQL.')
    escrever('Se já é ela, a trilha está sem trava: veja as duas saídas abaixo.')
  } else if (semTrava.length === 0 && foraDaForma.length === 0) {
    escrever('OK: as triggers de LogAuditoria e EventoProcessamento estão presentes, com o corpo exato da migração (AT-66).')
    return
  }

  for (const tabela of nenhumaVisivel ? [] : semTrava) {
    escrever(`- ${tabela}: sem a trigger BEFORE UPDATE com o corpo exato da migração (AT-66).`)
  }
  for (const frase of foraDaForma) escrever(`- ${frase}`)

  if (semTrava.length > 0) {
    escrever('')
    escrever('Se a migração ainda não rodou: npx prisma migrate deploy, com a conta administradora.')
    escrever('Se esta base veio de uma restauração, ela pode estar incompleta: restaure de novo, de um backup')
    escrever('bom, e confira outra vez antes de apontar o sistema para ela.')
  }
  process.exitCode = 1
}

principal()
  .catch((erro: unknown) => {
    process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`)
    process.exitCode = 1
  })
  .finally(encerrarBanco)
