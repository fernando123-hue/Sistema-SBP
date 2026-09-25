/**
 * Limpa os dados TRANSACIONAIS do banco de desenvolvimento, preservando o
 * cadastro base (colaboradores, categorias, habilitações, escalas).
 *
 * Serve para repetir a demo e a simulação do zero sem recriar o banco inteiro.
 * NUNCA deve ser exposto fora de desenvolvimento — por isso a trava abaixo.
 *
 *   PERMITIR_LIMPEZA=sim npm run db:limpar
 */

import { ArmazenamentoEmDisco } from '../src/adapters/armazenamento-disco'
import { ambiente } from '../src/servidor/ambiente'
import { encerrarBanco, obterPrisma } from '../src/servidor/prisma'
import { limparTransacional } from './limpeza-transacional'

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
  // A ordem da limpeza e a remoção dos bytes moram em
  // `src/servicos/limpeza-transacional.ts`, e não aqui: o teste que prova a
  // ordem precisa chamar ESTA rotina, e não uma cópia escrita ao lado (foi
  // assim que a lista do script e a do teste divergiram — achado da revisão
  // técnica do PR #82).
  const removidos = await limparTransacional(banco, new ArmazenamentoEmDisco())

  process.stdout.write(`Dados transacionais removidos: ${JSON.stringify(removidos)}\n`)
  process.stdout.write('Cadastro base preservado (colaboradores, categorias, escalas).\n')
}

principal().catch((erro: unknown) => {
  process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`)
  process.exitCode = 1
}).finally(encerrarBanco)
