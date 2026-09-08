/**
 * Executa a rotina de expurgo LGPD para anonimizar observações de afastamentos
 * de saúde/atestados encerrados há mais de N dias (padrão: 90 dias).
 *
 *   npm run db:expurgar
 */

import { expurgarObservacoesAfastamento } from '../src/servicos/expurgo-lgpd'
import { obterPrisma } from '../src/servidor/prisma'

async function principal(): Promise<void> {
  const banco = obterPrisma()
  const diasRetencao = Number(process.env.DIAS_RETENCAO_AFAS || '90')

  process.stdout.write(`Executando expurgo LGPD de afastamentos (retenção: ${diasRetencao} dias)...\n`)
  const resultado = await expurgarObservacoesAfastamento(banco, diasRetencao)

  process.stdout.write(
    `Expurgo concluído:\n` +
      `  - Data de corte: ${resultado.dataCorte}\n` +
      `  - Registros expurgados: ${resultado.expurgados}\n`,
  )
}

principal().catch((erro: unknown) => {
  process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`)
  process.exitCode = 1
})
