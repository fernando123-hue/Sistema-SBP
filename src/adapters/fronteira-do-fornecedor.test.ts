import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A fronteira do fornecedor de IA: ninguém importa um adapter de fornecedor
 * fora de `fabrica.ts`.
 *
 * É a regra que torna verdadeira a frase do `CLAUDE.md` — "nenhum fornecedor de
 * IA é premissa" — e a prova que o projeto usa para ela: acrescentar o Gemini
 * custou uma linha na fábrica. Até aqui ela era respeitada e nada a verificava.
 * Basta uma rota fazer `new IaGemini()` para "trocar de fornecedor" deixar de ser
 * uma variável de ambiente, e a suíte continuaria verde. Achado 33 da auditoria
 * de 08/09/2026; o molde é `core/pureza.test.ts`, que guarda o invariante 1.
 *
 * Quem pode importar um módulo de fornecedor:
 *   - `adapters/fabrica.ts`, que é o único lugar que escolhe;
 *   - testes dentro de `adapters/`, que exercitam o próprio adapter.
 *
 * Os módulos de fornecedor são DESCOBERTOS pelo nome (`ia-<nome>.ts`), não
 * listados: o próximo que entrar já nasce guardado.
 */

const RAIZ_ADAPTERS = dirname(fileURLToPath(import.meta.url))
const RAIZ_SRC = dirname(RAIZ_ADAPTERS)
const RAIZ_PROJETO = dirname(RAIZ_SRC)
const FABRICA = join(RAIZ_ADAPTERS, 'fabrica.ts')

/** `ia-*` que não falam com empresa nenhuma: a política comum e o duble. */
const NAO_SAO_FORNECEDOR = new Set(['ia-estruturada.ts', 'ia-mock.ts'])

function modulosDeFornecedor(): string[] {
  return readdirSync(RAIZ_ADAPTERS)
    .filter((nome) => /^ia-[a-z0-9-]+\.ts$/.test(nome) && !nome.endsWith('.test.ts'))
    .filter((nome) => !NAO_SAO_FORNECEDOR.has(nome))
    .map((nome) => join(RAIZ_ADAPTERS, nome.replace(/\.ts$/, '')))
}

function listarTs(diretorio: string): string[] {
  return readdirSync(diretorio, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(diretorio, entrada.name)
    if (entrada.isDirectory()) return entrada.name === 'generated' ? [] : listarTs(caminho)
    return /\.tsx?$/.test(entrada.name) ? [caminho] : []
  })
}

/**
 * Estático, reexportação, dinâmico e `require`.
 *
 * As formas estáticas são ancoradas em início de sentença, então linha de
 * comentário com `//` ou ` * ` não é lida como import. As formas de chamada não
 * se ancoram — podem aparecer em qualquer posição — e aceitam crase: um
 * `import(` com template literal sem interpolação é tão import quanto com aspas,
 * e deixá-lo de fora abria a fronteira pela forma mais fácil de escrever.
 */
