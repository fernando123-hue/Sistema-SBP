import { beforeEach, describe, expect, it } from 'vitest'

import { hojeIso } from '../core/util/datas'
import { obterPrisma } from '../servidor/prisma'
import { atorDeTeste, limparTudo } from '../testes/apoio'
import { confirmar } from './distribuicao'
import { devolver, transferir } from './fila'
import { conferirConservacao } from './painel'

/**
 * A conferência de conservação não pode disparar na operação normal.
 *
 * ═══ POR QUE ISTO IMPORTA MAIS QUE PARECE ═══
 *
 * O invariante 3 é a razão de o sistema existir: a planilha errava a soma em
 * 29% dos dias e ninguém percebia. `conferirConservacao` é o alarme dessa
 * trava no painel.
 *
 * Um alarme que dispara quando nada está errado não é um alarme conservador —
 * é ruído. Quem opera aprende a ignorá-lo, e no dia da violação de verdade
 * ninguém olha. Um falso positivo aqui é pior que a ausência do indicador,
 * porque dá a impressão de que existe vigilância.
 *
 * Duas operações NORMAIS quebravam a conferência, cada uma numa versão dela:
 * a transferência (contando todas as atribuições) e a devolução (contando só
 * as ativas). Estes testes guardam as duas ao mesmo tempo.
 */

const banco = obterPrisma()

async function semear() {
  const operador = await banco.colaborador.create({
    data: { nome: 'Operadora', email: 'op@teste.local', papel: 'operador' },
  })
  const ana = await banco.colaborador.create({
    data: { nome: 'Ana', email: 'ana@teste.local', papel: 'colaborador' },
  })
  const bruno = await banco.colaborador.create({
    data: { nome: 'Bruno', email: 'bruno@teste.local', papel: 'colaborador' },
  })

  const categoria = await banco.categoria.create({
    data: {
      codigo: 'DOC_CADASTRO',
      rotulo: 'Documento',
      frente: 'CADASTRO',
      grupo: 'ASSOCIADO',
      divisivel: true,
      limiarIndivisivel: 1,
    },
  })

  // A data é HOJE, e não uma constante.
  //
  // Era `'2026-09-07'` fixo. Funcionou até a virada da meia-noite de 08/09/2026,
  // quando os cinco testes deste arquivo ficaram vermelhos de uma vez: os itens
  // nascem com `criadoEm` = agora, e `planejarCategoria` só recolhe item criado
  // ATÉ o fim do dia da rodada (`distribuicao.ts`, filtro por `limite`). Com a
  // data no passado, a rodada não encontra nada, e a conferência vê zero rodada.
  //
  // Um teste que passa hoje e falha amanhã sem ninguém tocar em nada é pior que
  // um teste ausente: ensina a equipe a desconfiar do vermelho.
  const data = hojeIso()
  for (const pessoa of [ana, bruno]) {
    await banco.habilitacao.create({
      data: { colaboradorId: pessoa.id, categoriaId: categoria.id, podeReceber: true },
    })
    await banco.escala.create({ data: { data, colaboradorId: pessoa.id, disponivel: true } })
  }

  for (let i = 0; i < 4; i += 1) {
    await banco.item.create({
      data: { categoriaId: categoria.id, titulo: `Documento ${i}`, status: 'aprovado' },
    })
  }

  return {
    operador: atorDeTeste(operador.id, 'operador'),
    ana,
    bruno,
    data,
  }
}

beforeEach(async () => {
  await limparTudo(banco)
})

