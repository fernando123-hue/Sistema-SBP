import { describe, expect, it } from 'vitest'

import { CATEGORIAS_CADASTRO } from './config'
import { CategoriaCodigoSchema } from './esquemas'

/**
 * As categorias semeadas e o enum que valida as entradas são a MESMA lista.
 *
 * Achado 19 da auditoria de 08/09/2026. O tipo de `DefinicaoCategoria` já impede
 * semear um código que o esquema recusa. Este teste fecha a outra direção: um
 * código acrescentado ao esquema sem definição de semente — a IA pode
 * classificar nele, e a ingestão aborta com `CategoriaDesconhecidaError` porque
 * a linha nunca foi criada.
 */
describe('categorias semeadas × CategoriaCodigoSchema', () => {
  it('toda categoria semeada tem código aceito, e todo código aceito é semeado', () => {
    const semeados = CATEGORIAS_CADASTRO.map((categoria) => categoria.codigo).sort()
    expect(semeados).toEqual([...CategoriaCodigoSchema.options].sort())
  })
})
