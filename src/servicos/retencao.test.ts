import { beforeEach, describe, expect, it } from 'vitest'

import { obterPrisma } from '../servidor/prisma'
import type { Ator } from '../servidor/ator'
import { atorDeTeste, limparTudo, semearBase, type BaseSemeada } from '../testes/apoio'
import { alterarPrazo, listarPrazos, prazoEmVigor } from './retencao'

const banco = obterPrisma()

/**
 * `A17`: "o prazo é editável pela liderança — todos com papel gestor —, pela
 * tela, com a mudança gravada na trilha (quem, de quanto para quanto, quando);
 * encurtar apaga motivos sem volta, então a tela confirma antes."
 */

let base: BaseSemeada
let gestor: Ator

beforeEach(async () => {
  await limparTudo(banco)
  base = await semearBase(banco, { totalDeDias: 1 })
  const pessoa = await banco.colaborador.create({
    data: { nome: 'Gestora Prazos', email: 'prazos@teste.local', papel: 'gestor' },
  })
  gestor = atorDeTeste(pessoa.id, 'gestor')
})

describe('quem pode', () => {
  it('colaborador e operador não veem nem mudam prazo', async () => {
    for (const ator of [base.colaboradores[0]!.ator, base.operador]) {
      await expect(listarPrazos(banco, ator)).rejects.toThrow(/não pode executar/)
      await expect(
        alterarPrazo(banco, { chave: 'motivo_de_afastamento', dias: 30 }, ator),
      ).rejects.toThrow(/não pode executar/)
    }

    expect(await banco.prazoDeRetencao.count()).toBe(0)
  })
})

describe('o valor em vigor', () => {
  it('sem ninguém mudar, vale o padrão de 7 dias', async () => {
    expect(await listarPrazos(banco, gestor)).toEqual([
      { chave: 'motivo_de_afastamento', dias: 7, padrao: 7, alteradoEm: null, alteradoPorNome: null },
      { chave: 'conteudo_do_email', dias: 7, padrao: 7, alteradoEm: null, alteradoPorNome: null },
    ])
    expect(await prazoEmVigor(banco, 'motivo_de_afastamento')).toBe(7)
  })

  it('uma linha corrompida no banco falha alto em vez de chegar à rotina que apaga', async () => {
    await banco.prazoDeRetencao.create({
      data: { chave: 'motivo_de_afastamento', dias: 0, alteradoPor: 'edicao-manual' },
    })

    await expect(prazoEmVigor(banco, 'motivo_de_afastamento')).rejects.toThrow(
      /Prazo de retenção inválido/,
    )
  })
})

describe('mudar o prazo', () => {
  it('alongar grava, e a trilha diz quem, de quanto e para quanto', async () => {
    const mudanca = await alterarPrazo(banco, { chave: 'motivo_de_afastamento', dias: 30 }, gestor)

    expect(mudanca).toEqual({ chave: 'motivo_de_afastamento', diasAntes: 7, diasDepois: 30, mudou: true })

    const [prazo] = await listarPrazos(banco, gestor)
    expect(prazo!.dias).toBe(30)
    expect(prazo!.alteradoPorNome).toBe('Gestora Prazos')
    expect(prazo!.alteradoEm).not.toBeNull()

    const registro = await banco.logAuditoria.findFirstOrThrow({ where: { acao: 'prazo_de_retencao_alterado' } })
    expect(registro.usuario).toBe(gestor.colaboradorId)
    expect(registro.entidadeId).toBe('motivo_de_afastamento')
    expect(JSON.parse(registro.antes!)).toEqual({ dias: 7 })
    expect(JSON.parse(registro.depois!)).toEqual({ dias: 30 })
  })

  it('encurtar SEM confirmação é recusado pelo servidor, e nada é gravado', async () => {
    await expect(
      alterarPrazo(banco, { chave: 'motivo_de_afastamento', dias: 3 }, gestor),
    ).rejects.toThrow(/Encurtar de 7 para 3 dias apaga/)

    expect(await prazoEmVigor(banco, 'motivo_de_afastamento')).toBe(7)
    expect(await banco.logAuditoria.count({ where: { acao: 'prazo_de_retencao_alterado' } })).toBe(0)
  })

  it('encurtar COM confirmação grava', async () => {
    await alterarPrazo(banco, { chave: 'motivo_de_afastamento', dias: 3, confirmarEncurtamento: true }, gestor)

    expect(await prazoEmVigor(banco, 'motivo_de_afastamento')).toBe(3)
  })

  it('encurtar compara com o valor EM VIGOR, não com o padrão', async () => {
    await alterarPrazo(banco, { chave: 'motivo_de_afastamento', dias: 30 }, gestor)

    // 10 é mais que o padrão, e menos que os 30 em vigor: ainda é encurtar.
    await expect(
      alterarPrazo(banco, { chave: 'motivo_de_afastamento', dias: 10 }, gestor),
    ).rejects.toThrow(/Encurtar de 30 para 10 dias/)
  })

  it('repetir o valor em vigor não grava nem escreve na trilha', async () => {
    const mudanca = await alterarPrazo(banco, { chave: 'motivo_de_afastamento', dias: 7 }, gestor)

    expect(mudanca.mudou).toBe(false)
    expect(await banco.prazoDeRetencao.count()).toBe(0)
    expect(await banco.logAuditoria.count({ where: { acao: 'prazo_de_retencao_alterado' } })).toBe(0)
  })

  it.each([0, -1, 7.5, 3651])('recusa %s dias na entrada', async (dias) => {
    await expect(
      alterarPrazo(banco, { chave: 'motivo_de_afastamento', dias, confirmarEncurtamento: true }, gestor),
    ).rejects.toThrow()

    expect(await banco.prazoDeRetencao.count()).toBe(0)
  })

  it('recusa chave de prazo que não existe', async () => {
    await expect(
      alterarPrazo(banco, { chave: 'qualquer_coisa', dias: 30 }, gestor),
    ).rejects.toThrow()
  })
})
