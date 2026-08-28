/**
 * Demonstração ponta a ponta.
 *
 * Roda o fluxo inteiro descrito no briefing, de verdade, sem nenhuma tela:
 *
 *   e-mails -> IA classifica e desdobra -> validação -> fila de revisão
 *   -> revisão humana -> itens aprovados -> motor distribui -> histórico
 *   -> fila individual -> execução -> painel -> conferência de conservação
 *
 * Serve como prova de que o núcleo funciona antes de existir uma linha de UI,
 * e como roteiro de aceitação executável.
 *
 *   npm run demo
 */

import { IaMock } from '../src/adapters/ia-mock'
import { IngestaoMock } from '../src/adapters/ingestao-mock'
import { sequenciaDeDatas } from '../src/core/util/datas'
import { atorDaSessao } from '../src/servidor/ator'
import { obterPrisma } from '../src/servidor/prisma'
import { confirmar, previa } from '../src/servicos/distribuicao'
import { concluir, minhaFila } from '../src/servicos/fila'
import { sincronizar } from '../src/servicos/ingestao'
import { conferirConservacao, porCategoria, porPessoa } from '../src/servicos/painel'
import { aprovarTodosPendentes, listarPendentes } from '../src/servicos/revisao'

const DIAS = 5
const DATA_INICIAL = '2026-09-01'

function titulo(texto: string): void {
  process.stdout.write(`\n${'='.repeat(74)}\n${texto}\n${'='.repeat(74)}\n`)
}

function linha(texto: string): void {
  process.stdout.write(`${texto}\n`)
}

