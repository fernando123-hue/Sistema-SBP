import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ROTULO_DA_TELA, TELAS } from '../core/telas'

/**
 * O rótulo de cada tela mora só em `core/telas.ts` (pendência 7).
 *
 * Eram três cópias à mão; o N-31 juntou duas e a do assistente ficou para trás
 * (revisão do #108). Renomear uma tela deixaria o "Ir para …" do assistente com
 * o nome velho — calado, porque nenhuma cópia sabe da outra.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

const fontes = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter(
  (nome) => /\.tsx?$/.test(nome) && !nome.endsWith('.test.ts') && !nome.startsWith('generated'),
)

describe('rótulos das telas: fonte única', () => {
  it('a varredura enxerga o código', () => {
    expect(fontes.length).toBeGreaterThan(50)
  })

  it.each(TELAS)('só core/telas.ts associa %s ao seu rótulo', (tela) => {
    const rotulo = ROTULO_DA_TELA[tela]
    const par = new RegExp(`['"]${tela}['"]\\s*:\\s*['"]${rotulo}['"]`)
    const donos = fontes.filter((nome) => par.test(readFileSync(join(SRC, nome), 'utf8')))

    expect(donos).toEqual([join('core', 'telas.ts')])
  })
})
