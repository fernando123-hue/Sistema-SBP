import { expect } from 'vitest'

/**
 * A recusa veio de quem devia — e não só com o texto certo.
 *
 * ═══ POR QUE NÃO BASTA `rejects.toThrow(/texto/)` ═══
 *
 * Achado do #176, que vale para o repositório inteiro: sem a recusa nossa, o
 * BANCO recusa sozinho (índice único, chave estrangeira, tamanho de coluna). A
 * mensagem do Prisma traz o trecho do código vizinho à chamada — que pode
 * incluir o texto do nosso `throw`. Um teste que confere só o texto passa, e
 * apagar a regra de negócio fica verde.
 *
 * Duas travas fecham isso:
 * - a CLASSE pedida (`ErroDeNegocio`, `PermissaoNegadaError`, `ZodError`…):
 *   erro do Prisma nunca é nenhuma delas;
 * - e, para quem pede `Error` puro — que o erro do Prisma também é —, a recusa
 *   de qualquer erro do Prisma ou do driver, pelo nome da classe.
 */
type ClasseDeErro = abstract new (...argumentos: never[]) => Error

const ERRO_DO_BANCO = /^(Prisma|DriverAdapter)/

/**
 * `mensagem`: regex, ou texto que a mensagem CONTÉM (como `toThrow('…')`).
 * Sem ela, só a classe — para a recusa cujo texto não é o que se prova.
 */
export async function recusada<C extends ClasseDeErro>(
  promessa: Promise<unknown>,
  classe: C,
  mensagem?: RegExp | string,
): Promise<InstanceType<C>> {
  const erro: unknown = await promessa.then(
    () => {
      throw new Error(`Esperava recusa com ${classe.name}, mas a operação foi aceita.`)
    },
    (motivo: unknown) => motivo,
  )
  expect((erro as Error)?.constructor?.name).not.toMatch(ERRO_DO_BANCO)
  expect(erro).toBeInstanceOf(classe)
  if (mensagem instanceof RegExp) expect((erro as Error).message).toMatch(mensagem)
  else if (mensagem !== undefined) expect((erro as Error).message).toContain(mensagem)
  return erro as InstanceType<C>
}
