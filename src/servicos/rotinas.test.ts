import { beforeEach, describe, expect, it } from 'vitest'

import { deslocarDias } from '../core/util/datas'
import { obterPrisma } from '../servidor/prisma'
import type { Ator } from '../servidor/ator'
import { atorDeTeste, DATA_BASE, limparTudo, semearBase, type BaseSemeada } from '../testes/apoio'
import { registrar } from './afastamentos'
import { alterarPrazo } from './retencao'
import { MINUTOS_PARA_DAR_COMO_ABANDONADA, TENTATIVAS_POR_DIA, rodarLimpezaDiaria } from './rotinas'

const banco = obterPrisma()

/**
 * `A17`: "a limpeza roda sozinha, uma vez por dia".
 *
 * O servidor tenta a cada quinze minutos. O que estes testes guardam é que
 * tentar muitas vezes continua sendo UMA limpeza por dia, que a falha fica
 * visível e é tentada de novo, e que um processo morto no meio não trava o dia.
 */

let base: BaseSemeada
let gestor: Ator

beforeEach(async () => {
  await limparTudo(banco)
  base = await semearBase(banco, { totalDeDias: 1 })
  const pessoa = await banco.colaborador.create({
    data: { nome: 'Gestora Rotina', email: 'rotina@teste.local', papel: 'gestor' },
  })
  gestor = atorDeTeste(pessoa.id, 'gestor')
})

/** Atestado que voltou há `diasDesdeAVolta` dias. */
async function atestadoQueVoltouHa(indice: number, diasDesdeAVolta: number, observacao = 'sintético') {
  return registrar(
    banco,
    {
      colaboradorId: base.colaboradores[indice]!.id,
      tipo: 'atestado',
      inicio: deslocarDias(DATA_BASE, -diasDesdeAVolta - 5),
      fim: deslocarDias(DATA_BASE, -diasDesdeAVolta - 1),
      observacao,
    },
    gestor,
  )
}

describe('uma vez por dia', () => {
  it('a segunda chamada do mesmo dia não faz nada', async () => {
    await atestadoQueVoltouHa(0, 10)

    const primeira = await rodarLimpezaDiaria(banco, { hoje: DATA_BASE })
    const segunda = await rodarLimpezaDiaria(banco, { hoje: DATA_BASE })

    expect(primeira.executou && primeira.situacao).toBe('sucesso')
    expect(segunda).toEqual({ executou: false, motivo: 'ja_concluida' })
    expect(await banco.execucaoDeRotina.count()).toBe(1)
  })

  it('dia novo, limpeza nova', async () => {
    const hoje = await rodarLimpezaDiaria(banco, { hoje: DATA_BASE })
    const amanha = await rodarLimpezaDiaria(banco, { hoje: deslocarDias(DATA_BASE, 1) })

    expect(hoje.executou).toBe(true)
    expect(amanha.executou).toBe(true)
    expect(await banco.execucaoDeRotina.count()).toBe(2)
  })

  it('aplica o prazo editado pelo gestor, não o padrão', async () => {
    const voltouHa10 = await atestadoQueVoltouHa(0, 10, 'fica com prazo de 30')
    await alterarPrazo(banco, { chave: 'motivo_de_afastamento', dias: 30 }, gestor)

    const resultado = await rodarLimpezaDiaria(banco, { hoje: DATA_BASE })

    if (!resultado.executou || resultado.situacao !== 'sucesso') throw new Error('esperava sucesso')
    expect(resultado.resumo.motivosDeAfastamento.prazoEmDias).toBe(30)
    expect(resultado.resumo.motivosDeAfastamento.vencidos).toBe(0)
    expect((await banco.afastamento.findUniqueOrThrow({ where: { id: voltouHa10.id } })).observacao).toBe(
      'fica com prazo de 30',
    )
  })

  it('a trilha do que foi apagado leva a correlação da execução', async () => {
    await atestadoQueVoltouHa(0, 10)

    const resultado = await rodarLimpezaDiaria(banco, { hoje: DATA_BASE })
    if (!resultado.executou) throw new Error('esperava execução')

    const registro = await banco.logAuditoria.findFirstOrThrow({ where: { acao: 'afastamento_motivo_expurgado' } })
    expect(registro.correlacaoId).toBe(resultado.correlacaoId)
    expect(registro.usuario).toBe('sistema')
  })

  it('também apaga o texto do e-mail vencido (A20), com o prazo que a tela mostra', async () => {
    const email = await banco.email.create({
      data: {
        messageId: '<rotina-conteudo@exemplo.test>',
        recebidoEm: new Date(`${deslocarDias(DATA_BASE, -10)}T12:00:00-03:00`),
        conteudo: { create: { remetente: 'sintetico@exemplo.test', assunto: 'Resposta automática', corpo: 'Recebido.' } },
      },
    })

    const resultado = await rodarLimpezaDiaria(banco, { hoje: DATA_BASE })

    if (!resultado.executou || resultado.situacao !== 'sucesso') throw new Error('esperava sucesso')
    expect(resultado.resumo.conteudoDosEmails).toMatchObject({ prazoEmDias: 7, apagados: 1 })
    const depois = await banco.email.findUniqueOrThrow({ where: { id: email.id }, include: { conteudo: true } })
    expect(depois.conteudo).toBeNull()
    expect(depois.conteudoExpurgadoEm).not.toBeNull()
  })
})

