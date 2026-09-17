import { describe, expect, it } from 'vitest'

import { conferirBaseDeTeste } from './preparar-banco'

/**
 * Achado N-01 (`docs/auditoria/2026-09-17-achados-da-auditoria-por-agentes.md`):
 * o `globalSetup` roda `prisma migrate reset --force` na base que estiver em
 * `DATABASE_URL`, e a variável do ambiente tem precedência sobre o padrão de
 * teste. Um `DATABASE_URL` da base de desenvolvimento esquecido no shell
 * apagava a base de desenvolvimento inteira ao rodar a suíte.
 */
describe('conferirBaseDeTeste', () => {
  it('aceita a base de teste local e a do CI', () => {
    expect(conferirBaseDeTeste('mysql://root@127.0.0.1:3307/sbp_teste')).toBe('sbp_teste')
    expect(conferirBaseDeTeste('mysql://root@127.0.0.1:3306/sbp_teste')).toBe('sbp_teste')
  })

  it('aceita parâmetros de conexão depois do nome da base', () => {
    expect(conferirBaseDeTeste('mysql://u:s@host:3306/outra_teste?connection_limit=5')).toBe('outra_teste')
  })

  it('recusa a base de desenvolvimento', () => {
    expect(() => conferirBaseDeTeste('mysql://root@127.0.0.1:3307/sbp')).toThrow(/sbp/)
  })

  it('recusa nomes que só contêm "teste" em outro lugar', () => {
    expect(() => conferirBaseDeTeste('mysql://root@127.0.0.1:3307/teste_sbp')).toThrow()
    expect(() => conferirBaseDeTeste('mysql://root@127.0.0.1:3307/sbp_teste_real')).toThrow()
    expect(() => conferirBaseDeTeste('mysql://teste@127.0.0.1:3307/sbp?x=_teste')).toThrow()
  })

  it('recusa URL sem base', () => {
    expect(() => conferirBaseDeTeste('mysql://root@127.0.0.1:3307/')).toThrow()
    expect(() => conferirBaseDeTeste('mysql://root@127.0.0.1:3307')).toThrow()
  })

  it('recusa URL malformada e nome com barra codificada', () => {
    expect(() => conferirBaseDeTeste('mysql://root@127.0.0.1:3307/sbp%zz_teste')).toThrow(/não é uma URL válida/)
    expect(() => conferirBaseDeTeste('mysql://root@127.0.0.1:3307/sbp%2F_teste')).toThrow(/_teste/)
  })

  it('recusa o que não é MySQL', () => {
    expect(() => conferirBaseDeTeste('file:./prisma/dev_teste')).toThrow(/MySQL/)
    expect(() => conferirBaseDeTeste('postgresql://h/sbp_teste')).toThrow(/MySQL/)
  })

  it('não repete a senha da URL na mensagem de erro', () => {
    expect(() => conferirBaseDeTeste('mysql://root:segredo123@127.0.0.1:3307/sbp')).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('segredo123') }),
    )
  })
})
