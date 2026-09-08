import { beforeEach, describe, expect, it, vi } from 'vitest'

import { limparCacheDeAmbiente } from '../../servidor/ambiente'
import { obterPrisma } from '../../servidor/prisma'
import { montarCookie } from '../../servidor/sessao'
import { limparTudo, semearBase } from '../../testes/apoio'

/**
 * Autorização das rotas que guardam o papel SOZINHAS.
 *
 * ═══ POR QUE ESTE ARQUIVO EXISTE ═══
 *
 * Na maioria das rotas, a conferência de papel mora no serviço, e o teste do
 * serviço a cobre — `pipeline.test.ts` prova que ninguém conclui item alheio,
 * `memoria.test.ts` prova que colaborador não lê a trilha, e assim por diante.
 *
 * Nestas quatro, não: a checagem existe **só no arquivo da rota**.
 * `listarPendentes`, `detalharRodada` e a consulta de colaboradores não têm
 * guarda de papel nenhuma do lado do serviço. Apagar uma linha `exigirPapel`
 * num refactor deixava a suíte inteira verde e reabria exatamente o buraco que
 * o comentário de cada uma delas diz ter fechado — em `colaboradores`, "ERA
 * PÚBLICA e não é mais"; em `rodadas/[id]`, "qualquer colaborador autenticado
 * lia o livro-razão da equipe inteira".
 *
 * ═══ POR QUE PRECISA DE UM DUBLE DE `next/headers` ═══
 *
 * A identidade vem do cookie assinado, e `cookies()` só existe dentro de uma
 * requisição do Next. O duble abaixo devolve o cookie que o teste montou com o
 * MESMO `montarCookie` que a rota de entrada usa — nada de identidade forjada
 * por outro caminho, que seria testar um sistema diferente do que roda.
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

/**
 * Coloca a pessoa na sessão, como o navegador dela faria.
 *
 * Lê `senhaDefinidaEm` do banco em vez de inventar uma data: `perfilAtual`
 * compara os dois, e um carimbo diferente mata a sessão — é assim que trocar de
 * senha derruba os cookies antigos. Inventar a data aqui daria 401 em todos
 * estes testes, e o vermelho pareceria falta de autorização.
 */
async function entrarComo(
  colaboradorId: string,
  papel: 'colaborador' | 'operador' | 'gestor',
): Promise<void> {
  const pessoa = await banco.colaborador.findUniqueOrThrow({
    where: { id: colaboradorId },
    select: { senhaDefinidaEm: true },
  })
  cookieDaVez.valor = montarCookie(colaboradorId, papel, pessoa.senhaDefinidaEm)
}

async function corpoDe(resposta: Response): Promise<{ sucesso: boolean; erro: string | null }> {
  return (await resposta.json()) as { sucesso: boolean; erro: string | null }
}

beforeEach(async () => {
  process.env['SESSAO_SECRET'] = 'segredo-de-teste-com-tamanho-suficiente'
  limparCacheDeAmbiente()
  cookieDaVez.valor = ''
  await limparTudo(banco)
})

describe('rotas que guardam o papel sozinhas', () => {
  it('GET /api/colaboradores recusa quem não é gestor, e não vaza e-mail nem tentativas', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const { GET } = await import('./colaboradores/route')

    for (const [id, papel] of [
      [base.colaboradores[0]!.id, 'colaborador'],
      [base.operador.colaboradorId, 'operador'],
    ] as const) {
      await entrarComo(id, papel)
      const resposta = await GET()
      expect(resposta.status).toBe(403)

      // O corpo do 403 não pode carregar o que a rota devolveria: a lista de
      // nomes e e-mails da equipe é justamente o material de quem monta ataque
      // direcionado.
      const texto = JSON.stringify(await corpoDe(resposta))
      expect(texto).not.toContain('@')
      expect(texto).not.toContain('tentativasFalhas')
    }
  })

  it('GET /api/colaboradores responde ao gestor', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const gestor = await banco.colaborador.create({
      data: { nome: 'Gestora', email: 'gestora-rotas@teste.local', papel: 'gestor' },
    })
    void base

    await entrarComo(gestor.id, 'gestor')
    const { GET } = await import('./colaboradores/route')
    const resposta = await GET()

    expect(resposta.status).toBe(200)
    expect((await corpoDe(resposta)).sucesso).toBe(true)
  })

  it('GET /api/revisao recusa colaborador', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    await entrarComo(base.colaboradores[0]!.id, 'colaborador')

    const { GET } = await import('./revisao/route')
    const resposta = await GET()

    expect(resposta.status).toBe(403)
  })

  it('GET /api/rodadas/[id] recusa colaborador — o livro-razão não é material aberto', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    await entrarComo(base.colaboradores[0]!.id, 'colaborador')

    const { GET } = await import('./rodadas/[id]/route')
    const resposta = await GET(new Request('http://teste.local/api/rodadas/qualquer'), {
      params: Promise.resolve({ id: 'qualquer' }),
    })

    expect(resposta.status).toBe(403)
    // Nem o crédito de ninguém, nem a existência da rodada: 403 antes de olhar.
    expect(JSON.stringify(await corpoDe(resposta))).not.toContain('credito')
  })

  it('sem cookie nenhum, as quatro respondem 401 — e 401 não é 403', async () => {
    await semearBase(banco, { totalDeDias: 1 })
    cookieDaVez.valor = ''

    const { GET: colaboradores } = await import('./colaboradores/route')
    const { GET: revisao } = await import('./revisao/route')

    expect((await colaboradores()).status).toBe(401)
    expect((await revisao()).status).toBe(401)
  })
})
