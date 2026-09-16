import { beforeEach, describe, expect, it } from 'vitest'

import { IaMock } from '../adapters/ia-mock'
import { IngestaoMock } from '../adapters/ingestao-mock'
import { sequenciaDeDatas } from '../core/util/datas'
import { obterPrisma } from '../servidor/prisma'
import { DATA_BASE, aprovarTudoNoBanco, limparTudo, semearBase } from '../testes/apoio'
import { confirmar } from './distribuicao'
import { devolver, transferir } from './fila'
import { sincronizar } from './ingestao'
import { registrarManual } from './itens'
import { listarPendentes, resolver } from './revisao'

/**
 * A trilha de auditoria não guarda título, valor extraído nem texto livre.
 *
 * `LogAuditoria` é append-only e nenhum prazo o alcança. Tudo o que entra nele
 * fica para sempre — então o que tem nome de associado não pode entrar
 * (`A23(d)`, `A40`). A trilha diz quem, o quê, quando e QUAIS campos mudaram;
 * nunca o que estava escrito.
 *
 * Os nomes abaixo são sintéticos e fáceis de procurar no texto gravado.
 */

const banco = obterPrisma()

const NOME = 'Helena Prado Sintética'
const CPF = '111.444.777-35'

beforeEach(async () => {
  await limparTudo(banco)
})

async function textoDaTrilha(entidadeId: string, acao: string): Promise<string> {
  const linhas = await banco.logAuditoria.findMany({ where: { entidadeId, acao } })
  expect(linhas.length).toBeGreaterThan(0)
  return linhas.map((linha) => `${linha.antes ?? ''}${linha.depois ?? ''}`).join('\n')
}

async function ingerirUmDia(pessoasDePlantao = 2) {
  const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao })
  const datas = sequenciaDeDatas(DATA_BASE, 1)
  await sincronizar(
    { banco, ingestao: new IngestaoMock({ datas, semente: 11 }), ia: new IaMock() },
    base.operador,
  )
  return { base, datas }
}

describe('registro manual', () => {
  it('a trilha não guarda o título nem a observação digitados', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    const feito = await registrarManual(
      banco,
      {
        categoriaCodigo: 'INADIMP',
        titulo: `Ligação de ${NOME} sobre anuidade`,
        colaboradorId: base.colaboradores[0]!.id,
        observacao: `CPF ${CPF}, pediu segunda via`,
      },
      base.operador,
    )

    const trilha = await textoDaTrilha(feito.itensCriados[0]!, 'item_registrado_manualmente')
    expect(trilha).not.toContain('Helena')
    expect(trilha).not.toContain('111.444')
    expect(trilha).not.toContain('segunda via')
    // Que houve observação é processo, não dado pessoal — e diz a quem
    // investiga que vale procurar o item enquanto o texto existir.
    expect(JSON.parse(trilha)).toMatchObject({ categoriaCodigo: 'INADIMP', temObservacao: true })
  })
})

describe('revisão resolvida', () => {
  it('a trilha diz que o título e quais campos mudaram, sem os valores', async () => {
    const { base } = await ingerirUmDia()
    const { itens } = await listarPendentes(banco, 1)
    const alvo = itens[0]!

    await resolver(
      banco,
      {
        revisaoId: alvo.revisaoId,
        categoriaCodigo: alvo.categoriaCodigo,
        titulo: `Inscrição de ${NOME}`,
        campos: { nome: NOME, cpf: CPF },
        aprovar: true,
      },
      base.operador,
    )

    const trilha = await textoDaTrilha(alvo.itemId, 'revisao_aprovada')
    expect(trilha).not.toContain('Helena')
    expect(trilha).not.toContain('111.444')
    // O título que a IA extraiu também pode ter nome: nem o de antes entra.
    expect(trilha).not.toContain(alvo.titulo)

    const depois = JSON.parse(
      (await banco.logAuditoria.findFirstOrThrow({
        where: { entidadeId: alvo.itemId, acao: 'revisao_aprovada' },
      })).depois!,
    ) as { tituloEditado: boolean; camposAlterados: string[] }
    expect(depois.tituloEditado).toBe(true)
    expect(depois.camposAlterados).toEqual(expect.arrayContaining(['cpf', 'nome']))
  })

  it('item criado por divisão da revisão não leva o título para a trilha', async () => {
    const { base } = await ingerirUmDia()
    const { itens } = await listarPendentes(banco, 1)
    const alvo = itens[0]!

    const feito = await resolver(
      banco,
      {
        revisaoId: alvo.revisaoId,
        categoriaCodigo: alvo.categoriaCodigo,
        titulo: alvo.titulo,
        campos: {},
        aprovar: true,
        itensExtras: [{ titulo: `Ligante esquecido — ${NOME}`, campos: { nome: NOME } }],
      },
      base.operador,
    )

    const trilha = await textoDaTrilha(
      feito.itensExtrasCriados[0]!,
      'item_criado_por_divisao_de_revisao',
    )
    expect(trilha).not.toContain('Helena')
  })
})

