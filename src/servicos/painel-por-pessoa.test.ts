import { beforeEach, describe, expect, it } from 'vitest'

import { obterPrisma } from '../servidor/prisma'
import { atorDeTeste, limparTudo } from '../testes/apoio'
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

    // Como operadora: é ela que vê a equipe inteira (`A24`). O recorte do
    // colaborador tem teste próprio em `quem-ve-o-que.test.ts`.
    const auditoria = atorDeTeste('operadora-de-teste', 'operador')
    const linha = (await porPessoa(banco, auditoria, MARCO)).find(
      (l) => l.colaboradorId === pessoa.id,
    )
    expect(linha?.creditoGlobal).toBe(3)
  })

  // N-06 da auditoria: a coluna Concluídos contava desde sempre, qualquer que
  // fosse o período escolhido — e a comparação lado a lado com a planilha, que
  // é mês a mês, saía errada por pessoa.
  it('conta como concluído só o que foi concluído dentro do período', async () => {
    const pessoa = await banco.colaborador.create({
      data: { nome: 'Colaborador B', email: 'pessoa.b@teste.local', papel: 'colaborador' },
    })
    const categoria = await banco.categoria.create({
      data: { codigo: 'PERIODO_TESTE', rotulo: 'Sintética', frente: 'CADASTRO', grupo: 'teste' },
    })

    // Uma em fevereiro, duas em março (uma no primeiro e outra no último dia,
    // para provar as duas bordas), uma em abril.
    for (const concluidoEm of [
      '2026-02-20T12:00:00-03:00',
      '2026-03-01T00:30:00-03:00',
      '2026-03-31T23:30:00-03:00',
      '2026-04-01T00:30:00-03:00',
    ]) {
      await concluidoPor(pessoa.id, categoria.id, concluidoEm)
    }

    const linha = (await porPessoa(banco, atorDeTeste(pessoa.id, 'colaborador'), MARCO))[0]
    expect(linha?.concluidos).toBe(2)
  })

  // Revisão do PR #104: "Por categoria" conta a conclusão de quem foi
  // desativado depois; "Por pessoa" filtrava `ativo: true` e a pessoa sumia.
  // As duas tabelas do mesmo período passavam a não fechar.
  it('quem concluiu no período e foi desativado depois continua na equipe', async () => {
    const saiu = await banco.colaborador.create({
      data: { nome: 'Colaborador C', email: 'pessoa.c@teste.local', papel: 'colaborador', ativo: false },
    })
    const saiuAntes = await banco.colaborador.create({
      data: { nome: 'Colaborador D', email: 'pessoa.d@teste.local', papel: 'colaborador', ativo: false },
    })
    const categoria = await banco.categoria.create({
      data: { codigo: 'PERIODO_TESTE', rotulo: 'Sintética', frente: 'CADASTRO', grupo: 'teste' },
    })
    await concluidoPor(saiu.id, categoria.id, '2026-03-10T12:00:00-03:00')
    await concluidoPor(saiuAntes.id, categoria.id, '2026-02-10T12:00:00-03:00')

    const linhas = await porPessoa(banco, atorDeTeste('operadora-de-teste', 'operador'), MARCO)

    expect(linhas.find((l) => l.colaboradorId === saiu.id)?.concluidos).toBe(1)
    // Desativado sem nada no período não volta à tabela.
    expect(linhas.some((l) => l.colaboradorId === saiuAntes.id)).toBe(false)
  })

  // Revisão do PR #104: a tela adivinhava "sou colaborador" por "veio uma
  // linha só" — e um gestor com equipe de uma pessoa caía no mesmo caso. Quem
  // sabe o papel é o servidor, então é ele que decide quais linhas saem.
  it('a linha zerada sai para o próprio colaborador, e não para quem coordena', async () => {
    const parada = await banco.colaborador.create({
      data: { nome: 'Colaborador E', email: 'pessoa.e@teste.local', papel: 'colaborador' },
    })

    const paraElaMesma = await porPessoa(banco, atorDeTeste(parada.id, 'colaborador'), MARCO)
    const paraAOperadora = await porPessoa(banco, atorDeTeste('operadora-de-teste', 'operador'), MARCO)

    expect(paraElaMesma.map((l) => l.colaboradorId)).toEqual([parada.id])
    expect(paraAOperadora.some((l) => l.colaboradorId === parada.id)).toBe(false)
  })
})

const MARCO = { de: '2026-03-01', ate: '2026-03-31' }

async function concluidoPor(colaboradorId: string, categoriaId: string, concluidoEm: string) {
  const item = await banco.item.create({
    data: { categoriaId, titulo: 'Item sintético', payload: '{}', status: 'concluido', confianca: 1 },
  })
  await banco.execucao.create({
    data: { itemId: item.id, colaboradorId, concluidoEm: new Date(concluidoEm), resultado: 'concluido' },
  })
}