const PADROES_DE_IMPORT: readonly RegExp[] = [
  /(?:^|[;}])[ \t]*(?:import|export)\s+[^;'"()]*\bfrom\s*(['"])([^'"\n]+)\1/gm,
  /(?:^|[;}])[ \t]*import\s*(['"])([^'"\n]+)\1/gm,
  /\bimport\s*\(\s*(['"`])([^'"`\n]+)\1/g,
  /\brequire\s*\(\s*(['"`])([^'"`\n]+)\1/g,
]

function resolverSemExtensao(especificador: string, dirDoArquivo: string): string | null {
  const alvo = especificador.startsWith('@/')
    ? resolve(RAIZ_SRC, especificador.slice(2))
    : especificador.startsWith('.')
      ? resolve(dirDoArquivo, especificador)
      : null
  return alvo?.replace(/\.(tsx?|jsx?)$/, '') ?? null
}

interface Violacao {
  readonly arquivo: string
  readonly importou: string
}

function podeImportarFornecedor(arquivo: string): boolean {
  if (arquivo === FABRICA) return true
  return arquivo.startsWith(RAIZ_ADAPTERS + sep) && /\.test\.tsx?$/.test(arquivo)
}

function analisar(fonte: string, arquivo: string, fornecedores: readonly string[]): Violacao[] {
  if (podeImportarFornecedor(arquivo)) return []

  return PADROES_DE_IMPORT.flatMap((padrao) =>
    [...fonte.matchAll(padrao)]
      .map((achado) => achado[2] ?? '')
      .filter((especificador) => {
        const alvo = resolverSemExtensao(especificador, dirname(arquivo))
        return alvo !== null && fornecedores.includes(alvo)
      })
      .map((importou) => ({ arquivo: relative(RAIZ_PROJETO, arquivo), importou })),
  )
}

describe('fronteira do fornecedor de IA', () => {
  const fornecedores = modulosDeFornecedor()

  it('encontra os adapters de fornecedor que existem hoje', () => {
    // Sem isto, uma descoberta quebrada devolveria lista vazia e o teste abaixo
    // passaria verde para sempre, sem guardar nada.
    expect(fornecedores).toEqual(
      expect.arrayContaining([join(RAIZ_ADAPTERS, 'ia-anthropic'), join(RAIZ_ADAPTERS, 'ia-gemini')]),
    )
  })

  it('só a fábrica e os testes do próprio adapter importam um fornecedor', () => {
    const arquivos = [...listarTs(RAIZ_SRC), ...listarTs(join(RAIZ_PROJETO, 'scripts'))]
    const violacoes = arquivos.flatMap((arquivo) =>
      analisar(readFileSync(arquivo, 'utf8'), arquivo, fornecedores),
    )

    expect(
      violacoes,
      'Peça `AiPort` ou `AssistentePort` a `criarAiPort()`/`criarAssistentePort()`. ' +
        'Importar o adapter direto faz a escolha do fornecedor deixar de ser `IA_ADAPTER`.',
    ).toEqual([])
  })

  it('detecta as formas de importar que promete detectar', () => {
    // Este arquivo é teste dentro de `adapters/`, então os literais abaixo não
    // o acusam: a varredura só olha a origem, e esta origem tem direito.
    const de = (caminho: string) => join(RAIZ_SRC, caminho)
    const casos: readonly [string, string][] = [
      [`import { IaGemini } from '../adapters/ia-gemini'`, de('servicos/ingestao.ts')],
      [`export { IaAnthropic } from '@/adapters/ia-anthropic'`, de('app/api/x/route.ts')],
      [`const m = await import('../../../adapters/ia-gemini.ts')`, de('app/api/ingestao/route.ts')],
      ['const m = await import(`../adapters/ia-gemini`)', de('servicos/assistente.ts')],
      [`const m = require('./ia-anthropic')`, de('adapters/assistente-modelo.ts')],
    ]

    for (const [fonte, arquivo] of casos) {
      expect(analisar(fonte, arquivo, fornecedores), fonte).toHaveLength(1)
    }
  })

  it('não acusa quem tem direito, nem o que não é fornecedor', () => {
    const casos: readonly [string, string][] = [
      [`import { IaGemini } from './ia-gemini'`, FABRICA],
      [`import { IaAnthropic } from './ia-anthropic'`, join(RAIZ_ADAPTERS, 'ia-gemini.test.ts')],
      [`import { IaMock } from '../adapters/ia-mock'`, join(RAIZ_SRC, 'servicos/pipeline.test.ts')],
      [`import { criarAiPort } from '../adapters/fabrica'`, join(RAIZ_SRC, 'app/api/ingestao/route.ts')],
    ]

    for (const [fonte, arquivo] of casos) {
      expect(analisar(fonte, arquivo, fornecedores), fonte).toEqual([])
    }
  })
})
