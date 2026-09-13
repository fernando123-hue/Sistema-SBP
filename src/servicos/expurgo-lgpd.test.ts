import { beforeEach, describe, expect, it } from 'vitest'

import { deslocarDias } from '../core/util/datas'
import { obterPrisma } from '../servidor/prisma'
import { semearBase, limparTudo, atorDeTeste, DATA_BASE, type BaseSemeada } from '../testes/apoio'
import type { Ator } from '../servidor/ator'
import { cancelar, registrar } from './afastamentos'
import { expurgarMotivosDeAfastamento } from './expurgo-lgpd'

const banco = obterPrisma()

/**
 * `A17`: o motivo de uma ausência fica 7 dias depois da volta. Passado o prazo,
 * a observação sai e o tipo vira `ferias` ou `ausente`; as datas ficam.
 *
 * A fronteira do dia é testada em `core/retencao.test.ts`. Aqui a pergunta é
 * outra: o que a rotina faz com o BANCO — o que apaga, o que preserva, o que
 * escreve na trilha, e o que acontece quando uma linha não é o que deveria.
 */

let base: BaseSemeada
let gestor: Ator

beforeEach(async () => {
  await limparTudo(banco)
  base = await semearBase(banco, { totalDeDias: 1 })
  const pessoa = await banco.colaborador.create({
    data: { nome: 'Gestora Retenção', email: 'retencao@teste.local', papel: 'gestor' },
  })
  gestor = atorDeTeste(pessoa.id, 'gestor')
})

function pessoa(indice: number): string {
  return base.colaboradores[indice]!.id
}

async function linha(id: string) {
  return banco.afastamento.findUniqueOrThrow({ where: { id } })
}

