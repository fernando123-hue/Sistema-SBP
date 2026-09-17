import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A fronteira de composição: dentro de `adapters/`, só a fábrica importa
 * `servicos/`.
 *
 * O controle de consumo (`A54`) precisou juntar duas metades que moram em
 * camadas diferentes — o invólucro, que é adapter, e a contagem no banco, que é
 * serviço. Quem junta é `fabrica.ts`, a raiz de composição, e o comentário dela
 * diz isso. Só que comentário não é guarda: bastaria o próximo adapter chamar
 * `registrarChamada` direto para a seta `app → servicos → core` ganhar um
 * atalho, e a suíte continuaria verde.
 *
 * Mesmo argumento de `core/pureza.test.ts` e `fronteira-do-fornecedor.test.ts`:
 * disciplina não sobrevive a um dia corrido, e a regressão não aparece como
 * erro — aparece como um import a mais que ninguém nota na revisão.
 *
 * Quem pode importar `servicos/` de dentro de `adapters/`:
 *   - `adapters/fabrica.ts`, a raiz de composição;
 *   - testes dentro de `adapters/`, que montam o cenário.
 */

const RAIZ_ADAPTERS = dirname(fileURLToPath(import.meta.url))
const RAIZ_SRC = dirname(RAIZ_ADAPTERS)
const RAIZ_PROJETO = dirname(RAIZ_SRC)
const FABRICA = join(RAIZ_ADAPTERS, 'fabrica.ts')

function listarTs(diretorio: string): string[] {
  return readdirSync(diretorio, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(diretorio, entrada.name)
    if (entrada.isDirectory()) return entrada.name === 'generated' ? [] : listarTs(caminho)
    return /\.tsx?$/.test(entrada.name) ? [caminho] : []
  })
}

/** Os mesmos padrões de `fronteira-do-fornecedor.test.ts`: estático, reexportação, dinâmico e `require`. */
const PADROES_DE_IMPORT: readonly RegExp[] = [
  /(?:^|[;}])[ \t]*(?:import|export)\s+[^;'"()]*\bfrom\s*(['"])([^'"\n]+)\1/gm,
  /(?:^|[;}])[ \t]*import\s*(['"])([^'"\n]+)\1/gm,
  /\bimport\s*\(\s*(['"`])([^'"`\n]+)\1/g,
  /\brequire\s*\(\s*(['"`])([^'"`\n]+)\1/g,
]

interface Violacao {
  readonly arquivo: string
  readonly importou: string
}

function ehServico(especificador: string): boolean {
  return especificador.startsWith('@/servicos/') || /(^|\/)\.\.\/servicos\//.test(especificador)
}

function podeImportarServico(arquivo: string): boolean {
  if (arquivo === FABRICA) return true
  return /\.test\.tsx?$/.test(arquivo)
}

function analisar(fonte: string, arquivo: string): Violacao[] {
  if (!arquivo.startsWith(RAIZ_ADAPTERS + sep)) return []
  if (podeImportarServico(arquivo)) return []

  return PADROES_DE_IMPORT.flatMap((padrao) =>
    [...fonte.matchAll(padrao)]
      .map((achado) => achado[2] ?? '')
      .filter(ehServico)
      .map((importou) => ({ arquivo: relative(RAIZ_PROJETO, arquivo), importou })),
  )
}

describe('fronteira de composição entre adapters e serviços', () => {
  it('só a fábrica importa `servicos/` de dentro de `adapters/`', () => {
    const violacoes = listarTs(RAIZ_ADAPTERS).flatMap((arquivo) =>
      analisar(readFileSync(arquivo, 'utf8'), arquivo),
    )

    expect(
      violacoes,
      'Um adapter que fala com `servicos/` cria um atalho na seta `app → servicos → core`. ' +
        'Receba o que precisar por parâmetro e deixe `fabrica.ts` fazer a ligação.',
    ).toEqual([])
  })

  it('a fábrica realmente importa `servicos/` hoje — senão este teste não guarda nada', () => {
    // Se a fiação sumisse, a varredura passaria verde sem ter o que provar.
    expect(readFileSync(FABRICA, 'utf8')).toMatch(/from '\.\.\/servicos\//)
  })

  it('detecta as formas de importar que promete detectar', () => {
    const casos: readonly [string, string][] = [
      [`import { registrarChamada } from '../servicos/consumo-da-ia'`, join(RAIZ_ADAPTERS, 'ia-gemini.ts')],
      [`export { chamadasDoDia } from '@/servicos/consumo-da-ia'`, join(RAIZ_ADAPTERS, 'ia-anthropic.ts')],
      [`const m = await import('../servicos/ingestao')`, join(RAIZ_ADAPTERS, 'assistente-modelo.ts')],
      ['const m = require(`../servicos/consumo-da-ia`)', join(RAIZ_ADAPTERS, 'cliente-com-consumo.ts')],
    ]

    for (const [fonte, arquivo] of casos) {
      expect(analisar(fonte, arquivo), fonte).toHaveLength(1)
    }
  })

  it('não acusa quem tem direito nem quem está fora de `adapters/`', () => {
    const casos: readonly [string, string][] = [
      [`import { chamadasDoDia } from '../servicos/consumo-da-ia'`, FABRICA],
      [`import { registrarChamada } from '../servicos/consumo-da-ia'`, join(RAIZ_ADAPTERS, 'fabrica-consumo.test.ts')],
      [`import { distribuir } from '../servicos/distribuicao'`, join(RAIZ_SRC, 'app/api/ingestao/route.ts')],
      [`import { LIMITES_PADRAO } from '../core/ia/consumo'`, join(RAIZ_ADAPTERS, 'cliente-com-consumo.ts')],
    ]

    for (const [fonte, arquivo] of casos) {
      expect(analisar(fonte, arquivo), fonte).toEqual([])
    }
  })
})
