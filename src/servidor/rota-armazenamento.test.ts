import { describe, expect, it } from 'vitest'

import { ChaveDosAnexosMudouError, FalhaDeArmazenamento } from '../ports/armazenamento'
import { rota } from './http'

/**
 * O que uma falha de armazenamento conta a quem está do outro lado da rota.
 *
 * Revisão do PR #35: `FalhaDeArmazenamento` usava a `mensagemPublica` padrão —
 * a própria `message`, com o `erro.message` do sistema de arquivos dentro, e
 * nele o caminho absoluto do servidor. Latente hoje (nenhuma rota serve
 * anexo), real no dia da rota de download.
 */

const lancar = (erro: unknown) => rota(async () => Promise.reject(erro))

describe('rota(): falha de armazenamento', () => {
  it('falha de disco responde 503 sem o caminho do servidor', async () => {
    const caminho = String.raw`C:\srv\sbp\armazenamento\ab\ab12cd34.pdf`
    const resposta = await lancar(
      new FalhaDeArmazenamento('ler', `ENOENT: no such file or directory, open '${caminho}'`),
    )
    const corpo = await resposta.json()

    expect(resposta.status).toBe(503)
    expect(JSON.stringify(corpo)).not.toContain('armazenamento\\ab')
    expect(JSON.stringify(corpo)).not.toContain('ENOENT')
    expect(corpo.erro).toMatch(/log do servidor/)
  })

  it('chave dos anexos trocada responde 503 COM o que fazer — é a mensagem que precisa ser lida', async () => {
    const resposta = await lancar(new ChaveDosAnexosMudouError())
    const corpo = await resposta.json()

    expect(resposta.status).toBe(503)
    expect(corpo.erro).toMatch(/ANEXOS_SECRET/)
    expect(corpo.erro).toMatch(/Nada foi lido nem gravado/)
  })
})