describe('falha não some', () => {
  it('fica registrada, com evento, e a tentativa seguinte do dia roda de novo', async () => {
    const corrompida = await atestadoQueVoltouHa(0, 10)
    await banco.afastamento.update({ where: { id: corrompida.id }, data: { tipo: 'Atestado' } })

    const falhou = await rodarLimpezaDiaria(banco, { hoje: DATA_BASE })
    expect(falhou.executou && falhou.situacao).toBe('falha')

    const execucao = await banco.execucaoDeRotina.findFirstOrThrow()
    expect(execucao.situacao).toBe('falha')
    expect(execucao.mensagem).not.toBeNull()
    expect(
      await banco.eventoProcessamento.count({ where: { etapa: 'limpeza_diaria', situacao: 'falha' } }),
    ).toBe(1)

    // Alguém corrige a linha; a próxima tentativa do MESMO dia roda.
    await banco.afastamento.update({ where: { id: corrompida.id }, data: { tipo: 'atestado' } })
    const deNovo = await rodarLimpezaDiaria(banco, { hoje: DATA_BASE })

    expect(deNovo.executou && deNovo.situacao).toBe('sucesso')
    const depois = await banco.execucaoDeRotina.findFirstOrThrow()
    expect(depois.situacao).toBe('sucesso')
    expect(depois.tentativas).toBe(2)
    expect(depois.mensagem).toBeNull()
  })

  it('uma etapa quebrada não leva as outras três junto (achado N-16)', async () => {
    // ═══ O QUE ESTE TESTE IMPEDE ═══
    //
    // As quatro limpezas do dia — motivo de afastamento, texto do e-mail,
    // dados do item e contagem de buscas — rodavam em sequência, sem rede.
    // UMA linha de `Afastamento` com tipo inválido derrubava a primeira, e as
    // outras três nem começavam. Todo dia, até alguém achar a linha: o texto
    // de e-mail vencido continuava guardado, a contagem de buscas continuava
    // crescendo — e a falha dizia respeito a outra coisa.
    //
    // Prazo é promessa a quem teve dado coletado. Uma promessa que depende de
    // nenhuma outra linha estar torta é promessa fraca.
    const corrompida = await atestadoQueVoltouHa(0, 10)
    await banco.afastamento.update({ where: { id: corrompida.id }, data: { tipo: 'Atestado' } })

    // Uma contagem de busca bem vencida, que a última etapa deve apagar mesmo
    // com a primeira quebrada.
    await banco.contagemDeBusca.create({
      data: { colaboradorId: base.operadorId, dia: deslocarDias(DATA_BASE, -400), buscas: 3 },
    })

    const resultado = await rodarLimpezaDiaria(banco, { hoje: DATA_BASE })

    // A rotina falha — a linha torta continua lá, e isso não pode ser abafado.
    expect(resultado.executou && resultado.situacao).toBe('falha')
    // Mas a etapa independente ACONTECEU.
    expect(await banco.contagemDeBusca.count({ where: { dia: deslocarDias(DATA_BASE, -400) } })).toBe(0)

    // E a mensagem diz QUAL etapa quebrou — "Error" sozinho não ajuda ninguém.
    const execucao = await banco.execucaoDeRotina.findFirstOrThrow()
    expect(execucao.mensagem).toMatch(/motivo/i)
  })

  it(`para de tentar depois de ${TENTATIVAS_POR_DIA} falhas no dia`, async () => {
    const corrompida = await atestadoQueVoltouHa(0, 10)
    await banco.afastamento.update({ where: { id: corrompida.id }, data: { tipo: 'Atestado' } })

    for (let vez = 0; vez < TENTATIVAS_POR_DIA; vez += 1) {
      const resultado = await rodarLimpezaDiaria(banco, { hoje: DATA_BASE })
      expect(resultado.executou && resultado.situacao).toBe('falha')
    }

    expect(await rodarLimpezaDiaria(banco, { hoje: DATA_BASE })).toEqual({
      executou: false,
      motivo: 'tentativas_esgotadas',
    })
  })
})

describe('execução de outro processo', () => {
  it('em curso não é atropelada; abandonada é retomada', async () => {
    const agora = new Date()
    await banco.execucaoDeRotina.create({
      data: {
        rotina: 'limpeza_diaria',
        data: DATA_BASE,
        situacao: 'em_curso',
        correlacaoId: 'outro-processo',
        iniciadaEm: new Date(agora.getTime() - 5 * 60_000),
      },
    })

    expect(await rodarLimpezaDiaria(banco, { hoje: DATA_BASE, agora })).toEqual({
      executou: false,
      motivo: 'em_curso',
    })

    const muitoDepois = new Date(agora.getTime() + MINUTOS_PARA_DAR_COMO_ABANDONADA * 60_000)
    const retomada = await rodarLimpezaDiaria(banco, { hoje: DATA_BASE, agora: muitoDepois })

    expect(retomada.executou && retomada.situacao).toBe('sucesso')
  })
})
