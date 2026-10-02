import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { PERFIL_ANTHROPIC } from './ia-anthropic'
import { INSTRUCOES } from './ia-estruturada'
import { PERFIL_GEMINI } from './ia-gemini'
import { PERFIL_LOCAL } from './ia-local'

/**
 * O prompt da interpretação e a versão que a trilha grava andam juntos.
 *
 * `Item.versaoPrompt` e `Email.versaoPrompt` dizem, para sempre, com qual
 * prompt cada item foi lido. Se o texto mudar e a versão não, a trilha passa a
 * atribuir a um prompt o que foi feito por outro — e ninguém descobre, porque
 * a suíte continua verde.
 *
 * O risco ficou maior na fase 3 do Jev (`A62`): as descrições das categorias,
 * que fazem parte deste texto, saíram de `ia-estruturada.ts` e passaram a
 * morar em `core/config.ts` (revisão técnica do #143). Quem editar uma delas
 * mexe no prompt sem abrir este arquivo.
 *
 * ═══ QUANDO ESTE TESTE FICAR VERMELHO ═══
 *
 * O prompt mudou. Suba a `versaoPrompt` de CADA perfil abaixo (todos usam o
 * mesmo `INSTRUCOES`) e troque o hash e as versões aqui, no mesmo commit.
 */
const HASH_DO_PROMPT = '30ea914c85f3c67ad3485d6e175bc420e60649e835b83aee46a4812ce8b0ad9c'
const VERSOES_DESTE_PROMPT = {
  anthropic: 'anthropic-1.2.0',
  gemini: 'gemini-1.2.0',
  local: 'local-1.1.0',
}

describe('versão do prompt da interpretação', () => {
  it('o texto é o desta versão — mudou o texto, sobe a versão de cada perfil', () => {
    const hash = createHash('sha256').update(INSTRUCOES, 'utf8').digest('hex')
    expect(hash, 'o prompt mudou: suba a versaoPrompt de cada perfil e atualize este teste').toBe(HASH_DO_PROMPT)
    expect({
      anthropic: PERFIL_ANTHROPIC.versaoPrompt,
      gemini: PERFIL_GEMINI.versaoPrompt,
      local: PERFIL_LOCAL.versaoPrompt,
    }).toEqual(VERSOES_DESTE_PROMPT)
  })
})
