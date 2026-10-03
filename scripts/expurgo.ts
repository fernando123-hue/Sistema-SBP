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
 * Quando a limpeza RECUSA apagar anexos sem registro (banco errado? `AT-74`),
 * a mensagem traz o número. Conferido o banco, uma pessoa autoriza com:
 *
 *   npm run db:expurgar -- --aceitar-orfaos=<o número>
 *
 * Os prazos NÃO vêm de variável de ambiente. Eles são editados pelo gestor, na
 * tela, com a mudança na trilha (`A17`, `A20`); uma variável aqui seria uma
 * segunda porta para mudar quanto tempo dado pessoal fica guardado, sem trilha e
 * sem confirmação.
 */

import { criarArmazenamentoPort } from '../src/adapters/fabrica'
import type { ArmazenamentoPort } from '../src/ports/armazenamento'
import { expurgarAnexosOrfaos } from '../src/servicos/expurgo-anexos-orfaos'
import { prazoEmVigor } from '../src/servicos/retencao'
import { rodarLimpezaDiaria } from '../src/servicos/rotinas'
import { encerrarBanco, obterPrisma } from '../src/servidor/prisma'

const POR_QUE_NAO_RODOU = {
  ja_concluida: 'a limpeza de hoje já foi feita.',
  em_curso: 'outra execução da limpeza de hoje está em andamento.',
  tentativas_esgotadas:
    'a limpeza de hoje falhou em todas as tentativas. Veja a mensagem em ExecucaoDeRotina e o evento em EventoProcessamento.',
} as const

const OPCAO_ACEITAR = '--aceitar-orfaos='

/**
 * `--aceitar-orfaos=N`: o número que a recusa da limpeza mostrou, conferido
 * por uma pessoa (`AT-74`). `null` sem a opção; qualquer valor que não seja
 * inteiro positivo para o comando, em vez de virar "aceitar zero".
 */
function orfaosAceitos(argumentos: readonly string[]): number | null {
  const opcao = argumentos.find((argumento) => argumento.startsWith(OPCAO_ACEITAR))
  if (opcao === undefined) return null
  const valor = opcao.slice(OPCAO_ACEITAR.length)
  if (!/^[1-9][0-9]*$/.test(valor)) {
    throw new Error(`${OPCAO_ACEITAR} precisa de um número inteiro positivo, e veio "${valor}".`)
  }
  return Number(valor)
}

/**
 * Só a varredura de anexo sem registro, fora da rotina do dia: a recusa se
 * repete a cada tentativa, e esta é a saída que uma pessoa autoriza. Cada
 * arquivo apagado vai para a trilha com o número aceito.
 */
async function apagarOrfaosAceitos(armazenamento: ArmazenamentoPort | null, aceitos: number): Promise<void> {
  const banco = obterPrisma()
  const resultado = await expurgarAnexosOrfaos(banco, {
    diasDeRetencao: await prazoEmVigor(banco, 'conteudo_do_email'),
    armazenamento,
    aceitarOrfaos: aceitos,
  })
  process.stdout.write(
    `Anexos sem registro: ${resultado.removidos} apagado(s), de ${resultado.semRegistro} sem registro ` +
      `entre ${resultado.avaliados} arquivo(s).\n`,
  )
}

async function principal(): Promise<void> {
  let armazenamento: ArmazenamentoPort | null = null
  try {
    armazenamento = criarArmazenamentoPort()
  } catch (erro) {
    process.stderr.write(
      `Armazenamento de anexos indisponível (${erro instanceof Error ? erro.message : String(erro)}). ` +
        'E-mails com anexo ficam pendentes, e a varredura de anexo sem registro falha.\n',
    )
  }

  const aceitos = orfaosAceitos(process.argv.slice(2))
  if (aceitos !== null) return await apagarOrfaosAceitos(armazenamento, aceitos)

  const resultado = await rodarLimpezaDiaria(obterPrisma(), { armazenamento })

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
  const conteudo = resultado.resumo.conteudoDosEmails
  const semRegistro = resultado.resumo.anexosSemRegistro
  process.stdout.write(
    `Limpeza diária concluída (ref. ${resultado.correlacaoId.slice(0, 8)}):\n` +
      `  - prazo do motivo de afastamento: ${motivos.prazoEmDias} dias\n` +
      `  - ausências avaliadas: ${motivos.avaliados}\n` +
      `  - motivos vencidos: ${motivos.vencidos} (com algo a apagar: ${motivos.apagados})\n` +
      `  - prazo do texto dos e-mails: ${conteudo.prazoEmDias} dias\n` +
      `  - e-mails avaliados: ${conteudo.avaliados}\n` +
      `  - e-mails vencidos: ${conteudo.vencidos} (apagados: ${conteudo.apagados}, anexos removidos: ${conteudo.anexosRemovidos})\n` +
      `  - arquivos de anexo no armazenamento: ${semRegistro.avaliados} (sem registro: ${semRegistro.semRegistro}, apagados: ${semRegistro.removidos})\n`,
  )
}

principal().catch((erro: unknown) => {
  process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`)
  process.exitCode = 1
}).finally(encerrarBanco)
