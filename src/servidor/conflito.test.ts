import { describe, expect, it } from 'vitest'

import { comNovaTentativaEmConflito, ehConflitoDeEscrita, TENTATIVAS_EM_CONFLITO } from './conflito'

const IMPASSE_NO_CLIENTE = Object.assign(new Error('conflito'), { code: 'P2034' })
const IMPASSE_EM_CONSULTA_CRUA = Object.assign(new Error('Deadlock found'), {
  code: 'P2010',
  meta: { driverAdapterError: { cause: { originalCode: '1213', kind: 'TransactionWriteConflict' } } },
})
const OUTRA_CONSULTA_CRUA = Object.assign(new Error('sintaxe'), {
  code: 'P2010',
  meta: { driverAdapterError: { cause: { originalCode: '1064', kind: 'GenericJs' } } },
})

describe('ehConflitoDeEscrita', () => {
  it('reconhece o impasse nas duas formas que o Prisma devolve', () => {
    expect(ehConflitoDeEscrita(IMPASSE_NO_CLIENTE)).toBe(true)
    expect(ehConflitoDeEscrita(IMPASSE_EM_CONSULTA_CRUA)).toBe(true)
  })

  it('não confunde outro erro com impasse', () => {
    expect(ehConflitoDeEscrita(OUTRA_CONSULTA_CRUA)).toBe(false)
    expect(ehConflitoDeEscrita(Object.assign(new Error('único'), { code: 'P2002' }))).toBe(false)
    expect(ehConflitoDeEscrita(new Error('qualquer'))).toBe(false)
    expect(ehConflitoDeEscrita(null)).toBe(false)
  })
})

describe('comNovaTentativaEmConflito', () => {
  it('repete o impasse e devolve o resultado quando passa', async () => {
    let chamadas = 0
    const resultado = await comNovaTentativaEmConflito(async () => {
      chamadas += 1
      if (chamadas < TENTATIVAS_EM_CONFLITO) throw IMPASSE_EM_CONSULTA_CRUA
      return 'ok'
    })
    expect(resultado).toBe('ok')
    expect(chamadas).toBe(TENTATIVAS_EM_CONFLITO)
  })

  it('persistindo, falha alto com o erro do banco', async () => {
    let chamadas = 0
    await expect(
      comNovaTentativaEmConflito(async () => {
        chamadas += 1
        throw IMPASSE_NO_CLIENTE
      }),
    ).rejects.toBe(IMPASSE_NO_CLIENTE)
    expect(chamadas).toBe(TENTATIVAS_EM_CONFLITO)
  })

  it('erro que não é impasse sobe na primeira vez', async () => {
    let chamadas = 0
    await expect(
      comNovaTentativaEmConflito(async () => {
        chamadas += 1
        throw OUTRA_CONSULTA_CRUA
      }),
    ).rejects.toBe(OUTRA_CONSULTA_CRUA)
    expect(chamadas).toBe(1)
  })
})
