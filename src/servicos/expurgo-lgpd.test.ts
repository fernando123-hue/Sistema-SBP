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
})