async function principal(): Promise<void> {
  const banco = obterPrisma()
  const datas = sequenciaDeDatas(DATA_INICIAL, DIAS)

  const registro = await banco.colaborador.findFirst({ where: { papel: 'operador' } })
  if (!registro) {
    linha('Banco sem operador. Rode `npm run db:seed` antes da demo.')
    process.exitCode = 1
    return
  }

  // Em produção isto vem da sessão autenticada, nunca do corpo da requisição.
  const operador = atorDaSessao({ colaboradorId: registro.id, papel: registro.papel })

  const criarDeps = () => ({
    banco,
    ingestao: new IngestaoMock({ datas, semente: 2026, incluirMalicioso: true }),
    ia: new IaMock(),
  })

  titulo('1. INGESTAO + INTERPRETACAO')
  const resumo = await sincronizar(criarDeps(), operador)
  linha(
    `recebidos ${resumo.recebidos} | novos ${resumo.novos} | duplicados ${resumo.duplicados}\n` +
      `itens criados ${resumo.itensCriados} (aprovados ${resumo.itensAprovados}, ` +
      `revisao ${resumo.itensParaRevisao}) | anexos rejeitados ${resumo.anexosRejeitados}`,
  )
  linha(
    `\nUm e-mail pode gerar N itens (decisao A1): ${resumo.recebidos} e-mails ` +
      `viraram ${resumo.itensCriados} unidades de carga.`,
  )

  titulo('2. IDEMPOTENCIA - a mesma sincronizacao, de novo')
  const repetido = await sincronizar(criarDeps(), operador)
  linha(`recebidos ${repetido.recebidos} | novos ${repetido.novos} | duplicados ${repetido.duplicados}`)
  linha(
    repetido.itensCriados === 0
      ? 'OK - nenhum item duplicado. Reprocessar e seguro.'
      : `FALHA - ${repetido.itensCriados} itens duplicados.`,
  )

  titulo('3. FILA DE REVISAO')
  const { itens: pendentes } = await listarPendentes(banco, 500)
  linha(`${pendentes.length} itens aguardando olho humano`)
  for (const motivo of new Set(pendentes.map((item) => item.motivo))) {
    linha(`   ${motivo}: ${pendentes.filter((item) => item.motivo === motivo).length}`)
  }

  const suspeitos = pendentes.filter((item) => item.motivo === 'conteudo_suspeito')
  if (suspeitos.length > 0) {
    linha(
      `\nTentativa de prompt injection detectada e contida:\n` +
        `   "${suspeitos[0]!.titulo}" - confianca ${suspeitos[0]!.confianca.toFixed(2)}\n` +
        `   O e-mail mandava atribuir tudo a uma pessoa e pular a revisao.\n` +
        `   Foi tratado como DADO: virou item comum e caiu na fila de revisao.`,
    )
  }

  const aprovacao = await aprovarTodosPendentes(banco, operador)
  linha(`\n${aprovacao.aprovados} revisoes rotineiras resolvidas pelo operador.`)

  const { itens: retidos } = await listarPendentes(banco, 500)
  if (retidos.length > 0) {
    const porMotivo = new Map<string, number>()
    for (const item of retidos) porMotivo.set(item.motivo, (porMotivo.get(item.motivo) ?? 0) + 1)
    linha(
      `${retidos.length} continuam retidos de proposito - a aprovacao em massa nao libera` +
        ` o que a defesa segurou:`,
    )
    for (const [motivo, total] of porMotivo) linha(`   ${motivo}: ${total}`)
    linha(
      `\n"desdobramento" = a IA propos dividir um e-mail em N itens. Quantidade de` +
        `\ncarga e decisao humana, entao nao entra sem alguem confirmar.`,
    )
  }

  titulo('4. DISTRIBUICAO')
  let totalDistribuido = 0

  for (const data of datas) {
    const pedido = { data, categorias: [] }

    const antes = await previa(banco, pedido, operador)
    if (antes.planos.length === 0) continue

    const relatorio = await confirmar(banco, pedido, operador)
    totalDistribuido += relatorio.totalDistribuido

    linha(`\n${data}`)
    for (const plano of relatorio.planos) {
      if (!plano.resultado) {
        linha(`   ${plano.categoria.codigo.padEnd(15)} ${plano.quantidade} itens - ${plano.erro}`)
        continue
      }
      const reparticao = plano.resultado.ordemDesempate
        .map((id) => `${id.slice(-4)}=${plano.resultado!.alocacao[id]}`)
        .join('  ')
      linha(
        `   ${plano.categoria.codigo.padEnd(15)} entrada ${String(plano.quantidade).padStart(3)} -> ` +
          `${reparticao.padEnd(34)} [${plano.resultado.criterio}]`,
      )
    }
  }
  linha(`\ntotal distribuido: ${totalDistribuido}`)

  titulo('5. CONSERVACAO - criterio de aceitacao no 1')
  const conservacao = await conferirConservacao(banco)
  linha(`rodadas gravadas: ${conservacao.rodadas}`)
  linha(
    conservacao.divergentes.length === 0
      ? 'OK - soma distribuida == soma de entrada em 100% das rodadas. (Planilha: 71% dos dias.)'
      : `FALHA - ${conservacao.divergentes.length} divergentes: ${JSON.stringify(conservacao.divergentes)}`,
  )

  titulo('6. FILA INDIVIDUAL + EXECUCAO')
  const equipe = await banco.colaborador.findMany({
    where: { papel: 'colaborador' },
    orderBy: { nome: 'asc' },
  })
  const primeiro = equipe[0]

  if (primeiro) {
    const atorDoColaborador = atorDaSessao({ colaboradorId: primeiro.id, papel: primeiro.papel })
    const fila = await minhaFila(banco, primeiro.id, atorDoColaborador)
    linha(`${primeiro.nome}: ${fila.length} itens na fila`)
    for (const item of fila.slice(0, 3)) {
      linha(`   [${item.categoriaCodigo}] ${item.titulo.slice(0, 46)} - de ${item.remetente ?? 'n/d'}`)
    }

    const aConcluir = fila.slice(0, 5)
    for (const item of aConcluir) {
      await concluir(banco, { itemId: item.itemId }, atorDoColaborador)
    }
    linha(`\n${aConcluir.length} itens concluidos - com carimbo, sem digitar quantidade nenhuma.`)
  }

  titulo('7. PAINEL - nenhum numero digitavel')
  // As colunas espelham a planilha, para a comparacao lado a lado.
  linha('categoria         grupo        saldo  entrou  aberto   concl   canc    pend')
  for (const item of await porCategoria(banco)) {
    if (item.aberto === 0) continue
    linha(
      `${item.categoriaCodigo.padEnd(17)} ${item.grupo.padEnd(10)} ` +
        `${String(item.saldoInicial).padStart(6)} ${String(item.entrouNoPeriodo).padStart(7)} ` +
        `${String(item.aberto).padStart(7)} ${String(item.concluidoNoPeriodo).padStart(7)} ` +
        `${String(item.canceladoNoPeriodo).padStart(6)} ${String(item.pendente).padStart(7)}`,
    )
  }

  // "cred.global", nao "credito": o criterio de aceitacao no 4 (|credito| < 1)
  // e por colaborador X CATEGORIA (`SaldoCarga.creditoAcumulado`). O numero
  // desta coluna e o razao GLOBAL, que soma as categorias e serve de desempate
  // secundario (decisao A2) -- passar de 1 aqui e esperado, nao violacao.
  linha('\npessoa                        atribuidos  concluidos  pendentes  cred.global')
  for (const pessoa of await porPessoa(banco)) {
    if (pessoa.atribuidos === 0) continue
    linha(
      `${pessoa.nome.padEnd(29)} ${String(pessoa.atribuidos).padStart(10)} ` +
        `${String(pessoa.concluidos).padStart(11)} ${String(pessoa.pendentes).padStart(10)} ` +
        `${pessoa.creditoGlobal.toFixed(3).padStart(9)}`,
    )
  }

  linha('\nCredito proximo de zero = carga equilibrada. E o livro-razao que a planilha nao tem.\n')
}

principal().catch((erro: unknown) => {
  process.stderr.write(`${erro instanceof Error ? erro.stack : String(erro)}\n`)
  process.exitCode = 1
})