describe('o que a limpeza apaga', () => {
  it('7 dias depois da volta, a observação sai e o atestado vira ausente — na véspera, nada muda', async () => {
    // Voltou há 7 dias: o motivo vence hoje.
    const venceHoje = await registrar(
      banco,
      {
        colaboradorId: pessoa(0),
        tipo: 'atestado',
        inicio: deslocarDias(DATA_BASE, -12),
        fim: deslocarDias(DATA_BASE, -8),
        observacao: 'Atestado sintético de teste',
      },
      gestor,
    )
    // Voltou há 6 dias: vence amanhã.
    const venceAmanha = await registrar(
      banco,
      {
        colaboradorId: pessoa(1),
        tipo: 'atestado',
        inicio: deslocarDias(DATA_BASE, -12),
        fim: deslocarDias(DATA_BASE, -7),
        observacao: 'ainda dentro do prazo',
      },
      gestor,
    )

    const resultado = await expurgarMotivosDeAfastamento(banco, { diasDeRetencao: 7, hoje: DATA_BASE })

    expect(resultado).toEqual({ avaliados: 2, vencidos: 1, apagados: 1 })

    const apagado = await linha(venceHoje.id)
    expect(apagado.tipo).toBe('ausente')
    expect(apagado.observacao).toBeNull()
    expect(apagado.motivoExpurgadoEm).not.toBeNull()
    // O histórico operacional fica: é ele que explica por que a pessoa não
    // recebeu trabalho naqueles dias (invariante 11).
    expect(apagado.inicio).toBe(venceHoje.inicio)
    expect(apagado.fim).toBe(venceHoje.fim)

    const intacto = await linha(venceAmanha.id)
    expect(intacto.tipo).toBe('atestado')
    expect(intacto.observacao).toBe('ainda dentro do prazo')
    expect(intacto.motivoExpurgadoEm).toBeNull()
  })

  it('férias continuam férias; a observação sai do mesmo jeito', async () => {
    const ferias = await registrar(
      banco,
      {
        colaboradorId: pessoa(0),
        tipo: 'ferias',
        inicio: deslocarDias(DATA_BASE, -40),
        fim: deslocarDias(DATA_BASE, -30),
        observacao: 'viagem de família',
      },
      gestor,
    )

    await expurgarMotivosDeAfastamento(banco, { diasDeRetencao: 7, hoje: DATA_BASE })

    const depois = await linha(ferias.id)
    expect(depois.tipo).toBe('ferias')
    expect(depois.observacao).toBeNull()
  })

  it.each(['falta', 'licenca', 'outro'] as const)('%s também vira ausente', async (tipo) => {
    const registrado = await registrar(
      banco,
      {
        colaboradorId: pessoa(0),
        tipo,
        inicio: deslocarDias(DATA_BASE, -20),
        fim: deslocarDias(DATA_BASE, -15),
        observacao: null,
      },
      gestor,
    )

    await expurgarMotivosDeAfastamento(banco, { diasDeRetencao: 7, hoje: DATA_BASE })

    expect((await linha(registrado.id)).tipo).toBe('ausente')
  })

  it('ausência sem data de volta não entra, por mais antiga que seja', async () => {
    // `A17`: "sem data de volta registrada, o prazo só começa quando ela for".
    const emAberto = await registrar(
      banco,
      {
        colaboradorId: pessoa(0),
        tipo: 'licenca',
        inicio: deslocarDias(DATA_BASE, -400),
        fim: null,
        observacao: 'licença sem data de volta',
      },
      gestor,
    )

    const resultado = await expurgarMotivosDeAfastamento(banco, { diasDeRetencao: 7, hoje: DATA_BASE })

    expect(resultado.avaliados).toBe(0)
    const depois = await linha(emAberto.id)
    expect(depois.tipo).toBe('licenca')
    expect(depois.observacao).toBe('licença sem data de volta')
  })

  it('cancelada conta do cancelamento, mesmo com o fim registrado dois meses à frente', async () => {
    const adiada = await registrar(
      banco,
      {
        colaboradorId: pessoa(0),
        tipo: 'atestado',
        inicio: deslocarDias(DATA_BASE, 30),
        fim: deslocarDias(DATA_BASE, 60),
        observacao: 'registrado por engano',
      },
      gestor,
    )
    // Cancelada hoje.
    await cancelar(banco, adiada.id, gestor)

    await expurgarMotivosDeAfastamento(banco, { diasDeRetencao: 7, hoje: deslocarDias(DATA_BASE, 6) })
    expect((await linha(adiada.id)).observacao).toBe('registrado por engano')

    await expurgarMotivosDeAfastamento(banco, { diasDeRetencao: 7, hoje: deslocarDias(DATA_BASE, 7) })
    const depois = await linha(adiada.id)
    expect(depois.observacao).toBeNull()
    expect(depois.tipo).toBe('ausente')
    // O cancelamento continua valendo: a ausência não aconteceu.
    expect(depois.canceladoEm).not.toBeNull()
  })
})

