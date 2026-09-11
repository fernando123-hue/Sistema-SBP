import { beforeEach, describe, expect, it } from 'vitest'

import { IaMock } from '../adapters/ia-mock'
import { IngestaoMock } from '../adapters/ingestao-mock'
import { sequenciaDeDatas } from '../core/util/datas'
import { obterPrisma } from '../servidor/prisma'
import { DATA_BASE, aprovarTudoNoBanco, limparTudo, semearBase } from '../testes/apoio'
import { confirmar, previa } from './distribuicao'
import { sincronizar } from './ingestao'

/**
 * Uma categoria com cadastro inválido no banco não derruba a distribuição do dia.
 *
 * Revisão de conjunto do PR #36: `lerDoBanco` (achado 23) roda dentro do
 * `.map()` de `carregarCategorias`, e uma única linha com `frente` fora do
 * domínio — o `'CADASTROS'` plural semeado à mão, o próprio cenário que motivou
 * a leitura validada — fazia falhar a prévia e a confirmação de TODAS as
 * categorias. A inválida tem de sair nomeada, e as outras, seguir.
 * `DECISOES.md § AT-15`.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

async function diaComUmaCategoriaInvalida() {
  const base = await semearBase(banco, { totalDeDias: 1 })
  const [data] = sequenciaDeDatas(DATA_BASE, 1)
  await sincronizar(
    { banco, ingestao: new IngestaoMock({ datas: [data!], semente: 5 }), ia: new IaMock() },
    base.operador,
  )
  await aprovarTudoNoBanco(banco)
  // Edição à mão no banco: a única forma de uma linha dessas existir.
  await banco.categoria.updateMany({ where: { codigo: 'LIGA' }, data: { frente: 'CADASTROS' } })
  return { base, data: data! }
}

describe('categoria com cadastro inválido', () => {
  it('a prévia nomeia a inválida e planeja as demais', async () => {
    const { base, data } = await diaComUmaCategoriaInvalida()

    const relatorio = await previa(banco, { data, categorias: [] }, base.operador)

    expect(relatorio.categoriasInvalidas.map((c) => c.codigo)).toEqual(['LIGA'])
    expect(relatorio.categoriasInvalidas[0]!.motivo).toMatch(/CADASTROS/)
    expect(relatorio.planos.map((p) => p.categoria.codigo)).not.toContain('LIGA')
    // Sem isto, "não derrubou" passaria com uma prévia vazia.
    expect(relatorio.planos.some((p) => p.resultado !== null)).toBe(true)
  })

  it('a confirmação grava as demais e deixa a inválida no evento da rodada', async () => {
    const { base, data } = await diaComUmaCategoriaInvalida()

    const relatorio = await confirmar(banco, { data, categorias: [] }, base.operador)

    expect(relatorio.totalDistribuido).toBeGreaterThan(0)
    expect(relatorio.categoriasInvalidas.map((c) => c.codigo)).toEqual(['LIGA'])

    const evento = await banco.eventoProcessamento.findFirst({
      where: { etapa: 'distribuicao', correlacaoId: relatorio.correlacaoId, situacao: 'reprocessavel' },
    })
    expect(evento).not.toBeNull()
    expect(JSON.stringify(evento)).toContain('LIGA')
  })
})
