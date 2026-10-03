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
 *
 * O mínimo é 22.12, e não 22.0: é o que o `vitest` e o `vite` exigem
 * (`^22.12.0 || …`). Com `>=22`, um 22.5 passaria pelo projeto e cairia num
 * EBADENGINE apontando para uma dependência (revisão técnica do PR).
 */
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const ler = (...partes: string[]) => readFileSync(join(RAIZ, ...partes), 'utf8')
const minimo = (): string => (JSON.parse(ler('package.json')) as { engines?: { node?: string } }).engines?.node ?? ''

describe('Node mínimo', () => {
  it('engines.node é o major do CI, a partir do .12, e o CI usa um só major', () => {
    const versoesDoCi = [ler('.github', 'workflows', 'ci.yml'), ler('.github', 'workflows', 'processo.yml')].flatMap(
      (texto) => [...texto.matchAll(/node-version:\s*(\d+)/g)].map((m) => m[1]),
    )
    expect(new Set(versoesDoCi).size).toBe(1)
    expect(minimo()).toBe(`>=${versoesDoCi[0]}.12`)
  })

  it('a instalação pede a mesma versão', () => {
    const [major, menor] = minimo().replace('>=', '').split('.')
    expect(ler('docs', 'INSTALACAO.md')).toContain(`**Node ${major}** (${major}.${menor} ou mais novo)`)
  })

  /**
   * Lista FECHADA (revisão de segurança do PR): o `.npmrc` versionado decide
   * de onde o npm baixa (`registry`), se roda script de instalação
   * (`ignore-scripts`), em que certificado confia (`strict-ssl`, `cafile`) e
   * onde mora o token. Lista de proibidas sempre esquece uma chave; aqui, chave
   * nova só entra mudando este teste — que é nível 3. E a chave aparece uma vez
   * só: o npm usa a ÚLTIMA ocorrência, e um `engine-strict=false` no fim
   * desligaria a trava com a primeira linha ainda certa.
   */
  it('o .npmrc só tem engine-strict=true, uma vez', () => {
    const conteudo = ler('.npmrc')
    // O npm quebra linha em QUALQUER `\r` ou `\n`. Com `\r?\n`, um `\r` solto
    // escondia uma chave dentro da linha de comentário — `# c\rregistry=…`: o
    // npm lia o registro trocado, e o teste descartava a linha inteira como
    // comentário (2ª rodada da revisão de segurança, conferido no npm 11.16).
    expect(conteudo).not.toMatch(/\r/)
    const linhas = conteudo
      .split(/[\r\n]+/)
      .map((linha) => linha.trim())
      .filter((linha) => linha !== '' && !linha.startsWith('#') && !linha.startsWith(';'))
    expect(linhas).toEqual(['engine-strict=true'])
  })
})
