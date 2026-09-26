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
 * Nenhuma tela a chama: é a porta de quem investiga um caso (ou de uma
 * integração). Cada consulta é indexada e cortada, então o risco não é o custo
 * de um pedido — é o laço: um operador varrendo ids de item ou de correlação
 * reconstruiria a trilha da operação inteira, a "listagem geral" que a rota
 * diz não existir de propósito.
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
    let ultimo = 0
    for (let vez = 0; vez <= CONSULTAS_DA_MEMORIA_POR_MINUTO; vez += 1) {
      ultimo = (await GET(pedido())).status
    }
    // A primeira pessoa chegou mesmo ao teto — senão o resto não prova nada.
    expect(ultimo).toBe(429)

    // Outra pessoa do MESMO papel: uma chave "por papel" passaria se a segunda
    // fosse colaboradora (que recebe 403 de qualquer jeito). Status exato:
    // `not.toBe(429)` aceitaria 401 ou 500 (revisão do #131).
    const outraOperadora = await banco.colaborador.create({
      data: { nome: 'Outra Operadora de Teste', email: 'operador2@teste.local', papel: 'operador' },
    })
    await entrarComo(outraOperadora.id, 'operador')
    expect((await GET(pedido())).status).toBe(200)
  })
})
