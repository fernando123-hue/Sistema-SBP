import { describe, expect, it } from 'vitest'

import { pedidoDeConfirmacao } from './pedido-de-confirmacao'

describe('pedidoDeConfirmacao (pendência 5)', () => {
  it('diz qual item, pela posição e pelo título', () => {
    expect(pedidoDeConfirmacao('concluir', 'Ficha de atualização cadastral', 2)).toBe(
      'Para concluir o 3º item, «Ficha de atualização cadastral», aperte o mesmo botão de novo. Concluir não tem volta.',
    )
  })

  // O caso que o título sozinho não resolvia: frase igual não é repetida pelo
  // leitor de tela, e armar o segundo item ficava em silêncio.
  it('dois itens de mesmo título geram frases diferentes', () => {
    const titulo = 'Ficha de atualização cadastral'

    expect(pedidoDeConfirmacao('concluir', titulo, 0)).not.toBe(pedidoDeConfirmacao('concluir', titulo, 1))
  })

  it('descartar fala de descartar', () => {
    expect(pedidoDeConfirmacao('descartar', 'Pedido', 0)).toBe(
      'Para descartar o 1º item, «Pedido», aperte o mesmo botão de novo. Descartar não tem volta.',
    )
  })

  it('item fora da lista não inventa posição', () => {
    expect(pedidoDeConfirmacao('concluir', undefined, -1)).toBe(
      'Para concluir o item, aperte o mesmo botão de novo. Concluir não tem volta.',
    )
  })
})
