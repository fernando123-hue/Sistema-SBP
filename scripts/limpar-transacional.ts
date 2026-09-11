/**
 * Limpa os dados TRANSACIONAIS do banco de desenvolvimento, preservando o
 * cadastro base (colaboradores, categorias, habilitações, escalas).
 *
 * Serve para repetir a demo e a simulação do zero sem recriar o banco inteiro.
 * NUNCA deve ser exposto fora de desenvolvimento — por isso a trava abaixo.
 *
 *   PERMITIR_LIMPEZA=sim npm run db:limpar
 */

import { ambiente } from '../src/servidor/ambiente'
import { obterPrisma } from '../src/servidor/prisma'

async function principal(): Promise<void> {
  const config = ambiente()

  // ═══ A TRAVA É POR OPT-IN, E NÃO POR DEDUÇÃO ═══
  //
  // A versão anterior recusava só quando `NODE_ENV === 'production'`. Parecia
  // proteção e não era: `NODE_ENV` tem padrão `'development'` no `ambiente.ts`,
  // não está no `.env.example`, e quem define `production` é o `next start`
  // DENTRO do processo da aplicação — não o shell de quem entra por SSH. Então
  // este script, rodado à mão no servidor de produção, via `'development'`,
  // liberava, e apagava `LogAuditoria` junto. Uma trilha que o invariante 14
  // promete nunca reescrever, apagada por uma linha escrita para protegê-la.
  //
  // Agora a ausência de informação recusa, em vez de liberar: sem o opt-in
  // explícito, não roda em lugar nenhum.
  if (config.NODE_ENV === 'production') {
    throw new Error('Recusado: limpeza de dados transacionais não roda em produção.')
  }

  if (process.env.PERMITIR_LIMPEZA !== 'sim') {
    throw new Error(
      'Recusado: esta rotina APAGA itens, atribuições, saldos e a trilha de auditoria.\n' +
        'Se é isto mesmo que você quer, e este banco é de desenvolvimento:\n' +
        '  PERMITIR_LIMPEZA=sim npm run db:limpar',
    )
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
