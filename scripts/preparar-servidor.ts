/**
 * Prepara uma base da operação recém-migrada: as categorias da configuração e
 * a primeira pessoa gestora, real. O resto da equipe é cadastrado pela tela.
 *
 *   npm run db:preparar -- --nome "Nome Completo" --email pessoa@dominio
 *
 * Nunca rode o seed no servidor: ele cria a equipe fictícia (`AT-60`, `AT-61`).
 * Este comando recusa quando a base já tem gestor, então rodar de novo não
 * cria ninguém.
 */

import { encerrarBanco, obterPrisma } from '../src/servidor/prisma'
import { criarPrimeiroGestor, garantirCategorias } from '../src/servicos/preparacao-do-servidor'

function argumento(nome: string): string | undefined {
  const posicao = process.argv.indexOf(`--${nome}`)
  return posicao === -1 ? undefined : process.argv[posicao + 1]
}

async function principal(): Promise<void> {
  const nome = argumento('nome')
  const email = argumento('email')
  if (!nome || !email) {
    throw new Error('Uso: npm run db:preparar -- --nome "Nome Completo" --email pessoa@dominio')
  }

  const banco = obterPrisma()
  const categorias = await garantirCategorias(banco)
  process.stdout.write(`Categorias conferidas: ${categorias}.\n`)

  const gestor = await criarPrimeiroGestor(banco, { nome, email })
  process.stdout.write(
    `\nPrimeira gestora criada: ${gestor.email}\n` +
      'Senha provisória — aparece UMA vez, não fica gravada em lugar nenhum.\n' +
      'O sistema exige a troca no primeiro acesso:\n\n' +
      `  ${gestor.senhaProvisoria}\n\n`,
  )
}

principal()
  .catch((erro: unknown) => {
    process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`)
    process.exitCode = 1
  })
  .finally(encerrarBanco)