describe('conferirConservacao', () => {
  it('não acusa divergência logo depois de distribuir', async () => {
    const base = await semear()
    await confirmar(banco, { data: base.data, categorias: [] }, base.operador)

    const conferencia = await conferirConservacao(banco, { desde: base.data })
    expect(conferencia.rodadas).toBeGreaterThan(0)
    expect(conferencia.divergentes).toEqual([])
  })

  it('NÃO acusa divergência depois de uma devolução ao pool', async () => {
    // O defeito: `devolver` encerra a atribuição e não cria substituta — o item
    // fica sem dono esperando a próxima rodada. Contando só as ATIVAS, a rodada
    // passava a ter menos atribuições que a entrada, para sempre.
    const base = await semear()
    await confirmar(banco, { data: base.data, categorias: [] }, base.operador)

    const atribuicao = await banco.atribuicao.findFirstOrThrow({ where: { ativa: true } })
    const dono = atribuicao.colaboradorId === base.ana.id ? base.ana : base.bruno

    await devolver(
      banco,
      { itemId: atribuicao.itemId, justificativa: 'Não é da minha alçada.' },
      atorDeTeste(dono.id, 'colaborador'),
    )

    const conferencia = await conferirConservacao(banco, { desde: base.data })
    expect(
      conferencia.divergentes,
      'devolver é operação normal e não pode acusar violação de conservação',
    ).toEqual([])
  })

  it('NÃO acusa divergência depois de uma transferência', async () => {
    // O outro lado: a transferência cria uma atribuição nova mantendo a antiga
    // encerrada, para o histórico ficar imutável. Contar todas somava +1.
    const base = await semear()
    await confirmar(banco, { data: base.data, categorias: [] }, base.operador)

    const atribuicao = await banco.atribuicao.findFirstOrThrow({ where: { ativa: true } })
    const dono = atribuicao.colaboradorId === base.ana.id ? base.ana : base.bruno
    const outro = atribuicao.colaboradorId === base.ana.id ? base.bruno : base.ana

    await transferir(
      banco,
      {
        itemId: atribuicao.itemId,
        paraColaboradorId: outro.id,
        justificativa: 'Combinamos a troca.',
      },
      atorDeTeste(dono.id, 'colaborador'),
    )

    const conferencia = await conferirConservacao(banco, { desde: base.data })
    expect(conferencia.divergentes).toEqual([])
  })

  it('devolução E transferência juntas continuam sem acusar', async () => {
    const base = await semear()
    await confirmar(banco, { data: base.data, categorias: [] }, base.operador)

    const ativas = await banco.atribuicao.findMany({ where: { ativa: true } })
    const primeira = ativas[0]!
    const segunda = ativas[1]!

    const donoDaPrimeira = primeira.colaboradorId === base.ana.id ? base.ana : base.bruno
    await devolver(
      banco,
      { itemId: primeira.itemId, justificativa: 'Não é da minha alçada.' },
      atorDeTeste(donoDaPrimeira.id, 'colaborador'),
    )

    const donoDaSegunda = segunda.colaboradorId === base.ana.id ? base.ana : base.bruno
    const outro = segunda.colaboradorId === base.ana.id ? base.bruno : base.ana
    await transferir(
      banco,
      {
        itemId: segunda.itemId,
        paraColaboradorId: outro.id,
        justificativa: 'Combinamos a troca.',
      },
      atorDeTeste(donoDaSegunda.id, 'colaborador'),
    )

    const conferencia = await conferirConservacao(banco, { desde: base.data })
    expect(conferencia.divergentes).toEqual([])
  })

  it('AINDA acusa quando uma atribuição some de verdade', async () => {
    // A trava continua servindo para o que existe: se um item da rodada
    // deixar de ter qualquer atribuição, o painel precisa gritar.
    const base = await semear()
    await confirmar(banco, { data: base.data, categorias: [] }, base.operador)

    const atribuicao = await banco.atribuicao.findFirstOrThrow({ where: { ativa: true } })
    await banco.atribuicao.delete({ where: { id: atribuicao.id } })

    const conferencia = await conferirConservacao(banco, { desde: base.data })
    expect(conferencia.divergentes).toHaveLength(1)
    expect(conferencia.divergentes[0]!.gravado).toBe(conferencia.divergentes[0]!.entrada - 1)
  })
})
