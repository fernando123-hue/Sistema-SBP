import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { TELAS } from '../core/telas'

/**
 * O rótulo de cada tela mora só em `core/telas.ts` (pendência 7).
 *
 * Eram três cópias à mão; o N-31 juntou duas e a do assistente ficou para trás
 * (revisão do #108). Renomear uma tela deixaria o "Ir para …" do assistente com
 * o nome velho — calado, porque nenhuma cópia sabe da outra.
 *
 * Casa a CHAVE, não o par caminho → rótulo (revisão técnica do #127): uma cópia
 * nasce justamente com o rótulo divergente (`'/fila': 'Fila'`), e o par só a
 * pegaria se ela ainda estivesse igual. Pega também uma cópia de
 * `PAPEIS_DA_TELA`. Cópia em outro formato (tupla, `case`) passa — limite
 * conhecido.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

const fontes = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter(
  (nome) => /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) && !nome.startsWith('generated'),
)

describe('rótulos das telas: fonte única', () => {
  it('a varredura enxerga o código', () => {
    expect(fontes.length).toBeGreaterThan(50)
  })

  it.each(TELAS)('só core/telas.ts tem mapa indexado por %s', (tela) => {
    // Caminho de tela só tem letras e `/`: nada a escapar na expressão.
    const chave = new RegExp(`['"\`]${tela}['"\`]\\s*:`)
    const donos = fontes.filter((nome) => chave.test(readFileSync(join(SRC, nome), 'utf8')))

    expect(donos).toEqual([join('core', 'telas.ts')])
  })
})
