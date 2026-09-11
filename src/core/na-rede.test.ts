import { describe, expect, expectTypeOf, it } from 'vitest'

import type { NaRede } from './tipos'

/**
 * `NaRede<T>` — o que a serialização JSON faz com o tipo que o serviço devolve.
 *
 * Achado 16 da auditoria de 08/09/2026: não havia `expectTypeOf` no repositório,
 * então a regra que as telas usam para não receber `Date` onde chega `string`
 * não tinha prova nenhuma. As asserções de tipo são conferidas pelo `tsc` em
 * `npm run verificar`; a de runtime prova que a regra descreve o JSON de verdade.
 *
 * DTO sintético de propósito: o núcleo não importa forma de serviço.
 */
interface DtoDeTeste {
  titulo: string
  quantidade: number
  recebidoEm: Date
  concluidoEm: Date | null
  etiquetas: string[]
  eventos: { em: Date; rotulo: string }[]
  responsavel: { nome: string; desde: Date } | null
}

describe('NaRede<T>', () => {
  it('troca Date por string em todo nível, preservando nulo e o resto', () => {
    expectTypeOf<NaRede<DtoDeTeste>['titulo']>().toEqualTypeOf<string>()
    expectTypeOf<NaRede<DtoDeTeste>['quantidade']>().toEqualTypeOf<number>()
    expectTypeOf<NaRede<DtoDeTeste>['recebidoEm']>().toEqualTypeOf<string>()
    expectTypeOf<NaRede<DtoDeTeste>['concluidoEm']>().toEqualTypeOf<string | null>()
    expectTypeOf<NaRede<DtoDeTeste>['etiquetas']>().toEqualTypeOf<string[]>()
    expectTypeOf<NaRede<DtoDeTeste>['eventos']>().toEqualTypeOf<{ em: string; rotulo: string }[]>()
    expectTypeOf<NaRede<DtoDeTeste>['responsavel']>().toEqualTypeOf<{
      nome: string
      desde: string
    } | null>()
  })

  it('descreve o que JSON.stringify de fato entrega', () => {
    const dto: DtoDeTeste = {
      titulo: 'Atualização cadastral',
      quantidade: 2,
      recebidoEm: new Date('2026-09-07T12:00:00.000Z'),
      concluidoEm: null,
      etiquetas: ['ficha'],
      eventos: [{ em: new Date('2026-09-08T09:30:00.000Z'), rotulo: 'distribuido' }],
      responsavel: { nome: 'Colaborador A', desde: new Date('2026-09-01T00:00:00.000Z') },
    }

    const naRede = JSON.parse(JSON.stringify(dto)) as NaRede<DtoDeTeste>

    expect(naRede).toEqual({
      titulo: 'Atualização cadastral',
      quantidade: 2,
      recebidoEm: '2026-09-07T12:00:00.000Z',
      concluidoEm: null,
      etiquetas: ['ficha'],
      eventos: [{ em: '2026-09-08T09:30:00.000Z', rotulo: 'distribuido' }],
      responsavel: { nome: 'Colaborador A', desde: '2026-09-01T00:00:00.000Z' },
    })
  })
})
