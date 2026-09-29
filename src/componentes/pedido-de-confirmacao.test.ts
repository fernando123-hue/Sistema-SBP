import { describe, expect, it } from 'vitest'

import { pedidoDeConfirmacao } from './pedido-de-confirmacao'

describe('pedidoDeConfirmacao (pendência 5)', () => {
  it('diz qual item pela posição, no formato do leitor de tela', () => {
    expect(pedidoDeConfirmacao('concluir', 7, 48)).toBe(
      'Para concluir o item 8 de 48, aperte o mesmo botão de novo. Concluir não tem volta.',
    )
  })

  // Frase igual não é repetida pelo leitor de tela: armar o segundo item
  // ficava em silêncio.
  it('itens diferentes geram frases diferentes', () => {
    expect(pedidoDeConfirmacao('concluir', 0, 48)).not.toBe(pedidoDeConfirmacao('concluir', 1, 48))
  })

  it('descartar fala de descartar', () => {
    expect(pedidoDeConfirmacao('descartar', 0, 3)).toBe(
      'Para descartar o item 1 de 3, aperte o mesmo botão de novo. Descartar não tem volta.',
    )
  })

  it('item fora da lista não inventa posição', () => {
    expect(pedidoDeConfirmacao('concluir', -1, 5)).toBe(
      'Para concluir o item, aperte o mesmo botão de novo. Concluir não tem volta.',
    )
  })

  // Nenhum texto de fora na voz do sistema (`§ AT-48`): a função nem recebe
  // título. Se alguém acrescentar, este teste precisa mudar — e a decisão também.
  it('não recebe texto que venha do e-mail', () => {
    expect(pedidoDeConfirmacao.length).toBe(3)
  })
})
