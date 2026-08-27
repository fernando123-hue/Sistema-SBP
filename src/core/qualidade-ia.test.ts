import { describe, expect, it } from 'vitest'

import {
  calcularTaxaDeAcerto,
  compararRevisao,
  type DecisaoHumana,
  type ParDeRevisao,
  type SugestaoDaIa,
} from './qualidade-ia'

/**
 * Testes da medida de acerto da IA.
 *
 * Puro: nenhum banco, nenhuma rede. O que se verifica é o CRITÉRIO — o que
 * conta como acerto, o que conta como correção, e o que acontece quando não há
 * dado nenhum. Errar aqui produziria um número plausível e falso, que é pior
 * do que não ter número: alguém afrouxaria o limiar de confiança com base nele.
 */

function sugestao(parcial: Partial<SugestaoDaIa> = {}): SugestaoDaIa {
  return {
    categoriaCodigo: 'FICHA_CADASTRO',
    titulo: 'Envio de ficha',
    confianca: 0.9,
    campos: { nome: 'Fulano Sintético' },
    ...parcial,
  }
}

function decisao(parcial: Partial<DecisaoHumana> = {}): DecisaoHumana {
  return {
    categoriaCodigo: 'FICHA_CADASTRO',
    titulo: 'Envio de ficha',
    campos: { nome: 'Fulano Sintético' },
    aprovado: true,
    itensExtras: 0,
    ...parcial,
  }
}

function par(s: Partial<SugestaoDaIa> = {}, d: Partial<DecisaoHumana> = {}): ParDeRevisao {
  return { sugestao: sugestao(s), decisao: decisao(d) }
}

describe('o que conta como aceita sem correção', () => {
  it('humano confirmou tudo igual', () => {
    expect(compararRevisao(par()).desfecho).toBe('aceita_sem_correcao')
  })

  it('aprovação em massa conta como aceita — não houve edição nenhuma', () => {
    // A aprovação em massa grava só `aprovado`. Tratar os nulos como "mudou"
    // faria toda aprovação rotineira virar erro da IA, e a taxa despencaria
    // exatamente quando o modelo está acertando o suficiente para dispensar
    // conferência item a item.
    const resultado = compararRevisao(
      par({}, { categoriaCodigo: null, titulo: null, campos: null }),
    )

    expect(resultado.desfecho).toBe('aceita_sem_correcao')
    expect(resultado.correcoes.categoriaTrocada).toBe(false)
    expect(resultado.correcoes.camposCorrigidos).toBe(false)
  })

  it('espaço em branco não é correção', () => {
    expect(compararRevisao(par({}, { titulo: '  Envio de ficha  ' })).desfecho).toBe(
      'aceita_sem_correcao',
    )
  })
})

describe('o que conta como correção', () => {
  it('categoria trocada', () => {
    const resultado = compararRevisao(par({}, { categoriaCodigo: 'DOC_CADASTRO' }))
    expect(resultado.desfecho).toBe('categoria_trocada')
    expect(resultado.correcoes.categoriaTrocada).toBe(true)
  })

  it('título reescrito', () => {
    expect(compararRevisao(par({}, { titulo: 'Outro título' })).desfecho).toBe('titulo_editado')
  })

  it('campo editado', () => {
    expect(compararRevisao(par({}, { campos: { nome: 'Outro Nome' } })).desfecho).toBe(
      'campos_corrigidos',
    )
  })

  it('campo que a IA inventou e o humano esvaziou', () => {
    // Apagar um valor extraído é dizer "isto não estava no e-mail". É erro do
    // modelo tanto quanto trocar o valor por outro.
    expect(compararRevisao(par({}, { campos: { nome: '' } })).desfecho).toBe('campos_corrigidos')
  })

  it('campo que o humano acrescentou', () => {
    expect(
      compararRevisao(par({}, { campos: { nome: 'Fulano Sintético', cpf: '000' } })).desfecho,
    ).toBe('campos_corrigidos')
  })

  it('revisão recusada', () => {
    expect(compararRevisao(par({}, { aprovado: false })).desfecho).toBe('recusada')
  })

  it('itens acrescentados — a IA subestimou a carga', () => {
    expect(compararRevisao(par({}, { itensExtras: 3 })).desfecho).toBe('itens_acrescentados')
  })
})

