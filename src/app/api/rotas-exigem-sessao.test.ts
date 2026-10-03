import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { limparCacheDeAmbiente } from '../../servidor/ambiente'
import { obterPrisma } from '../../servidor/prisma'
import { montarCookie } from '../../servidor/sessao'
import { limparTudo } from '../../testes/apoio'

/**
 * Toda rota da API exige sessão — varredura, não lista escrita à mão.
 *
 * ═══ POR QUE ESTE ARQUIVO EXISTE ═══
 *
 * `autorizacao-de-rotas.test.ts` prova o 401 rota por rota, e as revisões do
 * #194 acharam oito rotas sem esse teste. Em `categorias`, que não tem papel
 * nem serviço por trás, apagar o `exigirAtor` deixava a rota pública com a
 * suíte inteira verde. Lista escrita à mão envelhece no primeiro arquivo novo;
 * esta lê a pasta, então rota criada amanhã já nasce coberta — ou o teste fica
 * vermelho e obriga alguém a dizer, por escrito, por que ela é pública.
 *
 * Sem cookie, 401. Com a senha provisória, 403 (bloco do fim do arquivo).
 * Quem pode o quê por papel continua nos testes de cada serviço e em
 * `autorizacao-de-rotas.test.ts`.
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

const API = dirname(fileURLToPath(import.meta.url))

/**
 * As únicas rotas que respondem sem sessão, cada uma com o motivo. Acrescentar
 * uma aqui é abrir uma porta: precisa de revisão de segurança (nível 3).
 */
const PUBLICAS: Readonly<Record<string, string>> = {
  'sessao/route.ts': 'é a própria entrada: login, consulta da sessão e saída',
  'sessao/local/route.ts':
    'acesso local sem senha, só desenvolvimento: desligado responde 404; as travas estão em `servidor/acesso-local.ts`',
}

// `HEAD` e `OPTIONS` também valem como export de `route.ts` no Next; nenhuma
// rota os tem hoje, e a primeira que tiver já entra na varredura.
const METODOS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const

type Manipulador = (requisicao: Request, contexto: { params: Promise<Record<string, string>> }) => Promise<Response>

const rotas = readdirSync(API, { recursive: true, encoding: 'utf8' })
  .map((nome) => nome.replaceAll('\\', '/'))
  .filter((nome) => nome.endsWith('/route.ts') || nome === 'route.ts')
  .sort()

const protegidas = rotas.filter((nome) => !(nome in PUBLICAS))

/** A única rota protegida que aceita quem ainda está com a senha provisória. */
const TROCA_DE_SENHA = 'sessao/senha/route.ts'

beforeEach(() => {
  process.env['SESSAO_SECRET'] = 'segredo-de-teste-com-tamanho-suficiente'
  limparCacheDeAmbiente()
  cookieDaVez.valor = ''
})

describe('toda rota da API exige sessão', () => {
  it('a varredura acha as rotas, e toda rota pública listada existe', () => {
    // Sem isto, um caminho errado faria a varredura passar sem olhar nada.
    expect(protegidas.length).toBeGreaterThan(30)
    for (const publica of Object.keys(PUBLICAS)) expect(rotas).toContain(publica)
  })

  it.each(protegidas)('%s: sem cookie, todo método responde 401', async (nome) => {
    for (const { metodo, status } of await chamarTodos(nome)) {
      expect({ metodo, status }).toEqual({ metodo, status: 401 })
    }
  })
})

/**
 * Senha provisória: entra, mas só troca a senha e sai.
 *
 * Revisão de segurança deste PR: nada provava o 403 nas rotas. O único teste
 * olhava `exigirAtor()` lançando, sem passar por `rota()`. E a varredura de
 * 401 não pegaria uma rota que trocasse `exigirAtor` por
 * `exigirAtorParaTrocaDeSenha` — essa também dá 401 sem cookie, mas abre a
 * rota a quem ainda não trocou a senha que o gestor definiu.
 *
 * A pessoa é GESTORA de propósito: é o papel com mais acesso, então um 403
 * aqui só pode vir da senha provisória, nunca de falta de papel.
 */
describe('senha provisória só troca a senha e sai', () => {
  const banco = obterPrisma()

  beforeEach(async () => {
    await limparTudo(banco)
    const gestora = await banco.colaborador.create({
      data: {
        nome: 'Gestora Provisória',
        email: 'gestora-provisoria@teste.local',
        papel: 'gestor',
        precisaTrocarSenha: true,
        senhaDefinidaEm: new Date(),
      },
    })
    // A data lida do banco, como em `autorizacao-de-rotas.test.ts`: o cookie
    // carrega o carimbo que `perfilAtual` compara, na precisão da coluna.
    cookieDaVez.valor = montarCookie(gestora.id, 'gestor', gestora.senhaDefinidaEm)
  })

  it.each(protegidas.filter((nome) => nome !== TROCA_DE_SENHA))('%s: todo método responde 403', async (nome) => {
    for (const { metodo, status } of await chamarTodos(nome)) {
      expect({ metodo, status }).toEqual({ metodo, status: 403 })
    }
  })

  it('a troca de senha passa da porta: o corpo vazio é recusado pela validação, não pela sessão', async () => {
    const [chamada, ...resto] = await chamarTodos(TROCA_DE_SENHA)
    expect(resto).toEqual([])
    expect(chamada).toEqual({ metodo: 'POST', status: 400 })
  })

  it('sair funciona com a senha provisória', async () => {
    const { DELETE } = await import('./sessao/route')
    expect((await DELETE()).status).toBe(200)
  })
})

/** Chama cada método exportado pela rota, com corpo `{}` e um `id` que não existe. */
async function chamarTodos(nome: string): Promise<{ metodo: string; status: number }[]> {
  const modulo = (await import(join(API, nome))) as Partial<Record<(typeof METODOS)[number], Manipulador>>
  const metodos = METODOS.filter((metodo) => typeof modulo[metodo] === 'function')
  expect(metodos.length).toBeGreaterThan(0)

  const resultados: { metodo: string; status: number }[] = []
  for (const metodo of metodos) {
    const semCorpo = metodo === 'GET' || metodo === 'HEAD'
    const requisicao = new Request(`http://localhost/api/${nome.replace(/\/?route\.ts$/, '')}`, {
      method: metodo,
      ...(semCorpo ? {} : { body: '{}', headers: { 'content-type': 'application/json' } }),
    })
    const resposta = await modulo[metodo]!(requisicao, { params: Promise.resolve({ id: 'inexistente' }) })
    resultados.push({ metodo, status: resposta.status })
  }
  return resultados
}
