import { beforeEach, describe, expect, it, vi } from 'vitest'

import { limparCacheDeAmbiente } from '../../../servidor/ambiente'
import { esvaziarLimitador } from '../../../servidor/limite-de-taxa'
import { obterPrisma } from '../../../servidor/prisma'
import { montarCookie } from '../../../servidor/sessao'
import { limparTudo, semearBase } from '../../../testes/apoio'
import { CONSULTAS_DE_QUALIDADE_POR_MINUTO } from '../../../servicos/qualidade'

/**
 * A rota da qualidade da IA (achado C-21).
 *
 * Qualquer sessão lê, e com `?dias=tudo` a medição carrega todas as revisões
 * resolvidas desde a fundação, desserializando cada uma. Sem limite, chamadas
 * em paralelo de uma sessão qualquer multiplicavam esse custo no servidor único.
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

function pedido(): Request {
  return new Request('http://localhost/api/qualidade?dias=tudo', { method: 'GET' })
}

beforeEach(async () => {
  process.env['SESSAO_SECRET'] = 'segredo-de-teste-com-tamanho-suficiente'
  limparCacheDeAmbiente()
  esvaziarLimitador()
  cookieDaVez.valor = ''
  await limparTudo(banco)
})

describe('consultar a qualidade tem limite por pessoa', () => {
  it(`a consulta ${CONSULTAS_DE_QUALIDADE_POR_MINUTO + 1} no mesmo minuto é recusada`, async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    await entrarComo(base.colaboradores[1]!.id, 'colaborador')
    const { GET } = await import('./route')

    const estados: number[] = []
    for (let vez = 0; vez <= CONSULTAS_DE_QUALIDADE_POR_MINUTO; vez += 1) {
      estados.push((await GET(pedido())).status)
    }

    expect(estados.slice(0, CONSULTAS_DE_QUALIDADE_POR_MINUTO).every((estado) => estado === 200)).toBe(true)
    expect(estados[CONSULTAS_DE_QUALIDADE_POR_MINUTO]).toBe(429)
  })

  it('o limite é de cada pessoa — um colega no teto não trava o painel do outro', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const { GET } = await import('./route')

    await entrarComo(base.colaboradores[1]!.id, 'colaborador')
    for (let vez = 0; vez <= CONSULTAS_DE_QUALIDADE_POR_MINUTO; vez += 1) {
      await GET(pedido())
    }

    await entrarComo(base.colaboradores[2]!.id, 'colaborador')
    expect((await GET(pedido())).status).toBe(200)
  })
})
