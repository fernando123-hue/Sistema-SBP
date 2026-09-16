import { describe, expect, it } from 'vitest'

import {
  compararComOVisto,
  lerChaveDoAviso,
  montarAvisoDoGestor,
  quemMexeuPorUltimo,
  type AusenciaParaAviso,
} from './aviso-do-gestor'

/**
 * Hoje é sexta, 11/09/2026, prazo de 7 dias. Nomes fictícios.
 *
 * Cada caso fixa a véspera e o dia, porque o aviso que erra por um dia manda a
 * gestora procurar alguém que ainda não voltou — ou esconde um motivo que sai
 * amanhã.
 */
const HOJE = '2026-09-11'

function ausencia(parcial: Partial<AusenciaParaAviso> & Pick<AusenciaParaAviso, 'nome'>): AusenciaParaAviso {
  return {
    id: `id-${parcial.nome}`,
    tipo: 'atestado',
    inicio: '2026-09-01',
    fim: null,
    canceladoNoDia: null,
    temObservacao: true,
    motivoJaSaiu: false,
    ...parcial,
  }
}

function aviso(ausencias: AusenciaParaAviso[], limpeza: 'concluida' | 'falhou' | 'pendente' = 'concluida') {
  return montarAvisoDoGestor({ hoje: HOJE, prazoEmDias: 7, ausencias, limpeza })
}

describe('quem está fora hoje', () => {
  it('inclui quem começa hoje e quem termina hoje; exclui quem terminou ontem e quem começa amanhã', () => {
    const resultado = aviso([
      ausencia({ nome: 'Ana', inicio: HOJE, fim: '2026-09-15' }),
      ausencia({ nome: 'Bia', inicio: '2026-09-07', fim: HOJE }),
      ausencia({ nome: 'Caio', inicio: '2026-09-07', fim: '2026-09-10' }),
      ausencia({ nome: 'Duda', inicio: '2026-09-12', fim: '2026-09-20' }),
    ])

    expect(resultado.foraHoje.map((linha) => linha.nome)).toEqual(['Ana', 'Bia'])
  })

  it('diz o motivo e o dia da volta; sem data de volta, volta é nula', () => {
    const resultado = aviso([
      ausencia({ nome: 'Eva', tipo: 'licenca', inicio: '2026-08-01', fim: null }),
      ausencia({ nome: 'Fábio', tipo: 'ferias', inicio: '2026-09-08', fim: '2026-09-18' }),
    ])

    expect(resultado.foraHoje).toEqual([
      { nome: 'Eva', tipo: 'licenca', volta: null },
      { nome: 'Fábio', tipo: 'ferias', volta: '2026-09-19' },
    ])
  })

  it('ausência cancelada não está fora', () => {
    const resultado = aviso([ausencia({ nome: 'Gil', inicio: HOJE, fim: HOJE, canceladoNoDia: '2026-09-10' })])

    expect(resultado.foraHoje).toEqual([])
    expect(resultado.voltam).toEqual([])
  })
})

describe('quem volta', () => {
  it('fim ontem volta hoje; fim hoje volta amanhã; fim amanhã ainda não aparece', () => {
    const resultado = aviso([
      ausencia({ nome: 'Hugo', fim: '2026-09-10' }),
      ausencia({ nome: 'Íris', fim: HOJE }),
      ausencia({ nome: 'João', fim: '2026-09-12' }),
    ])

    expect(resultado.voltam).toEqual([
      { nome: 'Hugo', quando: 'hoje' },
      { nome: 'Íris', quando: 'amanha' },
    ])
  })
})

