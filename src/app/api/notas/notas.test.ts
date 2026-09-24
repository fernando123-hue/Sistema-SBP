import { beforeEach, describe, expect, it, vi } from 'vitest'

import { limparCacheDeAmbiente } from '../../../servidor/ambiente'
import { esvaziarLimitador } from '../../../servidor/limite-de-taxa'
import { obterPrisma } from '../../../servidor/prisma'
import { montarCookie } from '../../../servidor/sessao'
import { limparTudo, semearBase } from '../../../testes/apoio'
import { NOTAS_POR_MINUTO } from '../../../servicos/notas'

/**
 * A rota das notas do setor (achado C-16).
 *
 * Qualquer sessão escreve nota, e isso é deliberado (a memória é de quem
 * opera). O que não pode é escrever sem limite: cada nota é uma linha que toda
 * tela de trabalho considera e uma linha em `LogAuditoria`, que nunca é
 * apagada. Um laço de POST de uma sessão qualquer encheria as duas.
 *
 * Mesmo duble de `next/headers` de `itens/busca/busca.test.ts`.
 */

const cookieDaVez = { valor: '' }

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      cookieDaVez.valor ? { name: nome, value: cookieDaVez.valor } : undefined,
    set: () => {},
    delete: () => {},
  }),
}))

const banco = obterPrisma()

async function entrarComo(colaboradorId: string, papel: 'colaborador' | 'operador' | 'gestor') {
  const pessoa = await banco.colaborador.findUniqueOrThrow({
    where: { id: colaboradorId },
    select: { senhaDefinidaEm: true },
  })
  cookieDaVez.valor = montarCookie(colaboradorId, papel, pessoa.senhaDefinidaEm)
}

function pedido(corpo: unknown): Request {
  return new Request('http://localhost/api/notas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  })
}

beforeEach(async () => {
  process.env['SESSAO_SECRET'] = 'segredo-de-teste-com-tamanho-suficiente'
  limparCacheDeAmbiente()
  esvaziarLimitador()
  cookieDaVez.valor = ''
  await limparTudo(banco)
})

describe('escrever nota tem limite por pessoa', () => {
  it(`a nota ${NOTAS_POR_MINUTO + 1} no mesmo minuto é recusada, e não vira linha`, async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    await entrarComo(base.colaboradores[1]!.id, 'colaborador')
    const { POST } = await import('./route')

    const estados: number[] = []
    for (let vez = 0; vez <= NOTAS_POR_MINUTO; vez += 1) {
      estados.push((await POST(pedido({ texto: `Nota sintética ${vez}` }))).status)
    }

    expect(estados.slice(0, NOTAS_POR_MINUTO).every((estado) => estado === 200)).toBe(true)
    expect(estados[NOTAS_POR_MINUTO]).toBe(429)
    // A recusa acontece ANTES de gravar: nem nota nem linha de trilha a mais.
    expect(await banco.nota.count()).toBe(NOTAS_POR_MINUTO)
  })

  it('o limite é de cada pessoa — um colega no teto não trava o outro', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const { POST } = await import('./route')

    await entrarComo(base.colaboradores[1]!.id, 'colaborador')
    for (let vez = 0; vez <= NOTAS_POR_MINUTO; vez += 1) {
      await POST(pedido({ texto: `Nota sintética ${vez}` }))
    }

    await entrarComo(base.colaboradores[2]!.id, 'colaborador')
    expect((await POST(pedido({ texto: 'Nota de outra pessoa' }))).status).toBe(200)
  })
})
