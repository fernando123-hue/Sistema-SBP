import { beforeEach, describe, expect, it } from 'vitest'

import { deslocarDias } from '../core/util/datas'
import { obterPrisma } from '../servidor/prisma'
import { semearBase, limparTudo, atorDeTeste, DATA_BASE } from '../testes/apoio'
import { expurgarObservacoesAfastamento } from './expurgo-lgpd'
import { registrar } from './afastamentos'

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

describe('expurgo LGPD de dados de saúde em afastamentos', () => {
  it('redige observações de afastamentos encerrados há mais de 90 dias', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const gestor = await banco.colaborador.create({
      data: { nome: 'Gestora LGPD', email: 'lgpd@teste.local', papel: 'gestor' },
    })
    const ator = atorDeTeste(gestor.id, 'gestor')

    const inicioAntigo = deslocarDias(DATA_BASE, -120)
    const fimAntigo = deslocarDias(DATA_BASE, -100)

    const afastamentoAntigo = await registrar(
      banco,
      {
        colaboradorId: base.colaboradores[0]!.id,
        tipo: 'atestado',
        inicio: inicioAntigo,
        fim: fimAntigo,
        observacao: 'Atestado médico CID-10 J18.9 - Pneumonia',
      },
      ator,
    )

    const inicioRecente = deslocarDias(DATA_BASE, -10)
    const fimRecente = deslocarDias(DATA_BASE, -5)

    const afastamentoRecente = await registrar(
      banco,
      {
        colaboradorId: base.colaboradores[1]!.id,
        tipo: 'atestado',
        inicio: inicioRecente,
        fim: fimRecente,
        observacao: 'Consulta dermatológica preventiva',
      },
      ator,
    )

    const resultado = await expurgarObservacoesAfastamento(banco, 90, DATA_BASE)

    expect(resultado.expurgados).toBe(1)

    const antigoBanco = await banco.afastamento.findUnique({ where: { id: afastamentoAntigo.id } })
    const recenteBanco = await banco.afastamento.findUnique({ where: { id: afastamentoRecente.id } })

    expect(antigoBanco?.observacao).toBe('[EXPURGADO LGPD]')
    expect(recenteBanco?.observacao).toBe('Consulta dermatológica preventiva')
  })

  it('registra evento na trilha de auditoria para cada observação expurgada', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const gestor = await banco.colaborador.create({
      data: { nome: 'Gestora LGPD 2', email: 'lgpd2@teste.local', papel: 'gestor' },
    })
    const ator = atorDeTeste(gestor.id, 'gestor')

    const afastamento = await registrar(
      banco,
      {
        colaboradorId: base.colaboradores[0]!.id,
        tipo: 'licenca',
        inicio: deslocarDias(DATA_BASE, -200),
        fim: deslocarDias(DATA_BASE, -150),
        observacao: 'Licença para tratamento de saúde familiar',
      },
      ator,
    )

    await expurgarObservacoesAfastamento(banco, 90, DATA_BASE, 'script-cron-lgpd')

    const auditoria = await banco.logAuditoria.findFirst({
      where: {
        entidadeId: base.colaboradores[0]!.id,
        acao: 'afastamento_observacao_expurgada',
      },
    })

    expect(auditoria).not.toBeNull()
    expect(auditoria?.usuario).toBe('script-cron-lgpd')
    expect(auditoria?.depois).toContain(afastamento.id)
  })

  it('não alcança o afastamento encerrado exatamente no dia do corte', async () => {
    // A fronteira é onde o defeito mora: trocar `lt` por `lte` num refactor
    // passaria despercebido com os casos de -100 e -5 dias que já existiam.
    const base = await semearBase(banco, { totalDeDias: 1 })
    const gestor = await banco.colaborador.create({
      data: { nome: 'Gestora Fronteira', email: 'fronteira@teste.local', papel: 'gestor' },
    })
    const ator = atorDeTeste(gestor.id, 'gestor')

    const noCorte = await registrar(
      banco,
      {
        colaboradorId: base.colaboradores[0]!.id,
        tipo: 'atestado',
        inicio: deslocarDias(DATA_BASE, -95),
        fim: deslocarDias(DATA_BASE, -90),
        observacao: 'exatamente no dia do corte',
      },
      ator,
    )

    const umDiaAntes = await registrar(
      banco,
      {
        colaboradorId: base.colaboradores[1]!.id,
        tipo: 'atestado',
        inicio: deslocarDias(DATA_BASE, -95),
        fim: deslocarDias(DATA_BASE, -91),
        observacao: 'um dia antes do corte',
      },
      ator,
    )

    const resultado = await expurgarObservacoesAfastamento(banco, 90, DATA_BASE)

    expect(resultado.expurgados).toBe(1)
    expect((await banco.afastamento.findUnique({ where: { id: noCorte.id } }))?.observacao).toBe(
      'exatamente no dia do corte',
    )
    expect((await banco.afastamento.findUnique({ where: { id: umDiaAntes.id } }))?.observacao).toBe(
      '[EXPURGADO LGPD]',
    )
  })

  it('rodar duas vezes não redige de novo nem duplica a auditoria', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const gestor = await banco.colaborador.create({
      data: { nome: 'Gestora Idem', email: 'idem@teste.local', papel: 'gestor' },
    })
    const ator = atorDeTeste(gestor.id, 'gestor')

    await registrar(
      banco,
      {
        colaboradorId: base.colaboradores[0]!.id,
        tipo: 'licenca',
        inicio: deslocarDias(DATA_BASE, -200),
        fim: deslocarDias(DATA_BASE, -150),
        observacao: 'algo sensível',
      },
      ator,
    )

    const primeira = await expurgarObservacoesAfastamento(banco, 90, DATA_BASE)
    const segunda = await expurgarObservacoesAfastamento(banco, 90, DATA_BASE)

    expect(primeira.expurgados).toBe(1)
    // Sem isto, um agendador diário encheria a trilha append-only de linhas
    // dizendo que expurgou de novo o que já estava expurgado.
    expect(segunda.expurgados).toBe(0)
    expect(
      await banco.logAuditoria.count({ where: { acao: 'afastamento_observacao_expurgada' } }),
    ).toBe(1)
  })

  it('recusa retenção inválida ANTES de tocar em qualquer linha', async () => {
    // A redação é irreversível. `DIAS_RETENCAO_AFAS=-30` num agendador daria
    // data de corte no futuro e apagaria a observação de todo mundo, inclusive
    // a de ontem.
    const base = await semearBase(banco, { totalDeDias: 1 })
    const gestor = await banco.colaborador.create({
      data: { nome: 'Gestora Guarda', email: 'guarda@teste.local', papel: 'gestor' },
    })
    const ator = atorDeTeste(gestor.id, 'gestor')

    const recente = await registrar(
      banco,
      {
        colaboradorId: base.colaboradores[0]!.id,
        tipo: 'atestado',
        inicio: deslocarDias(DATA_BASE, -3),
        fim: deslocarDias(DATA_BASE, -1),
        observacao: 'atestado de ontem',
      },
      ator,
    )

    await expect(expurgarObservacoesAfastamento(banco, -30, DATA_BASE)).rejects.toThrow(
      /Retenção inválida/,
    )
    await expect(expurgarObservacoesAfastamento(banco, Number.NaN, DATA_BASE)).rejects.toThrow(
      /Retenção inválida/,
    )
    await expect(expurgarObservacoesAfastamento(banco, 0, DATA_BASE)).rejects.toThrow(
      /Retenção inválida/,
    )

    expect((await banco.afastamento.findUnique({ where: { id: recente.id } }))?.observacao).toBe(
      'atestado de ontem',
    )
  })

  it('não alcança ausência EM ABERTO, por mais antiga que seja — e isso é decisão', async () => {
    // Ausência sem data de volta ainda está acontecendo: redigir o motivo de
    // quem está fora AGORA tiraria da chefia a informação de que ela precisa
    // hoje. Este teste fixa o comportamento para que, quando a chefia responder
    // o § H.4 item 12, a mudança seja deliberada e não um efeito colateral.
    const base = await semearBase(banco, { totalDeDias: 1 })
    const gestor = await banco.colaborador.create({
      data: { nome: 'Gestora Aberta', email: 'aberta@teste.local', papel: 'gestor' },
    })
    const ator = atorDeTeste(gestor.id, 'gestor')

    const emAberto = await registrar(
      banco,
      {
        colaboradorId: base.colaboradores[0]!.id,
        tipo: 'licenca',
        inicio: deslocarDias(DATA_BASE, -400),
        fim: null,
        observacao: 'licença sem data de volta',
      },
      ator,
    )

    const resultado = await expurgarObservacoesAfastamento(banco, 90, DATA_BASE)

    expect(resultado.expurgados).toBe(0)
    expect((await banco.afastamento.findUnique({ where: { id: emAberto.id } }))?.observacao).toBe(
      'licença sem data de volta',
    )
  })
})
