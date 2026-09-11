import { beforeEach, describe, expect, it } from 'vitest'

import { obterPrisma } from '../servidor/prisma'
import { limparTudo } from '../testes/apoio'
import { porPessoa } from './painel'

/**
 * O crédito global que o painel mostra por pessoa é o do razão CADASTRO.
 *
 * Achado 6 da auditoria de 08/09/2026: `porPessoa` pegava a linha mais recente
 * de `SaldoCargaGlobal` sem filtrar `escopo`. Com CADASTRO e TITULOS no banco,
 * o painel mostraria o crédito do razão que tivesse sido gravado por último.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
  await banco.saldoCargaGlobal.deleteMany()
})

describe('porPessoa', () => {
  it('lê o crédito global mais recente do razão CADASTRO, nunca de outro escopo', async () => {
    const pessoa = await banco.colaborador.create({
      data: { nome: 'Colaborador A', email: 'pessoa.a@teste.local', papel: 'colaborador' },
    })

    await banco.saldoCargaGlobal.createMany({
      data: [
        { colaboradorId: pessoa.id, escopo: 'CADASTRO', data: '2026-09-01', creditoGlobal: 2 },
        // O mais recente do escopo certo: prova que a ordem por data continua valendo.
        { colaboradorId: pessoa.id, escopo: 'CADASTRO', data: '2026-09-03', creditoGlobal: 3 },
        // Mais recente de todos, em outro razão: não pode aparecer.
        { colaboradorId: pessoa.id, escopo: 'TITULOS', data: '2026-09-05', creditoGlobal: 9 },
      ],
    })

    const linha = (await porPessoa(banco)).find((l) => l.colaboradorId === pessoa.id)
    expect(linha?.creditoGlobal).toBe(3)
  })
})
