import { beforeEach, describe, expect, it, vi } from 'vitest'

import { limparCacheDeAmbiente } from '../../../../servidor/ambiente'
import { protegerCpf } from '../../../../servidor/cpf-protegido'
import { obterPrisma } from '../../../../servidor/prisma'
import { montarCookie } from '../../../../servidor/sessao'
import { limparTudo, semearBase } from '../../../../testes/apoio'

/**
 * A rota da busca por CPF ou matrícula (`A40`, resposta 24).
 *
 * O CPF digitado viaja no CORPO de um POST, nunca no endereço: endereço vira
 * histórico do navegador e linha de registro do servidor. Sessão e limite por
 * pessoa ficam na rota; a regra do que se procura, no serviço.
 *
 * Mesmo duble de `next/headers` de `autorizacao-de-rotas.test.ts`: a sessão é
 * montada pelo MESMO `montarCookie` da rota de entrada.
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
const CPF = '111.444.777-35'

async function entrarComo(colaboradorId: string, papel: 'colaborador' | 'operador' | 'gestor') {
  const pessoa = await banco.colaborador.findUniqueOrThrow({
    where: { id: colaboradorId },
    select: { senhaDefinidaEm: true },
  })
  cookieDaVez.valor = montarCookie(colaboradorId, papel, pessoa.senhaDefinidaEm)
}

function pedido(corpo: unknown): Request {
  return new Request('http://localhost/api/itens/busca', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  })
}

beforeEach(async () => {
  process.env['SESSAO_SECRET'] = 'segredo-de-teste-com-tamanho-suficiente'
  limparCacheDeAmbiente()
  cookieDaVez.valor = ''
  await limparTudo(banco)
})

/**
 * Cria um item com o CPF de busca, opcionalmente na mesa de alguém.
 *
 * O responsável passou a importar na fase 2: a busca usa a mesma leitura da
 * Caixa, então ela herda o recorte de `A24` — e `A40`, resposta 24, já dizia
 * que seria assim ("a busca dele passa a achar só esses").
 */
async function itemComCpf(dono?: { id: string; atribuidoPor: string }) {
  const categoria = await banco.categoria.findUniqueOrThrow({ where: { codigo: 'DOC_CADASTRO' } })
  const item = await banco.item.create({
    data: {
      categoriaId: categoria.id,
      titulo: 'Documento sintético',
      status: dono ? 'distribuido' : 'concluido',
      confianca: 1,
      cpfProtegido: protegerCpf(CPF),
    },
    select: { id: true },
  })

  if (dono) {
    await banco.atribuicao.create({
      data: {
        itemId: item.id,
        colaboradorId: dono.id,
        motivo: 'algoritmo',
        atribuidoPor: dono.atribuidoPor,
        ativa: true,
      },
    })
  }

  return item
}

describe('POST /api/itens/busca', () => {
  it('sem sessão, recusa', async () => {
    await semearBase(banco, { totalDeDias: 1 })
    const { POST } = await import('./route')

    const resposta = await POST(pedido({ texto: CPF }))
    expect(resposta.status).toBe(401)
  })

  it('qualquer cargo busca — o colaborador acha pelo CPF o que está com ele', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!
    const item = await itemComCpf({ id: pessoa.id, atribuidoPor: base.operadorId })
    await entrarComo(pessoa.id, 'colaborador')
    const { POST } = await import('./route')

    const resposta = await POST(pedido({ texto: CPF }))
    expect(resposta.status).toBe(200)
    const corpo = (await resposta.json()) as { dados: { itens: { itemId: string }[] } }
    expect(corpo.dados.itens.map((linha) => linha.itemId)).toEqual([item.id])
  })

  it('a busca NÃO é porta lateral: o colaborador não acha o item da colega', async () => {
    // O recorte de `A24` é testado no serviço (`quem-ve-o-que.test.ts`); aqui
    // ele é testado na fronteira HTTP, que é por onde um atacante entraria.
    // Item da colega e item sem dono, os dois com o MESMO CPF.
    const base = await semearBase(banco, { totalDeDias: 1 })
    const colega = base.colaboradores[1]!
    const doColega = await itemComCpf({ id: colega.id, atribuidoPor: base.operadorId })
    const semDono = await itemComCpf()

    await entrarComo(base.colaboradores[0]!.id, 'colaborador')
    const { POST } = await import('./route')

    const resposta = await POST(pedido({ texto: CPF }))
    expect(resposta.status).toBe(200)
    const corpo = (await resposta.json()) as { dados: { itens: { itemId: string }[] } }
    expect(corpo.dados.itens).toEqual([])

    // A mesma busca, feita por quem coordena, acha os dois — é ela que precisa
    // do quadro inteiro para responder ao associado.
    await entrarComo(base.operador.colaboradorId, 'operador')
    const doOperador = await POST(pedido({ texto: CPF }))
    const corpoDoOperador = (await doOperador.json()) as {
      dados: { itens: { itemId: string }[] }
    }
    expect(new Set(corpoDoOperador.dados.itens.map((linha) => linha.itemId))).toEqual(
      new Set([doColega.id, semDono.id]),
    )
  })

  it('não existe busca pelo endereço da página', async () => {
    // Um GET levaria o CPF na URL: histórico do navegador e registro do servidor.
    const modulo = (await import('./route')) as Record<string, unknown>
    expect(modulo['GET']).toBeUndefined()
  })

  it('a resposta de erro não devolve o número digitado', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    await entrarComo(base.operador.colaboradorId, 'operador')
    const { POST } = await import('./route')

    const resposta = await POST(pedido({ texto: '111.444.777-36' }))
    expect(resposta.status).toBeGreaterThanOrEqual(400)
    expect(resposta.status).toBeLessThan(500)
    const texto = JSON.stringify(await resposta.json())
    expect(texto).not.toContain('111.444')
    expect(texto).not.toContain('11144477736')
  })

  it('muitas buscas seguidas da mesma pessoa são barradas', async () => {
    // Quem está logado não precisa de dezenas de buscas por minuto; um laço
    // tentando CPFs precisaria.
    const base = await semearBase(banco, { totalDeDias: 1 })
    await entrarComo(base.colaboradores[1]!.id, 'colaborador')
    const { POST } = await import('./route')

    const estados: number[] = []
    for (let vez = 0; vez < 40; vez += 1) {
      estados.push((await POST(pedido({ texto: '9876' }))).status)
    }
    expect(estados[0]).toBe(200)
    expect(estados).toContain(429)
  })
})