describe('transferência e devolução', () => {
  async function distribuirUmDia() {
    const { base, datas } = await ingerirUmDia(2)
    await aprovarTudoNoBanco(banco)
    await confirmar(banco, { data: datas[0]!, categorias: [] }, base.operador)
    const atribuicao = await banco.atribuicao.findFirstOrThrow({ where: { ativa: true } })
    const dono = base.colaboradores.find((pessoa) => pessoa.id === atribuicao.colaboradorId)!
    const outro = base.colaboradores.find((pessoa) => pessoa.id !== atribuicao.colaboradorId)!
    return { base, atribuicao, dono, outro }
  }

  it('transferência: o texto mora à parte, e a trilha só sabe que houve', async () => {
    const { base, atribuicao, outro } = await distribuirUmDia()

    await transferir(
      banco,
      {
        itemId: atribuicao.itemId,
        paraColaboradorId: outro.id,
        justificativa: `Associada ${NOME} pediu para falar com a colega`,
      },
      base.operador,
    )

    const trilha = await textoDaTrilha(atribuicao.itemId, 'transferencia')
    expect(trilha).not.toContain('Helena')
    expect(trilha).toContain('"temJustificativa":true')

    const nova = await banco.atribuicao.findFirstOrThrow({
      where: { itemId: atribuicao.itemId, ativa: true },
      include: { justificativas: true },
    })
    expect(nova.justificativas).toHaveLength(1)
    expect(nova.justificativas[0]).toMatchObject({ motivo: 'transferencia' })
    expect(nova.justificativas[0]!.texto).toContain(NOME)
  })

  it('devolução: o texto mora à parte, e a trilha só sabe que houve', async () => {
    const { atribuicao, dono } = await distribuirUmDia()

    await devolver(
      banco,
      { itemId: atribuicao.itemId, justificativa: `${NOME} ligou e resolveu no balcão` },
      dono.ator,
    )

    const trilha = await textoDaTrilha(atribuicao.itemId, 'devolvido')
    expect(trilha).not.toContain('Helena')
    expect(trilha).toContain('"temJustificativa":true')

    const encerrada = await banco.atribuicao.findUniqueOrThrow({
      where: { id: atribuicao.id },
      include: { justificativas: true },
    })
    expect(encerrada.justificativas).toHaveLength(1)
    expect(encerrada.justificativas[0]).toMatchObject({ motivo: 'devolucao' })
    expect(encerrada.justificativas[0]!.texto).toContain(NOME)
  })

  it('recebeu por transferência e devolveu: as duas justificativas ficam', async () => {
    const { base, atribuicao, outro } = await distribuirUmDia()

    await transferir(
      banco,
      {
        itemId: atribuicao.itemId,
        paraColaboradorId: outro.id,
        justificativa: 'Colega de férias a partir de amanhã.',
      },
      base.operador,
    )
    await devolver(
      banco,
      { itemId: atribuicao.itemId, justificativa: 'Não é da minha alçada.' },
      outro.ator,
    )

    // A devolução encerra a MESMA atribuição que a transferência criou.
    const daTransferencia = await banco.atribuicao.findFirstOrThrow({
      where: { itemId: atribuicao.itemId, motivo: 'devolucao', colaboradorId: outro.id },
      include: { justificativas: { orderBy: { criadoEm: 'asc' } } },
    })
    expect(daTransferencia.justificativas.map((linha) => linha.motivo)).toEqual([
      'transferencia',
      'devolucao',
    ])
  })
})
