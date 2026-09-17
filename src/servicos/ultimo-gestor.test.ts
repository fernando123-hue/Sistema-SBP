import { beforeEach, describe, expect, it } from 'vitest'

import { ErroDeNegocio } from '../core/erros'
import { obterPrisma } from '../servidor/prisma'
import { atorDeTeste, limparTudo } from '../testes/apoio'
import { bancoQueAnota } from '../testes/banco-que-anota'
import { definirAtivacao } from './autenticacao'

/**
 * A trava "nunca desativar o último gestor".
 *
 * Revisão do PR #35: a contagem dos outros gestores acontecia FORA da
 * transação que desativa. Dois gestores desativando um ao outro ao mesmo tempo
 * contavam, cada um, o outro ainda ativo — e passavam os dois, deixando a
 * associação sem ninguém que cadastra senha ou reativa acesso.
 *
 * Desde o MySQL (achado N-07), contar dentro da transação não bastava: a
 * leitura comum usava a fotografia do começo dela. A contagem virou leitura
 * TRAVADA das linhas de gestor. A prova de concorrência real está em
 * `autenticacao.test.ts` ("N-07: dois gestores desativando um ao outro");
 * aqui fica a de ORDEM: a leitura travada vem antes da escrita.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

async function doisGestores() {
  const a = await banco.colaborador.create({
    data: { nome: 'Gestora A', email: 'gestora.a@teste.local', papel: 'gestor' },
  })
  const b = await banco.colaborador.create({
    data: { nome: 'Gestor B', email: 'gestor.b@teste.local', papel: 'gestor' },
  })
  return { a, b }
}

describe('último gestor ativo', () => {
  it('os gestores são lidos com trava, DENTRO da transação e antes de desativar', async () => {
    const { a, b } = await doisGestores()
    const ordem: string[] = []

    await definirAtivacao(
      bancoQueAnota(banco, ordem),
      { colaboradorId: a.id, ativo: false },
      atorDeTeste(b.id, 'gestor'),
    )

    // `bancoQueAnota` só enxerga o que passa pelo `tx`: se a contagem voltar
    // para fora da transação, ela some desta lista.
    expect(ordem).toContain('tx.$queryRaw')
    expect(ordem.lastIndexOf('tx.$queryRaw')).toBeLessThan(ordem.indexOf('colaborador.update'))
    expect((await banco.colaborador.findUnique({ where: { id: a.id } }))?.ativo).toBe(false)
  })

  it('o último gestor ativo não se desativa — e continua ativo', async () => {
    const { a, b } = await doisGestores()
    await banco.colaborador.update({ where: { id: b.id }, data: { ativo: false } })

    await expect(
      definirAtivacao(banco, { colaboradorId: a.id, ativo: false }, atorDeTeste(a.id, 'gestor')),
    ).rejects.toBeInstanceOf(ErroDeNegocio)

    expect((await banco.colaborador.findUnique({ where: { id: a.id } }))?.ativo).toBe(true)
  })
})
