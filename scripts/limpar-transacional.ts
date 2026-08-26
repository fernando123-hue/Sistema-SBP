/**
 * Limpa os dados TRANSACIONAIS do banco de desenvolvimento, preservando o
 * cadastro base (colaboradores, categorias, habilitações, escalas).
 *
 * Serve para repetir a demo e a simulação do zero sem recriar o banco inteiro.
 * NUNCA deve ser exposto fora de desenvolvimento — por isso a trava abaixo.
 *
 *   npm run db:limpar
 */

import { ambiente } from '../src/servidor/ambiente'
import { obterPrisma } from '../src/servidor/prisma'

async function principal(): Promise<void> {
  const config = ambiente()

  if (config.NODE_ENV === 'production') {
    throw new Error('Recusado: limpeza de dados transacionais não roda em produção.')
  }

  const banco = obterPrisma()

  // Ordem importa: filhos antes dos pais, para respeitar as chaves estrangeiras.
  const removidos = {
    execucoes: (await banco.execucao.deleteMany()).count,
    atribuicoes: (await banco.atribuicao.deleteMany()).count,
    revisoes: (await banco.revisao.deleteMany()).count,
    rodadas: (await banco.rodadaDistribuicao.deleteMany()).count,
    travas: (await banco.travaDeDistribuicao.deleteMany()).count,
    itens: (await banco.item.deleteMany()).count,
    emails: (await banco.email.deleteMany()).count,
    saldosCarga: (await banco.saldoCarga.deleteMany()).count,
    saldosGlobais: (await banco.saldoCargaGlobal.deleteMany()).count,
    eventos: (await banco.eventoProcessamento.deleteMany()).count,
    auditoria: (await banco.logAuditoria.deleteMany()).count,
  }

  process.stdout.write(`Dados transacionais removidos: ${JSON.stringify(removidos)}\n`)
  process.stdout.write('Cadastro base preservado (colaboradores, categorias, escalas).\n')
}

principal().catch((erro: unknown) => {
  process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`)
  process.exitCode = 1
})
