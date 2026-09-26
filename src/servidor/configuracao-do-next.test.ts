import { describe, expect, it } from 'vitest'

import configuracao from '../../next.config'

/**
 * `next dev` não escreve nas regras dos agentes.
 *
 * Desde o Next 16.3, `next dev` que detecta um agente de IA no ambiente anexa
 * um bloco próprio ao `CLAUDE.md` (e cria um `AGENTS.md`) — e o texto do bloco
 * sugere commitá-lo "para manter a árvore limpa". Visto em 25/09/2026, na
 * primeira vez que uma sessão subiu o servidor para conferir uma tela. O
 * `CLAUDE.md` é a regra que governa quem escreve código aqui: muda por decisão
 * do dono, num PR que diz isso, nunca como efeito colateral de subir a tela.
 */
describe('configuração do Next', () => {
  it('não gera nem altera CLAUDE.md / AGENTS.md ao subir o servidor', () => {
    expect(configuracao.agentRules).toBe(false)
  })
})