describe('motivos que saem nos próximos dias', () => {
  it('olha até 3 dias à frente: sai segunda aparece na sexta; sai terça não', () => {
    const resultado = aviso([
      // Voltou 07/09 → sai 14/09 (segunda).
      ausencia({ nome: 'Lia', fim: '2026-09-06' }),
      // Voltou 08/09 → sai 15/09 (terça).
      ausencia({ nome: 'Max', fim: '2026-09-07' }),
    ])

    expect(resultado.motivosQueSaem).toEqual([
      { nome: 'Lia', tipo: 'atestado', dia: '2026-09-14', atrasado: false, cancelada: false },
    ])
  })

  it('motivo que já devia ter saído e continua guardado aparece como atrasado', () => {
    // Voltou 01/09 → devia ter saído 08/09.
    const resultado = aviso([ausencia({ nome: 'Nina', fim: '2026-08-31' })], 'falhou')

    expect(resultado.motivosQueSaem).toEqual([
      { nome: 'Nina', tipo: 'atestado', dia: '2026-09-08', atrasado: true, cancelada: false },
    ])
  })

  it('o que a limpeza já apagou não aparece', () => {
    const resultado = aviso([ausencia({ nome: 'Otto', tipo: 'ausente', fim: '2026-08-31', motivoJaSaiu: true })])

    expect(resultado.motivosQueSaem).toEqual([])
  })

  it('férias sem observação não têm motivo a perder; com observação, têm', () => {
    const resultado = aviso([
      ausencia({ nome: 'Paulo', tipo: 'ferias', fim: '2026-09-06', temObservacao: false }),
      ausencia({ nome: 'Rita', tipo: 'ferias', fim: '2026-09-06', temObservacao: true }),
    ])

    expect(resultado.motivosQueSaem.map((linha) => linha.nome)).toEqual(['Rita'])
  })

  it('cancelada conta do cancelamento, e vem marcada como cancelada', () => {
    // O dono confirmou a regra em 12/09/2026 e pediu destaque: sem a marca, a
    // linha leria como um atestado que aconteceu.
    const resultado = aviso([
      ausencia({ nome: 'Sara', inicio: '2026-12-01', fim: '2026-12-20', canceladoNoDia: '2026-09-06' }),
    ])

    expect(resultado.motivosQueSaem).toEqual([
      { nome: 'Sara', tipo: 'atestado', dia: '2026-09-13', atrasado: false, cancelada: true },
    ])
  })

  it('sem data de volta, não sai', () => {
    expect(aviso([ausencia({ nome: 'Téo', fim: null })]).motivosQueSaem).toEqual([])
  })
})

describe('quando não há o que dizer', () => {
  it('sem ausência e com a limpeza em dia, o aviso é vazio', () => {
    expect(aviso([]).vazio).toBe(true)
  })

  it('limpeza que falhou nunca é aviso vazio', () => {
    const resultado = aviso([], 'falhou')

    expect(resultado.vazio).toBe(false)
    expect(resultado.limpeza).toBe('falhou')
  })
})

describe('as chaves do que a gestora viu', () => {
  it('uma chave por linha, com o id do afastamento — nunca o nome', () => {
    const resultado = aviso(
      [
        // Fora hoje e volta amanhã.
        ausencia({ nome: 'Ana', id: 'a1', inicio: HOJE, fim: HOJE }),
        // Motivo sai em 14/09.
        ausencia({ nome: 'Lia', id: 'a2', fim: '2026-09-06' }),
      ],
      'falhou',
    )

    expect(resultado.chaves).toEqual(['fora:a1', 'volta:a1', 'sai:a2', 'limpeza:falhou'])
    expect(resultado.chaves.join()).not.toContain('Ana')
  })

  it('quem mexeu por último: cancelar vem depois de encerrar, que vem depois de registrar', () => {
    expect(quemMexeuPorUltimo({ registradoPor: 'ana', encerradoPor: null, canceladoPor: null })).toBe('ana')
    expect(quemMexeuPorUltimo({ registradoPor: 'ana', encerradoPor: 'bia', canceladoPor: null })).toBe('bia')
    expect(quemMexeuPorUltimo({ registradoPor: 'ana', encerradoPor: 'bia', canceladoPor: 'caio' })).toBe('caio')
  })

  it('chave fora do formato não é lida', () => {
    expect(lerChaveDoAviso('fora:a1')).toEqual({ lista: 'fora', afastamentoId: 'a1' })
    expect(lerChaveDoAviso('limpeza:falhou')).toEqual({ lista: 'limpeza', afastamentoId: null })
    expect(lerChaveDoAviso('outra:a1')).toBeNull()
    expect(lerChaveDoAviso('fora:a1:extra')).toBeNull()
    expect(lerChaveDoAviso('fora:')).toBeNull()
  })
})

