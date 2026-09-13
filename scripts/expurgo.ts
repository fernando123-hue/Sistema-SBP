/**
 * Roda AGORA a limpeza diária — a mesma que o servidor roda sozinho
 * (`src/instrumentation.ts`).
 *
 * Serve para instalação em que o servidor não fica ligado o dia inteiro, e para
 * conferir. Continua sendo uma execução por dia: se o servidor já rodou hoje,
 * este comando diz isso e não apaga nada de novo.
 *
 *   npm run db:expurgar
 *
 * O prazo NÃO vem mais de variável de ambiente. Ele é editado pelo gestor, na
 * tela, com a mudança na trilha (`A17`); uma variável aqui seria uma segunda
 * porta para mudar quanto tempo dado de saúde fica guardado, sem trilha e sem
 * confirmação.
 */

import { rodarLimpezaDiaria } from '../src/servicos/rotinas'
import { obterPrisma } from '../src/servidor/prisma'

const POR_QUE_NAO_RODOU = {
  ja_concluida: 'a limpeza de hoje já foi feita.',
  em_curso: 'outra execução da limpeza de hoje está em andamento.',
  tentativas_esgotadas:
    'a limpeza de hoje falhou em todas as tentativas. Veja a mensagem em ExecucaoDeRotina e o evento em EventoProcessamento.',
} as const

async function principal(): Promise<void> {
  const resultado = await rodarLimpezaDiaria(obterPrisma())

  if (!resultado.executou) {
    process.stdout.write(`Nada feito: ${POR_QUE_NAO_RODOU[resultado.motivo]}\n`)
    if (resultado.motivo === 'tentativas_esgotadas') process.exitCode = 1
    return
  }

  if (resultado.situacao === 'falha') {
    process.stderr.write(
      `A limpeza diária FALHOU (ref. ${resultado.correlacaoId.slice(0, 8)}): ${resultado.mensagem}\n`,
    )
    process.exitCode = 1
    return
  }

  const motivos = resultado.resumo.motivosDeAfastamento
  process.stdout.write(
    `Limpeza diária concluída (ref. ${resultado.correlacaoId.slice(0, 8)}):\n` +
      `  - prazo do motivo de afastamento: ${motivos.prazoEmDias} dias\n` +
      `  - ausências avaliadas: ${motivos.avaliados}\n` +
      `  - motivos vencidos: ${motivos.vencidos} (com algo a apagar: ${motivos.apagados})\n`,
  )
}

principal().catch((erro: unknown) => {
  process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`)
  process.exitCode = 1
})
