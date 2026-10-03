import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { config, proxy } from '../src/proxy'
import { problemasDoProxyNoManifesto } from './conferir-proxy'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

/** O manifesto como o `next build` 16.3.6 o grava (copiado de um build real). */
const MANIFESTO_REAL = {
  version: 1,
  functions: {
    '/_middleware': {
      runtime: 'nodejs',
      matchers: [
        {
          regexp:
            '^(?:\\/(_next\\/data\\/[^/]{1,}))?(?:\\/((?!_next\\/static|_next\\/image|favicon.ico).*))(\\.json|\\.rsc|\\.segments\\/.+\\.segment\\.rsc)?[\\/#\\?]?$',
          originalSource: '/((?!_next/static|_next/image|favicon.ico).*)',
        },
      ],
    },
  },
}

describe('o build registrou o proxy (conferido no CI depois do `next build`)', () => {
  it('o manifesto de um build real passa', () => {
    expect(problemasDoProxyNoManifesto(MANIFESTO_REAL)).toEqual([])
  })

  it('proxy ausente do manifesto é acusado — o caso do arquivo ignorado em silêncio', () => {
    expect(problemasDoProxyNoManifesto({ version: 1, functions: {} })).toEqual([
      'o build não registrou o proxy (`/_middleware` ausente do manifesto)',
    ])
  })

  it('matcher que deixa /api de fora é acusado', () => {
    const semApi = {
      functions: { '/_middleware': { matchers: [{ regexp: '^\\/(?!api|_next\\/static).*$' }] } },
    }
    expect(problemasDoProxyNoManifesto(semApi)).toEqual(['o proxy não cobre /api/sessao'])
  })
})

/**
 * A convenção do lado do código: o Next procura `proxy.ts` (ou o antigo
 * `middleware.ts`) na raiz ou em `src/`. Um só, e é este. Os dois juntos o
 * Next recusa alto; o perigo é NENHUM no lugar, que ele aceita calado.
 */
describe('a convenção do proxy no código', () => {
  it('existe exatamente um arquivo de proxy, e é src/proxy.ts', () => {
    const candidatos = ['src/proxy.ts', 'src/middleware.ts', 'proxy.ts', 'middleware.ts']
    expect(candidatos.filter((c) => existsSync(join(RAIZ, c)))).toEqual(['src/proxy.ts'])
    expect(typeof proxy).toBe('function')
    expect(config.matcher.length).toBeGreaterThan(0)
  })

  // No runtime Node.js, o proxy enxerga `fs` e o ambiente inteiro do processo,
  // e roda em TODA requisição. Importar `servidor/ambiente` ou `servidor/sessao`
  // traria arquivo e segredo para esse caminho (revisão de segurança do PR).
  it('o proxy só importa o Next e a regra de mesma origem', () => {
    const fonte = readFileSync(join(RAIZ, 'src', 'proxy.ts'), 'utf8')
    const importados = [...fonte.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
    expect(importados.sort()).toEqual(['./servidor/mesma-origem', 'next/server'])
  })
})
