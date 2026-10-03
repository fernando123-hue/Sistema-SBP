import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { limparCacheDeAmbiente } from '../../servidor/ambiente'

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
 * Só o 401 sem cookie. Quem pode o quê (403) continua nos testes de cada
 * serviço e em `autorizacao-de-rotas.test.ts`.
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

const METODOS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

type Manipulador = (requisicao: Request, contexto: { params: Promise<Record<string, string>> }) => Promise<Response>

const rotas = readdirSync(API, { recursive: true, encoding: 'utf8' })
  .map((nome) => nome.replaceAll('\\', '/'))
  .filter((nome) => nome.endsWith('/route.ts') || nome === 'route.ts')
  .sort()

const protegidas = rotas.filter((nome) => !(nome in PUBLICAS))

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
    const modulo = (await import(join(API, nome))) as Partial<Record<(typeof METODOS)[number], Manipulador>>
    const metodos = METODOS.filter((metodo) => typeof modulo[metodo] === 'function')
    expect(metodos.length).toBeGreaterThan(0)

    for (const metodo of metodos) {
      const requisicao = new Request(`http://localhost/api/${nome.replace(/\/?route\.ts$/, '')}`, {
        method: metodo,
        ...(metodo === 'GET' ? {} : { body: '{}', headers: { 'content-type': 'application/json' } }),
      })
      const resposta = await modulo[metodo]!(requisicao, { params: Promise.resolve({ id: 'inexistente' }) })
      expect({ metodo, status: resposta.status }).toEqual({ metodo, status: 401 })
    }
  })
})
