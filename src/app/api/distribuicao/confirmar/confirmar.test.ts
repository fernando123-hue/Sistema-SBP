import { beforeEach, describe, expect, it, vi } from 'vitest'

import { limparCacheDeAmbiente } from '../../../../servidor/ambiente'
import { esvaziarLimitador } from '../../../../servidor/limite-de-taxa'
import { obterPrisma } from '../../../../servidor/prisma'
import { montarCookie } from '../../../../servidor/sessao'
import { limparTudo, semearBase } from '../../../../testes/apoio'
import { CONFIRMACOES_POR_MINUTO } from '../../../../servicos/distribuicao'

/**
 * A rota que confirma a distribuição (achado C-26).
 *
 * O limite era por pessoa E por data: a data vem do corpo, e cada data nova
 * abria um balde novo de dez chamadas. Um script iterando datas passava sem
 * limite nenhum, e cada chamada grava evento e trava — memória sem expurgo.
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

function pedido(data: string): Request {
  return new Request('http://localhost/api/distribuicao/confirmar', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data }),
  })
}

beforeEach(async () => {
  process.env['SESSAO_SECRET'] = 'segredo-de-teste-com-tamanho-suficiente'
  limparCacheDeAmbiente()
  esvaziarLimitador()
  cookieDaVez.valor = ''
  await limparTudo(banco)
})

describe('confirmar tem limite por pessoa, qualquer que seja a data', () => {
  it(`a confirmação ${CONFIRMACOES_POR_MINUTO + 1} no minuto é recusada mesmo trocando a data a cada vez`, async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    await entrarComo(base.operadorId, 'operador')
    const { POST } = await import('./route')

    const estados: number[] = []
    for (let vez = 0; vez <= CONFIRMACOES_POR_MINUTO; vez += 1) {
      // Uma data diferente por chamada — era o que abria balde novo.
      const data = new Date(Date.UTC(2020, 0, 1 + vez)).toISOString().slice(0, 10)
      estados.push((await POST(pedido(data))).status)
    }

    expect(estados.slice(0, CONFIRMACOES_POR_MINUTO)).not.toContain(429)
    expect(estados[CONFIRMACOES_POR_MINUTO]).toBe(429)
  })
})