describe('a trilha', () => {
  it('diz o tipo que ficou, nunca o tipo apagado nem o texto', async () => {
    const atestado = await registrar(
      banco,
      {
        colaboradorId: pessoa(0),
        tipo: 'atestado',
        inicio: deslocarDias(DATA_BASE, -20),
        fim: deslocarDias(DATA_BASE, -15),
        observacao: 'Texto de saúde sintético',
      },
      gestor,
    )

    await expurgarMotivosDeAfastamento(banco, { diasDeRetencao: 7, hoje: DATA_BASE, atorId: 'rotina-de-teste' })

    const registro = await banco.logAuditoria.findFirstOrThrow({
      where: { acao: 'afastamento_motivo_expurgado' },
    })
    expect(registro.usuario).toBe('rotina-de-teste')
    expect(registro.entidadeId).toBe(pessoa(0))
    expect(registro.depois).toContain(atestado.id)
    expect(registro.depois).toContain('ausente')
    // A trilha é append-only: o que entrar aqui nunca mais sai.
    expect(registro.depois).not.toContain('atestado')
    expect(registro.depois).not.toContain('Texto de saúde')
  })

  it('nem o REGISTRO da ausência guarda o motivo na trilha', async () => {
    // Sem isto, apagar o motivo da linha seria teatro: a trilha teria gravado
    // "atestado" no dia do registro, num lugar que nenhum prazo alcança.
    await registrar(
      banco,
      {
        colaboradorId: pessoa(0),
        tipo: 'atestado',
        inicio: DATA_BASE,
        fim: DATA_BASE,
        observacao: 'Observação sintética',
      },
      gestor,
    )

    const registro = await banco.logAuditoria.findFirstOrThrow({ where: { acao: 'afastamento_registrado' } })
    expect(registro.depois).not.toContain('atestado')
    expect(registro.depois).not.toContain('Observação')
    expect(registro.depois).toContain('ausente')
  })

  it('férias sem observação vencem e são carimbadas, sem linha na trilha', async () => {
    const ferias = await registrar(
      banco,
      {
        colaboradorId: pessoa(0),
        tipo: 'ferias',
        inicio: deslocarDias(DATA_BASE, -40),
        fim: deslocarDias(DATA_BASE, -30),
        observacao: null,
      },
      gestor,
    )

    const resultado = await expurgarMotivosDeAfastamento(banco, { diasDeRetencao: 7, hoje: DATA_BASE })

    expect(resultado).toEqual({ avaliados: 1, vencidos: 1, apagados: 0 })
    expect((await linha(ferias.id)).motivoExpurgadoEm).not.toBeNull()
    expect(await banco.logAuditoria.count({ where: { acao: 'afastamento_motivo_expurgado' } })).toBe(0)
  })

  it('rodar duas vezes não apaga de novo nem duplica a trilha', async () => {
    await registrar(
      banco,
      {
        colaboradorId: pessoa(0),
        tipo: 'licenca',
        inicio: deslocarDias(DATA_BASE, -200),
        fim: deslocarDias(DATA_BASE, -150),
        observacao: 'algo sensível',
      },
      gestor,
    )

    const primeira = await expurgarMotivosDeAfastamento(banco, { diasDeRetencao: 7, hoje: DATA_BASE })
    const segunda = await expurgarMotivosDeAfastamento(banco, { diasDeRetencao: 7, hoje: DATA_BASE })

    expect(primeira.apagados).toBe(1)
    // Carimbada, a linha sai das candidatas: nem é avaliada de novo.
    expect(segunda).toEqual({ avaliados: 0, vencidos: 0, apagados: 0 })
    expect(await banco.logAuditoria.count({ where: { acao: 'afastamento_motivo_expurgado' } })).toBe(1)
  })
})

describe('falha alto, antes de apagar', () => {
  it('recusa prazo inválido sem tocar em nenhuma linha', async () => {
    const recente = await registrar(
      banco,
      {
        colaboradorId: pessoa(0),
        tipo: 'atestado',
        inicio: deslocarDias(DATA_BASE, -3),
        fim: deslocarDias(DATA_BASE, -1),
        observacao: 'atestado de ontem',
      },
      gestor,
    )

    for (const dias of [-30, Number.NaN, 0]) {
      await expect(
        expurgarMotivosDeAfastamento(banco, { diasDeRetencao: dias, hoje: DATA_BASE }),
      ).rejects.toThrow(/Prazo de retenção inválido/)
    }

    expect((await linha(recente.id)).observacao).toBe('atestado de ontem')
  })

  it('um tipo corrompido no banco desfaz a limpeza inteira, inclusive o que já tinha apagado', async () => {
    const boa = await registrar(
      banco,
      {
        colaboradorId: pessoa(0),
        tipo: 'atestado',
        inicio: deslocarDias(DATA_BASE, -40),
        fim: deslocarDias(DATA_BASE, -30),
        observacao: 'linha boa',
      },
      gestor,
    )
    const corrompida = await registrar(
      banco,
      {
        colaboradorId: pessoa(1),
        tipo: 'atestado',
        inicio: deslocarDias(DATA_BASE, -40),
        fim: deslocarDias(DATA_BASE, -30),
        observacao: 'linha corrompida',
      },
      gestor,
    )
    await banco.afastamento.update({ where: { id: corrompida.id }, data: { tipo: 'Atestado' } })

    await expect(
      expurgarMotivosDeAfastamento(banco, { diasDeRetencao: 7, hoje: DATA_BASE }),
    ).rejects.toThrow(/Valor inválido no banco/)

    expect((await linha(boa.id)).observacao).toBe('linha boa')
    expect((await linha(boa.id)).motivoExpurgadoEm).toBeNull()
  })
})
