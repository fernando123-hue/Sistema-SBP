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
 * uma pessoa confere o banco, vê QUAIS arquivos são e só então autoriza:
 *
 *   npm run db:expurgar -- --listar-orfaos
 *   npm run db:expurgar -- --aceitar-orfaos=<o número> --por=<seu nome>
 *
 * O aceite recusa enquanto uma limpeza diária estiver rodando. O contrário —
 * uma tentativa automática começar no meio do aceite — não é barrado, e não há
 * hora fixa: o servidor tenta ao subir e a cada 15 minutos até a limpeza do dia
 * dar certo ou esgotar as tentativas. Como o aceite só é preciso quando a
 * limpeza recusa (e aí ela segue tentando), rode-o com o servidor PARADO e sem
 * `db:expurgar` agendado, ou depois que as tentativas do dia se esgotarem — e
 * longe da meia-noite, quando as tentativas recomeçam. Junto, o pior que acontece é a
 * trilha ganhar linha dobrada; nada além do aceito é apagado (revisões do #226).
 *
 * Os prazos NÃO vêm de variável de ambiente. Eles são editados pelo gestor, na
 * tela, com a mudança na trilha (`A17`, `A20`); uma variável aqui seria uma
 * segunda porta para mudar quanto tempo dado pessoal fica guardado, sem trilha e
 * sem confirmação.
 */

import { criarArmazenamentoPort } from '../src/adapters/fabrica'
import type { ArmazenamentoPort } from '../src/ports/armazenamento'
import {
  LimpezaDeOrfaosRecusadaError,
  expurgarAnexosOrfaos,
  levantarAnexosOrfaos,
} from '../src/servicos/expurgo-anexos-orfaos'
import { prazoEmVigor } from '../src/servicos/retencao'
import { limpezaEmCurso, rodarLimpezaDiaria } from '../src/servicos/rotinas'
import { encerrarBanco, obterPrisma } from '../src/servidor/prisma'
import { lerOpcoesDeOrfaos } from './opcoes-de-orfaos'

const POR_QUE_NAO_RODOU = {
  ja_concluida: 'a limpeza de hoje já foi feita.',
  em_curso: 'outra execução da limpeza de hoje está em andamento.',
  tentativas_esgotadas:
    'a limpeza de hoje falhou em todas as tentativas. Veja a mensagem em ExecucaoDeRotina e o evento em EventoProcessamento.',
} as const

/**
 * Mostra o que a limpeza de anexo sem registro apagaria, e se ela se recusaria,
 * sem apagar nada. É o que se olha ANTES de aceitar: chave e data de cada um.
 */
async function listarOrfaos(armazenamento: ArmazenamentoPort | null): Promise<void> {
  const banco = obterPrisma()
  const levantamento = await levantarAnexosOrfaos(banco, {
    diasDeRetencao: await prazoEmVigor(banco, 'conteudo_do_email'),
    armazenamento,
  })
  const linhas = levantamento.vencidos.map(
    (arquivo) => `  - ${arquivo.chave}  gravado em ${arquivo.gravadoEm.toISOString()}`,
  )
  process.stdout.write(
    `${levantamento.avaliados} arquivo(s) no armazenamento; ${levantamento.semRegistro} sem registro; ` +
      `${levantamento.vencidos.length} vencido(s), que a limpeza apagaria:\n` +
      (linhas.length > 0 ? `${linhas.join('\n')}\n` : '') +
      (levantamento.recusa === null
        ? 'A limpeza diária apaga estes sozinha.\n'
        : `A limpeza diária RECUSA: ${levantamento.recusa}\n`),
  )
}

/**
 * Só a varredura de anexo sem registro, fora da rotina do dia: a recusa se
 * repete a cada tentativa, e esta é a saída que uma pessoa autoriza. Cada
 * arquivo apagado vai para a trilha com o número aceito e o nome declarado.
 */
async function apagarOrfaosAceitos(
  armazenamento: ArmazenamentoPort | null,
  aceite: { quantidade: number; por: string },
): Promise<void> {
  const banco = obterPrisma()
  // Rodando junto com a limpeza do dia, os dois listariam os mesmos arquivos e
  // a trilha ganharia linha dobrada (revisão técnica do #211, rodada 2, N2).
  if (await limpezaEmCurso(banco)) {
    throw new LimpezaDeOrfaosRecusadaError(
      'Há uma limpeza diária em curso (ou que parou há menos de 30 minutos). Nada foi apagado; ' +
        'espere e liste de novo.',
    )
  }
  const resultado = await expurgarAnexosOrfaos(banco, {
    diasDeRetencao: await prazoEmVigor(banco, 'conteudo_do_email'),
    armazenamento,
    aceite,
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

  const opcoes = lerOpcoesDeOrfaos(process.argv.slice(2))
  if (opcoes.modo === 'listar') return await listarOrfaos(armazenamento)
  if (opcoes.modo === 'aceitar') return await apagarOrfaosAceitos(armazenamento, opcoes)

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
