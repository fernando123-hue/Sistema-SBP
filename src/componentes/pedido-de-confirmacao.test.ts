import { describe, expect, it } from 'vitest'

import { pedidoDeConfirmacao, pedidoDeConfirmacaoDoEmail, pedidoDeConfirmacaoDoGrupo } from './pedido-de-confirmacao'

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

describe('pedidoDeConfirmacaoDoGrupo (`A69`, 3A)', () => {
  it('diz quantos itens o segundo toque conclui, e qual grupo', () => {
    expect(pedidoDeConfirmacaoDoGrupo(1, 4, 34)).toBe(
      'Para concluir os 34 itens do e-mail 2 de 4, aperte o mesmo botão de novo. Concluir não tem volta.',
    )
  })

  // Dois e-mails de 34 ligantes dariam a mesma frase sem a posição, e o
  // leitor de tela não repetiria o aviso ao armar o segundo.
  it('grupos do mesmo tamanho geram frases diferentes', () => {
    expect(pedidoDeConfirmacaoDoGrupo(0, 2, 34)).not.toBe(pedidoDeConfirmacaoDoGrupo(1, 2, 34))
  })

  it('grupo fora da lista não inventa posição', () => {
    expect(pedidoDeConfirmacaoDoGrupo(-1, 2, 3)).toBe(
      'Para concluir os 3 itens deste e-mail, aperte o mesmo botão de novo. Concluir não tem volta.',
    )
  })

  it('não recebe texto que venha do e-mail', () => {
    expect(pedidoDeConfirmacaoDoGrupo.length).toBe(3)
  })
})

describe('pedidoDeConfirmacaoDoEmail (`A69`, 1A)', () => {
  it('aprovar todos diz quantos e qual e-mail', () => {
    expect(pedidoDeConfirmacaoDoEmail('aprovar', 0, 2, 3, 0)).toBe(
      'Para aprovar os 3 itens do e-mail 1 de 2, aperte o mesmo botão de novo.',
    )
  })

  // Tirar da lista é descartar, e descartar não tem volta: o aviso diz.
  it('aprovar com itens tirados avisa que eles serão descartados', () => {
    expect(pedidoDeConfirmacaoDoEmail('aprovar', 1, 2, 2, 1)).toBe(
      'Para aprovar 2 e descartar 1 do e-mail 2 de 2, aperte o mesmo botão de novo. Descartar não tem volta.',
    )
  })

  it('descartar o e-mail inteiro', () => {
    expect(pedidoDeConfirmacaoDoEmail('descartar', -1, 2, 0, 3)).toBe(
      'Para descartar os 3 itens deste e-mail, aperte o mesmo botão de novo. Descartar não tem volta.',
    )
  })

  it('não recebe texto que venha do e-mail', () => {
    expect(pedidoDeConfirmacaoDoEmail.length).toBe(5)
  })
})
