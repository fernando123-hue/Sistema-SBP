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

  it('GET /api/revisao/[id]/email recusa colaborador antes de olhar a revisão (`A69`, 2A)', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    await entrarComo(base.colaboradores[0]!.id, 'colaborador')

    const { GET } = await import('./revisao/[id]/email/route')
    const resposta = await GET(new Request('http://teste.local/api/revisao/qualquer/email'), {
      params: Promise.resolve({ id: 'qualquer' }),
    })

    expect(resposta.status).toBe(403)
    // 403 e não "não encontrada": a recusa não diz se a revisão existe.
    expect(JSON.stringify(await corpoDe(resposta))).not.toContain('encontrada')
    // A rota inteira não se guarda em cache: a resposta de sucesso tem nome e CPF.
    expect(resposta.headers.get('Cache-Control')).toBe('no-store')
  })

  it('GET /api/revisao/[id]/email tem limite por pessoa: um laço não lê a caixa do setor inteira', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    await entrarComo(base.operador.colaboradorId, 'operador')

    const { GET } = await import('./revisao/[id]/email/route')
    const ler = () =>
      GET(new Request('http://teste.local/api/revisao/x/email'), { params: Promise.resolve({ id: `x` }) })
    const respostas: number[] = []
    const cabecalhos: (string | null)[] = []
    for (let i = 0; i < 31; i += 1) {
      const resposta = await ler()
      respostas.push(resposta.status)
      cabecalhos.push(resposta.headers.get('Cache-Control'))
    }

    expect(respostas.slice(0, 30).every((status) => status !== 429)).toBe(true)
    expect(respostas[30]).toBe(429)
    expect(cabecalhos.every((valor) => valor === 'no-store')).toBe(true)
  })

  it('GET /api/itens/[id]/dados não se guarda em cache e tem limite por pessoa (`A69`, 3B)', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    await entrarComo(base.colaboradores[0]!.id, 'colaborador')

    const { GET } = await import('./itens/[id]/dados/route')
    const ler = () =>
      GET(new Request('http://teste.local/api/itens/x/dados'), { params: Promise.resolve({ id: 'x' }) })
    const respostas: number[] = []
    const cabecalhos: (string | null)[] = []
    for (let i = 0; i < 61; i += 1) {
      const resposta = await ler()
      respostas.push(resposta.status)
      cabecalhos.push(resposta.headers.get('Cache-Control'))
    }

    // Item que não existe: a mesma recusa de negócio de item alheio, sem dizer qual dos dois.
    expect(respostas[0]).toBe(422)
    expect(respostas.slice(0, 60).every((status) => status !== 429)).toBe(true)
    expect(respostas[60]).toBe(429)
    // A resposta de sucesso tem CPF: nem ela nem a recusa vão para cache.
    expect(cabecalhos.every((valor) => valor === 'no-store')).toBe(true)
  })

  it('GET /api/fila/hoje: só o número de quem está na sessão, sem parâmetro e sem cache (`A69`, 5A; `A71`)', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const { GET } = await import('./fila/hoje/route')
    const ler = (consulta = '') => GET(new Request(`http://teste.local/api/fila/hoje${consulta}`))

    cookieDaVez.valor = ''
    expect((await ler()).status).toBe(401)

    await entrarComo(base.colaboradores[0]!.id, 'colaborador')
    const propria = await ler()
    expect(propria.status).toBe(200)
    expect(propria.headers.get('Cache-Control')).toBe('no-store')
    const corpo = (await propria.json()) as { dados: { concluidos: number; data: string } }
    expect(corpo.dados.concluidos).toBe(0)
    expect(Object.keys(corpo.dados).sort()).toEqual(['concluidos', 'data'])

    // Invariante 5: pedir o de outra pessoa é recusado, não respondido com o próprio.
    await entrarComo(base.operadorId, 'operador')
    const daOperadora = (await (await ler()).json()) as { dados: { concluidos: number } }
    expect(daOperadora.dados.concluidos).toBe(0)
    const alheia = await ler(`?colaborador=${base.colaboradores[0]!.id}`)
    expect(alheia.status).toBe(400)
    expect(alheia.headers.get('Cache-Control')).toBe('no-store')
  })

  it('POST /api/fila/concluir-junto: quem conclui vem da sessão, a lista tem teto, e há limite por pessoa (`A69`, 3A)', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const { POST } = await import('./fila/concluir-junto/route')
    const enviar = (corpo: unknown) =>
      POST(
        new Request('http://teste.local/api/fila/concluir-junto', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(corpo),
        }),
      )

    cookieDaVez.valor = ''
    expect((await enviar({ itemIds: ['x'] })).status).toBe(401)

    await entrarComo(base.colaboradores[0]!.id, 'colaborador')
    // Invariante 5: "quem" no corpo é recusado, não ignorado.
    expect((await enviar({ itemIds: ['x'], colaboradorId: base.colaboradores[1]!.id })).status).toBe(400)
    expect((await enviar({ itemIds: Array.from({ length: 501 }, (_, i) => `id-${i}`) })).status).toBe(400)

    const respostas: number[] = []
    for (let i = 0; i < 20; i += 1) respostas.push((await enviar({ itemIds: ['x'] })).status)
    // Os dois 400 acima já contaram: o limite é por pessoa, não por resposta boa.
    expect(respostas.includes(429)).toBe(true)
    expect(respostas.filter((status) => status !== 429).every((status) => status === 422)).toBe(true)
  })

  it('POST /api/revisao/resolver-email: só quem revisa, corpo estrito, lista com teto e limite por pessoa (`A69`, 1A)', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const { POST } = await import('./revisao/resolver-email/route')
    const enviar = (corpo: unknown) =>
      POST(
        new Request('http://teste.local/api/revisao/resolver-email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(corpo),
        }),
      )
    const linha = { revisaoId: 'x', titulo: 'Item sintético', campos: {}, aprovar: true }

    cookieDaVez.valor = ''
    expect((await enviar({ emailId: 'e', revisoes: [linha] })).status).toBe(401)

    await entrarComo(base.colaboradores[0]!.id, 'colaborador')
    expect((await enviar({ emailId: 'e', revisoes: [linha] })).status).toBe(403)

    await entrarComo(base.operadorId, 'operador')
    // Invariante 5: "quem" no corpo é recusado, não ignorado.
    expect((await enviar({ emailId: 'e', revisoes: [linha], resolvidoPor: base.colaboradores[0]!.id })).status).toBe(400)
    expect((await enviar({ emailId: 'e', revisoes: [{ ...linha, resolvidoPor: 'y' }] })).status).toBe(400)
    const muitas = Array.from({ length: 501 }, (_, i) => ({ ...linha, revisaoId: `r-${i}` }))
    expect((await enviar({ emailId: 'e', revisoes: muitas })).status).toBe(400)

    const respostas: number[] = []
    for (let i = 0; i < 20; i += 1) respostas.push((await enviar({ emailId: 'e', revisoes: [linha] })).status)
    expect(respostas.includes(429)).toBe(true)
    // E-mail inexistente: conjunto não bate, nada decidido.
    expect(respostas.filter((status) => status !== 429).every((status) => status === 422)).toBe(true)
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

  it('/api/ingestao: colaborador não busca nem acompanha; o andamento sai sem cache (`AT-62`)', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const { GET, POST } = await import('./ingestao/route')

    await entrarComo(base.colaboradores[0]!.id, 'colaborador')
    expect((await POST()).status).toBe(403)
    expect((await GET()).status).toBe(403)

    await entrarComo(base.operador.colaboradorId, 'operador')
    const andamento = await GET()
    expect(andamento.status).toBe(200)
    expect(andamento.headers.get('Cache-Control')).toBe('no-store')
    expect(((await andamento.json()) as { dados: { situacao: string } }).dados.situacao).toBe('nenhuma')
  })

  // `A76`, revisões do #191: o aviso dos e-mails guardados por dado vem do
  // banco, não da última busca — dura enquanto o e-mail estiver guardado.
  it('GET /api/ingestao/guardados: colaborador não vê; operador vê só o número dos ainda guardados, sem cache', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const email = (messageId: string, dadoSemItem: string | null, expurgado: boolean) =>
      banco.email.create({
        data: {
          messageId,
          recebidoEm: new Date(),
          processadoEm: new Date(),
          dadoSemItem,
          conteudoExpurgadoEm: expurgado ? new Date() : null,
        },
      })
    await email('guardado-cpf@teste.local', 'cpf', false)
    await email('guardado-anexo@teste.local', 'anexo', false)
    await email('ja-expurgado@teste.local', 'cpf', true)
    await email('comum@teste.local', null, false)
    const { GET } = await import('./ingestao/guardados/route')

    await entrarComo(base.colaboradores[0]!.id, 'colaborador')
    expect((await GET()).status).toBe(403)

    await entrarComo(base.operador.colaboradorId, 'operador')
    const resposta = await GET()
    expect(resposta.status).toBe(200)
    expect(resposta.headers.get('Cache-Control')).toBe('no-store')
    expect(((await resposta.json()) as { dados: unknown }).dados).toEqual({ guardados: 2 })
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
