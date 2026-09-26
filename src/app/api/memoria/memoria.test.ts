import { beforeEach, describe, expect, it, vi } from 'vitest'

import { limparCacheDeAmbiente } from '../../../servidor/ambiente'
import { esvaziarLimitador } from '../../../servidor/limite-de-taxa'
import { obterPrisma } from '../../../servidor/prisma'
import { montarCookie } from '../../../servidor/sessao'
import { limparTudo, semearBase } from '../../../testes/apoio'
import { CONSULTAS_DA_MEMORIA_POR_MINUTO } from '../../../servicos/memoria'

/**
 * A rota da memória operacional tem limite por pessoa (pendência 9, revisão
 * do #96).
 *
 * Nenhuma tela a chama: é a porta de quem investiga (ou de uma integração), e
 * cada consulta lê `LogAuditoria` e `EventoProcessamento`, que só crescem.
 * Sem limite, uma sessão de operador em laço fazia varredura sustentada da
 * trilha.
 *
 * Mesmo duble de `next/headers` de `qualidade/qualidade.test.ts`.
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
  return new Request('http://localhost/api/memoria?correlacao=inexistente', { method: 'GET' })
}

beforeEach(async () => {
  process.env['SESSAO_SECRET'] = 'segredo-de-teste-com-tamanho-suficiente'
  limparCacheDeAmbiente()
  esvaziarLimitador()
  cookieDaVez.valor = ''
  await limparTudo(banco)
})

describe('consultar a memória tem limite por pessoa', () => {
  it(`a consulta ${CONSULTAS_DA_MEMORIA_POR_MINUTO + 1} no mesmo minuto é recusada`, async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    await entrarComo(base.operadorId, 'operador')
    const { GET } = await import('./route')

    const estados: number[] = []
    for (let vez = 0; vez <= CONSULTAS_DA_MEMORIA_POR_MINUTO; vez += 1) {
      estados.push((await GET(pedido())).status)
    }

    expect(estados.slice(0, CONSULTAS_DA_MEMORIA_POR_MINUTO).every((estado) => estado === 200)).toBe(true)
    expect(estados[CONSULTAS_DA_MEMORIA_POR_MINUTO]).toBe(429)
  })

  it('o limite é de cada pessoa — um colega no teto não trava o do outro', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const { GET } = await import('./route')

    await entrarComo(base.operadorId, 'operador')
    for (let vez = 0; vez <= CONSULTAS_DA_MEMORIA_POR_MINUTO; vez += 1) {
      await GET(pedido())
    }

    await entrarComo(base.colaboradores[2]!.id, 'colaborador')
    expect((await GET(pedido())).status).not.toBe(429)
  })
})
