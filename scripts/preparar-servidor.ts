/**
 * Prepara uma base da operação recém-migrada: as categorias da configuração e
 * a primeira pessoa gestora, real. O resto da equipe é cadastrado pela tela.
 *
 *   npm run db:preparar -- --nome "Nome Completo" --email pessoa@dominio
 *
 * Nunca rode o seed no servidor: ele cria a equipe fictícia (`AT-60`, `AT-61`).
 * Rode num terminal, não como serviço ou job: a senha provisória sai na tela,
 * e um log persistente (journald, contêiner) a guardaria.
 * Este comando recusa quando a base já tem gestor, então rodar de novo não
 * cria ninguém.
 */

import { encerrarBanco, obterPrisma } from '../src/servidor/prisma'
import { prepararServidor } from '../src/servicos/preparacao-do-servidor'

/** O valor depois de `--nome`. Outra opção no lugar do valor conta como ausente. */
function argumento(nome: string): string | undefined {
  const posicao = process.argv.indexOf(`--${nome}`)
  const valor = posicao === -1 ? undefined : process.argv[posicao + 1]
  return valor === undefined || valor.startsWith('--') ? undefined : valor
}

async function principal(): Promise<void> {
  const nome = argumento('nome')
  const email = argumento('email')
  if (!nome || !email) {
    throw new Error('Uso: npm run db:preparar -- --nome "Nome Completo" --email pessoa@dominio')
  }

  const preparado = await prepararServidor(obterPrisma(), { nome, email })
  process.stdout.write(
    `Categorias conferidas: ${preparado.categorias}.\n` +
      `\nPrimeira gestora criada: ${preparado.email}\n` +
      'Senha provisória — aparece UMA vez, não fica gravada em lugar nenhum.\n' +
      'O sistema exige a troca no primeiro acesso:\n\n' +
      `  ${preparado.senhaProvisoria}\n\n`,
  )
}

principal()
  .catch((erro: unknown) => {
    process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`)
    process.exitCode = 1
  })
  .finally(encerrarBanco)