describe('precedência do rótulo', () => {
  it('recusada vence tudo', () => {
    const resultado = compararRevisao(
      par({}, { aprovado: false, categoriaCodigo: 'LIGA', titulo: 'x', itensExtras: 2 }),
    )
    expect(resultado.desfecho).toBe('recusada')
  })

  it('categoria vence título e campo', () => {
    expect(
      compararRevisao(par({}, { categoriaCodigo: 'LIGA', titulo: 'x', campos: { nome: 'y' } }))
        .desfecho,
    ).toBe('categoria_trocada')
  })

  it('item acrescentado vence título — carga pesa mais que texto', () => {
    expect(compararRevisao(par({}, { titulo: 'x', itensExtras: 1 })).desfecho).toBe(
      'itens_acrescentados',
    )
  })

  it('o rótulo é único, mas as correções continuam todas visíveis', () => {
    const resultado = compararRevisao(
      par({}, { categoriaCodigo: 'LIGA', titulo: 'x', campos: { nome: 'y' }, itensExtras: 1 }),
    )

    expect(resultado.desfecho).toBe('categoria_trocada')
    expect(resultado.correcoes).toEqual({
      recusada: false,
      categoriaTrocada: true,
      tituloEditado: true,
      camposCorrigidos: true,
      itensAcrescentados: true,
    })
  })
})

describe('agregação', () => {
  it('sem revisão nenhuma, a taxa é nula — nunca zero', () => {
    const resultado = calcularTaxaDeAcerto([])

    // Zero leria como "a IA errou tudo". É o defeito do painel da planilha,
    // que mostra `0` onde não há dado, reconstruído numa métrica de qualidade.
    expect(resultado.taxaDeAceitacao).toBeNull()
    expect(resultado.confiancaMediaAceita).toBeNull()
    expect(resultado.confiancaMediaCorrigida).toBeNull()
    expect(resultado.revisadas).toBe(0)
  })

  it('a distribuição por desfecho soma o total de revisões', () => {
    const resultado = calcularTaxaDeAcerto([
      par(),
      par(),
      par({}, { categoriaCodigo: 'LIGA' }),
      par({}, { aprovado: false }),
      par({}, { itensExtras: 2 }),
    ])

    const soma = Object.values(resultado.porDesfecho).reduce((total, n) => total + n, 0)
    expect(soma).toBe(resultado.revisadas)
    expect(resultado.aceitasSemCorrecao).toBe(2)
    expect(resultado.taxaDeAceitacao).toBe(0.4)
  })

  it('agrupa pela categoria SUGERIDA, não pela corrigida', () => {
    // A pergunta é onde o modelo erra. Um item que a IA chamou de LIGA e o
    // humano corrigiu para LIGANTE é erro de LIGA — é o limiar de LIGA que
    // eventualmente se ajusta, não o de LIGANTE.
    const resultado = calcularTaxaDeAcerto([
      par({ categoriaCodigo: 'LIGA' }, { categoriaCodigo: 'LIGANTE' }),
      par({ categoriaCodigo: 'LIGA' }, { categoriaCodigo: 'LIGA' }),
    ])

    expect(resultado.porCategoriaSugerida).toHaveLength(1)
    expect(resultado.porCategoriaSugerida[0]).toEqual({
      categoriaCodigo: 'LIGA',
      revisadas: 2,
      aceitasSemCorrecao: 1,
      taxaDeAceitacao: 0.5,
    })
  })

  it('a pior categoria vem primeiro — é onde se mexe', () => {
    const resultado = calcularTaxaDeAcerto([
      par({ categoriaCodigo: 'FICHA_CADASTRO' }, { categoriaCodigo: 'FICHA_CADASTRO' }),
      par({ categoriaCodigo: 'LIGA' }, { categoriaCodigo: 'LIGANTE' }),
      par({ categoriaCodigo: 'LIGA' }, { categoriaCodigo: 'LIGANTE' }),
    ])

    expect(resultado.porCategoriaSugerida.map((linha) => linha.categoriaCodigo)).toEqual([
      'LIGA',
      'FICHA_CADASTRO',
    ])
  })

  it('separa a confiança das aceitas da confiança das corrigidas', () => {
    const resultado = calcularTaxaDeAcerto([
      par({ confianca: 0.95 }),
      par({ confianca: 0.85 }),
      par({ confianca: 0.55 }, { categoriaCodigo: 'LIGA' }),
      par({ confianca: 0.45 }, { aprovado: false }),
    ])

    // É este par de números que autoriza (ou proíbe) mexer no limiar. Se as
    // duas médias forem iguais, a confiança do modelo não separa acerto de
    // erro e o limiar está regulando ruído.
    expect(resultado.confiancaMediaAceita).toBe(0.9)
    expect(resultado.confiancaMediaCorrigida).toBe(0.5)
  })
})
