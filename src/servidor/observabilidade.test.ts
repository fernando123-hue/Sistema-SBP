import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Para onde vai cada linha de log.
 *
 * No servidor, `info` e `aviso` vão ao stdout e `erro` ao stderr — é o que o
 * coletor de logs espera. Mas um script que promete UMA linha de JSON no
 * stdout (`npm run ia:avaliar -- --json`) não pode ter linha de log misturada
 * nela: quem guarda a saída passa a guardar lixo, e quem a lê com `JSON.parse`
 * quebra. Achado na máquina da IA local em 25/09/2026.
 *
 * O estado é de processo; cada caso importa um módulo novo.
 */

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

function espiar() {
  const saida = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const erro = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  return { saida, erro }
}

describe('destino do log', () => {
  it('no padrão, aviso vai ao stdout e erro ao stderr', async () => {
    const { registrarLog } = await import('./observabilidade')
    const { saida, erro } = espiar()

    registrarLog('aviso', 'um aviso')
    registrarLog('erro', 'um erro')

    expect(saida).toHaveBeenCalledTimes(1)
    expect(erro).toHaveBeenCalledTimes(1)
  })

  it('depois de mandarTodoLogAoStderr, nenhum nível escreve no stdout', async () => {
    const { registrarLog, mandarTodoLogAoStderr } = await import('./observabilidade')
    const { saida, erro } = espiar()

    mandarTodoLogAoStderr()
    registrarLog('info', 'uma informação')
    registrarLog('aviso', 'um aviso')
    registrarLog('erro', 'um erro')

    expect(saida).not.toHaveBeenCalled()
    expect(erro).toHaveBeenCalledTimes(3)
  })
})
