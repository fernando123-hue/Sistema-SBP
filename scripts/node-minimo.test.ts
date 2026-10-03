import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * O Node mínimo é o do CI — e o `npm` recusa instalar fora dele.
 *
 * O proxy (`src/proxy.ts`) usa o `crypto` global para o nonce da CSP, que
 * Node antigo não tem: o servidor sobe, e a primeira requisição quebra
 * (revisão de segurança do #200). `docs/INSTALACAO.md` já pedia o Node 22, mas
 * só em texto. Agora `engines` declara, e `engine-strict` no `.npmrc` faz o
 * `npm ci` parar alto num Node antigo, no lugar de um aviso que ninguém lê.
 */
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const ler = (...partes: string[]) => readFileSync(join(RAIZ, ...partes), 'utf8')

describe('Node mínimo', () => {
  it('engines.node é ">=" a versão do CI, e é a mesma em todo workflow', () => {
    const versoesDoCi = [ler('.github', 'workflows', 'ci.yml'), ler('.github', 'workflows', 'processo.yml')].flatMap(
      (texto) => [...texto.matchAll(/node-version:\s*(\d+)/g)].map((m) => m[1]),
    )
    expect(new Set(versoesDoCi).size).toBe(1)
    const pacote = JSON.parse(ler('package.json')) as { engines?: { node?: string } }
    expect(pacote.engines?.node).toBe(`>=${versoesDoCi[0]}`)
  })

  it('o npm recusa instalar num Node fora do mínimo', () => {
    expect(ler('.npmrc')).toMatch(/^engine-strict=true$/m)
  })

  it('a instalação pede a mesma versão', () => {
    const pacote = JSON.parse(ler('package.json')) as { engines?: { node?: string } }
    const versao = pacote.engines?.node?.replace('>=', '')
    expect(ler('docs', 'INSTALACAO.md')).toContain(`**Node ${versao}**`)
  })
})
