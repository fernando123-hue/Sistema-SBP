/**
 * Redige a observação de afastamentos encerrados há mais de N dias.
 *
 * Roda só quando alguém manda: não há agendador. O prazo é hipótese enquanto a
 * chefia não responder o item 12 do `DECISOES.md § H.4` — ver a documentação
 * de `expurgarObservacoesAfastamento`.
 *
 *   npm run db:expurgar
 *   DIAS_RETENCAO_AFAS=180 npm run db:expurgar
 */

import {
  DIAS_DE_RETENCAO_HIPOTETICOS,
  expurgarObservacoesAfastamento,
} from '../src/servicos/expurgo-lgpd'
import { obterPrisma } from '../src/servidor/prisma'

/**
 * Lê a retenção do ambiente sem deixar passar valor absurdo.
 *
 * `Number('')` é `0` e `Number('abc')` é `NaN` — os dois entrariam calados numa
 * rotina que redige texto para sempre. Aqui a leitura recusa antes de abrir o
 * banco; a mesma checagem existe de novo dentro do serviço, porque quem chama
 * pode não ser este script.
 */
function retencaoDoAmbiente(): number {
  const bruto = process.env.DIAS_RETENCAO_AFAS
  if (bruto === undefined || bruto.trim() === '') return DIAS_DE_RETENCAO_HIPOTETICOS

  const dias = Number(bruto)
  if (!Number.isInteger(dias) || dias < 1) {
    throw new Error(
      `DIAS_RETENCAO_AFAS="${bruto}" não é um número inteiro de dias maior ou igual a 1.`,
    )
  }
  return dias
}

async function principal(): Promise<void> {
  const banco = obterPrisma()
  const diasRetencao = retencaoDoAmbiente()

  process.stdout.write(
    `Expurgo de observação de afastamento — retenção de ${diasRetencao} dias.\n` +
      `ATENÇÃO: o prazo é HIPÓTESE (DECISOES.md § C), não decisão da chefia ` +
      `(§ H.4, item 12). A redação é irreversível.\n`,
  )
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
