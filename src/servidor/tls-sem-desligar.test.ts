import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Pendência 37: `ambiente()` confere `NODE_TLS_REJECT_UNAUTHORIZED` na partida
 * e guarda o resultado. O Node relê a variável a cada `tls.connect`, então
 * código que a escrevesse depois, ou que passasse `rejectUnauthorized: false`
 * direto, desligaria a verificação sem passar pela trava. Hoje não há nenhum;
 * esta varredura transforma a ausência em regra (revisão de segurança do PR da
 * pendência 37).
 *
 * Fica de fora `ambiente.ts`, que LÊ a variável para recusá-la, e os testes,
 * que a ligam com `vi.stubEnv` para provar a recusa.
 */

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PERMITIDOS = new Set(['src/servidor/ambiente.ts'])
const PROIBIDO = /NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized\s*:\s*false/

function fontes(pasta: string): string[] {
  return readdirSync(pasta, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(pasta, entrada.name)
    if (entrada.isDirectory()) return entrada.name === 'generated' ? [] : fontes(caminho)
    return /\.(ts|tsx|mjs|js)$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name) ? [caminho] : []
  })
}

describe('ninguém desliga a verificação de TLS por fora da trava (pendência 37)', () => {
  it('src/ e scripts/ não escrevem NODE_TLS_REJECT_UNAUTHORIZED nem passam rejectUnauthorized: false', () => {
    const ofensores = [...fontes(join(RAIZ, 'src')), ...fontes(join(RAIZ, 'scripts'))]
      .map((caminho) => relative(RAIZ, caminho).split('\\').join('/'))
      .filter((caminho) => !PERMITIDOS.has(caminho))
      .filter((caminho) => PROIBIDO.test(readFileSync(join(RAIZ, caminho), 'utf8')))
    expect(ofensores).toEqual([])
  })

  it('a varredura enxerga o que procura', () => {
    // Sem isto, um regex quebrado deixaria o teste de cima verde para sempre.
    expect(PROIBIDO.test("process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'")).toBe(true)
    expect(PROIBIDO.test('tls.connect({ rejectUnauthorized : false })')).toBe(true)
    expect(PROIBIDO.test('tls.connect({ rejectUnauthorized: true })')).toBe(false)
    expect(fontes(join(RAIZ, 'src')).some((caminho) => caminho.endsWith('ambiente.ts'))).toBe(true)
  })
})
