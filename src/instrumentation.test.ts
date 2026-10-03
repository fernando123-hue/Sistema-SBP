import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * O que o servidor liga ao subir (`instrumentation.ts`).
 *
 * O aviso de troca da chave de sessão (`AT-50`) só cobre o caso que o motivou
 * — a variável esquecida e o processo reiniciando sozinho — se `register` o
 * chamar. Sem este teste, apagar a linha devolveria o defeito da 2ª rodada do
 * #146 com a suíte verde (3ª rodada do #146).
 */

const avisarTrocaDaChaveDeSessao = vi.fn(async () => {})
const agendarLimpezaDiaria = vi.fn(async () => {})
const conferirAmbienteNaSubida = vi.fn(async () => {})
const conferirModoSqlNaSubida = vi.fn(async () => {})

vi.mock('./instrumentation-node', () => ({
  avisarTrocaDaChaveDeSessao,
  agendarLimpezaDiaria,
  conferirAmbienteNaSubida,
  conferirModoSqlNaSubida,
}))

const { register } = await import('./instrumentation')

const ANTES = { runtime: process.env.NEXT_RUNTIME, fase: process.env.NEXT_PHASE }

beforeEach(() => {
  avisarTrocaDaChaveDeSessao.mockClear()
  agendarLimpezaDiaria.mockClear()
  conferirAmbienteNaSubida.mockClear()
  conferirModoSqlNaSubida.mockClear()
})

afterEach(() => {
  process.env.NEXT_RUNTIME = ANTES.runtime ?? ''
  process.env.NEXT_PHASE = ANTES.fase ?? ''
})

describe('register', () => {
  it('no runtime Node, avisa a troca da chave de sessão e agenda a limpeza', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.NEXT_PHASE = ''
    await register()
    expect(conferirAmbienteNaSubida).toHaveBeenCalledTimes(1)
    expect(conferirModoSqlNaSubida).toHaveBeenCalledTimes(1)
    expect(avisarTrocaDaChaveDeSessao).toHaveBeenCalledTimes(1)
    expect(agendarLimpezaDiaria).toHaveBeenCalledTimes(1)
    // A conferência vem PRIMEIRO: com a configuração errada, em produção o
    // processo encerra antes de agendar rotina (pendência 49).
    const ordem = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0]!
    expect(ordem(conferirAmbienteNaSubida)).toBeLessThan(ordem(avisarTrocaDaChaveDeSessao))
    expect(ordem(conferirAmbienteNaSubida)).toBeLessThan(ordem(agendarLimpezaDiaria))
    // O modo SQL depois do ambiente (ele usa o banco, que o ambiente configura)
    // e antes de agendar rotina que gravaria no banco sem modo estrito.
    expect(ordem(conferirAmbienteNaSubida)).toBeLessThan(ordem(conferirModoSqlNaSubida))
    expect(ordem(conferirModoSqlNaSubida)).toBeLessThan(ordem(agendarLimpezaDiaria))
  })

  it('durante o build de produção, não liga nada', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.NEXT_PHASE = 'phase-production-build'
    await register()
    // O `next build` pode rodar numa máquina sem a configuração de produção:
    // conferir ali encerraria o build.
    expect(conferirAmbienteNaSubida).not.toHaveBeenCalled()
    expect(conferirModoSqlNaSubida).not.toHaveBeenCalled()
    expect(avisarTrocaDaChaveDeSessao).not.toHaveBeenCalled()
    expect(agendarLimpezaDiaria).not.toHaveBeenCalled()
  })

  it('fora do runtime Node (edge), não liga nada', async () => {
    process.env.NEXT_RUNTIME = 'edge'
    await register()
    expect(conferirAmbienteNaSubida).not.toHaveBeenCalled()
    expect(conferirModoSqlNaSubida).not.toHaveBeenCalled()
    expect(avisarTrocaDaChaveDeSessao).not.toHaveBeenCalled()
    expect(agendarLimpezaDiaria).not.toHaveBeenCalled()
  })
})