describe('o que mudou desde a última olhada', () => {
  // O dono pediu (12/09/2026) que a troca de uma pessoa por outra no mesmo dia
  // não passe calada. É o caso que uma contagem não enxerga.
  const nomes = new Map([
    ['a1', 'Bianca'],
    ['a2', 'Elias'],
  ])
  /** Nos casos abaixo, quem mexeu foi sempre outra pessoa. */
  const autores = new Map([
    ['a1', 'outra-gestora'],
    ['a2', 'outra-gestora'],
  ])

  it('mudança feita por quem está olhando não conta como novidade — a de outra pessoa, sim', () => {
    // Fabiana registrou a ausência do Elias; Ana cancelou a da Bianca.
    const resultado = compararComOVisto({
      hoje: HOJE,
      chaves: ['fora:a2'],
      visto: { data: HOJE, chaves: ['fora:a1'] },
      nomePorAfastamento: nomes,
      quemOlha: 'fabiana',
      autorPorAfastamento: new Map([
        ['a1', 'ana'],
        ['a2', 'fabiana'],
      ]),
    })

    expect(resultado.novidades).toEqual({ entraram: [], sairam: [{ lista: 'fora', nome: 'Bianca' }] })
  })

  it('a limpeza que falhou é novidade para todo mundo — não tem autor', () => {
    const resultado = compararComOVisto({
      hoje: HOJE,
      chaves: ['limpeza:falhou'],
      visto: { data: HOJE, chaves: [] },
      nomePorAfastamento: nomes,
      quemOlha: 'fabiana',
      autorPorAfastamento: new Map(),
    })

    expect(resultado.novidades.entraram).toEqual([{ lista: 'limpeza', nome: '' }])
  })

  it('sem nada visto hoje, é a primeira vez do dia — e não lista novidade', () => {
    for (const visto of [null, { data: '2026-09-10', chaves: ['fora:a1'] }]) {
      expect(compararComOVisto({ hoje: HOJE, chaves: ['fora:a2'], visto, nomePorAfastamento: nomes, quemOlha: 'quem-olha', autorPorAfastamento: autores })).toEqual({
        primeiraVezHoje: true,
        novidades: { entraram: [], sairam: [] },
      })
    }
  })

  it('troca no mesmo dia: Bianca saiu e Elias entrou, os dois com nome', () => {
    expect(
      compararComOVisto({
        hoje: HOJE,
        chaves: ['fora:a2'],
        visto: { data: HOJE, chaves: ['fora:a1'] },
        nomePorAfastamento: nomes, quemOlha: 'quem-olha', autorPorAfastamento: autores,
      }),
    ).toEqual({
      primeiraVezHoje: false,
      novidades: { entraram: [{ lista: 'fora', nome: 'Elias' }], sairam: [{ lista: 'fora', nome: 'Bianca' }] },
    })
  })

  it('nada mudou, nada a dizer', () => {
    const resultado = compararComOVisto({
      hoje: HOJE,
      chaves: ['fora:a1', 'sai:a2'],
      visto: { data: HOJE, chaves: ['sai:a2', 'fora:a1'] },
      nomePorAfastamento: nomes, quemOlha: 'quem-olha', autorPorAfastamento: autores,
    })

    expect(resultado.novidades).toEqual({ entraram: [], sairam: [] })
  })

  it('a mesma pessoa mudando de lista sai de uma e entra na outra', () => {
    const resultado = compararComOVisto({
      hoje: HOJE,
      chaves: ['volta:a1'],
      visto: { data: HOJE, chaves: ['fora:a1'] },
      nomePorAfastamento: nomes, quemOlha: 'quem-olha', autorPorAfastamento: autores,
    })

    expect(resultado.novidades).toEqual({
      entraram: [{ lista: 'volta', nome: 'Bianca' }],
      sairam: [{ lista: 'fora', nome: 'Bianca' }],
    })
  })

  it('a limpeza que falhou entra como novidade, sem nome de pessoa', () => {
    const resultado = compararComOVisto({
      hoje: HOJE,
      chaves: ['limpeza:falhou'],
      visto: { data: HOJE, chaves: [] },
      nomePorAfastamento: nomes, quemOlha: 'quem-olha', autorPorAfastamento: autores,
    })

    expect(resultado.novidades.entraram).toEqual([{ lista: 'limpeza', nome: '' }])
  })
})
