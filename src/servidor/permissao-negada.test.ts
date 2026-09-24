import { beforeEach, describe, expect, it } from 'vitest'

import { DOMINIO_ATUAL } from '../core/esquemas'
import { atorDeTeste, limparTudo, semearBase } from '../testes/apoio'
import { exigirPapel } from './ator'
import { rota } from './http'
import { obterPrisma } from './prisma'

/**
 * Permissão negada deixa rastro (achado C-24).
 *
 * `rota()` devolvia 403 sem registrar nada: um colaborador varrendo as rotas
 * de gestor, milhares de vezes, não deixava linha em stdout, evento nem
 * trilha. Sondagem de escalada ficava invisível — ninguém investiga o que não
 * foi gravado.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

async function tentarComoColaborador(colaboradorId: string): Promise<Response> {
  return rota(async () => {
    exigirPapel(atorDeTeste(colaboradorId, 'colaborador'), 'listar colaboradores', 'gestor')
    return Response.json({ sucesso: true })
  })
}

describe('permissão negada', () => {
  it('vira evento com quem, papel e operação — e a resposta continua 403', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const colega = base.colaboradores[1]!.id

    const resposta = await tentarComoColaborador(colega)

    expect(resposta.status).toBe(403)
    const eventos = await banco.eventoProcessamento.findMany({ where: { etapa: 'autorizacao' } })
    expect(eventos).toHaveLength(1)
    expect(eventos[0]!.referencia).toBe(colega)
    expect(eventos[0]!.mensagem).toContain('colaborador')
    expect(eventos[0]!.mensagem).toContain('listar colaboradores')
  })

  it('insistir não enche a tabela: uma linha por pessoa e operação a cada janela', async () => {
    // A tabela nunca é apagada, e quem sonda escolhe quantas vezes tenta. O
    // que importa é saber que houve, quem e o quê — não mil cópias.
    const base = await semearBase(banco, { totalDeDias: 1 })
    const colega = base.colaboradores[1]!.id

    for (let vez = 0; vez < 5; vez += 1) {
      expect((await tentarComoColaborador(colega)).status).toBe(403)
    }

    expect(await banco.eventoProcessamento.count({ where: { etapa: 'autorizacao' } })).toBe(1)
  })

  it('uma linha igual de OUTRO domínio não cala o registro deste (revisão de segurança do #97)', async () => {
    // A tabela é compartilhada por desenho (invariante 14). Sem o domínio no
    // filtro do teto, a linha de outro sistema com a mesma pessoa e operação
    // suprimiria a deste — em silêncio.
    const base = await semearBase(banco, { totalDeDias: 1 })
    const colega = base.colaboradores[1]!.id
    await banco.eventoProcessamento.create({
      data: {
        dominio: 'documentos',
        correlacaoId: 'corr-de-outro-sistema',
        etapa: 'autorizacao',
        situacao: 'falha',
        referencia: colega,
        mensagem: 'papel "colaborador" tentou "listar colaboradores"',
      },
    })

    await tentarComoColaborador(colega)

    expect(
      await banco.eventoProcessamento.count({ where: { etapa: 'autorizacao', dominio: DOMINIO_ATUAL } }),
    ).toBe(1)
  })
})
