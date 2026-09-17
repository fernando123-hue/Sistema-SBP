import { beforeEach, describe, expect, it } from 'vitest'

import { EmailBrutoSchema } from '../core/esquemas'
import type { AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { obterPrisma } from '../servidor/prisma'
import { atorDeTeste, limparTudo, semearBase } from '../testes/apoio'
import { definirAtivacao } from './autenticacao'
import { concluir, devolver, transferir } from './fila'
import { sincronizar } from './ingestao'
import { registrarManual } from './itens'
import { listarPendentes, resolver } from './revisao'

/**
 * Achado C-10 (`docs/auditoria/2026-09-17-achados-da-auditoria-por-agentes.md`).
 *
 * `concluir`, `devolver` e `transferir` liam a atribuição e o status SEM trava
 * e decidiam em cima dessa leitura. No InnoDB (REPEATABLE READ), duas
 * transações simultâneas passavam na mesma conferência: duas execuções para um
 * item, item "devolvido" com execução "concluído" (voltava ao pool e era feito
 * de novo), execução de A com a atribuição dizendo que o dono é B.
 *
 * Cada caso roda várias vezes: a corrida depende do agendamento, e uma rodada
 * só pode passar por sorte.
 */

const banco = obterPrisma()
const RODADAS = 25

beforeEach(async () => {
  await limparTudo(banco)
})

async function itemComDono() {
  const base = await semearBase(banco, { totalDeDias: 1 })
  const pessoa = base.colaboradores[0]!
  const outra = base.colaboradores[1]!
  return { base, pessoa, outra }
}

async function novoItem(base: Awaited<ReturnType<typeof itemComDono>>['base'], colaboradorId: string) {
  const feito = await registrarManual(
    banco,
    { categoriaCodigo: 'INADIMP', titulo: 'Associado sintético inadimplente', colaboradorId },
    base.operador,
  )
  return feito.itensCriados[0]!
}

describe('transições do mesmo item em paralelo', () => {
  it('duas conclusões ao mesmo tempo geram UMA execução', async () => {
    const { base, pessoa } = await itemComDono()
    for (let rodada = 0; rodada < RODADAS; rodada += 1) {
      const itemId = await novoItem(base, pessoa.id)

      await Promise.allSettled([
        concluir(banco, { itemId }, pessoa.ator),
        concluir(banco, { itemId }, pessoa.ator),
      ])

      expect(await banco.execucao.count({ where: { itemId } })).toBe(1)
      expect((await banco.item.findUniqueOrThrow({ where: { id: itemId } })).status).toBe('concluido')
    }
  })

  it('concluir e devolver ao mesmo tempo: vale um dos dois, nunca os dois', async () => {
    const { base, pessoa } = await itemComDono()
    for (let rodada = 0; rodada < RODADAS; rodada += 1) {
      const itemId = await novoItem(base, pessoa.id)

      const resultados = await Promise.allSettled([
        concluir(banco, { itemId }, pessoa.ator),
        devolver(banco, { itemId, justificativa: 'não é comigo, devolvendo' }, pessoa.ator),
      ])

      expect(resultados.filter((resultado) => resultado.status === 'fulfilled')).toHaveLength(1)
      const item = await banco.item.findUniqueOrThrow({ where: { id: itemId } })
      const execucoes = await banco.execucao.count({ where: { itemId } })
      // O estado proibido: item de volta ao pool com trabalho já feito.
      expect(item.status === 'devolvido' && execucoes > 0).toBe(false)
      expect(execucoes).toBe(item.status === 'concluido' ? 1 : 0)
    }
  })

  it('concluir e transferir ao mesmo tempo: quem fez é o dono que fica', async () => {
    const { base, pessoa, outra } = await itemComDono()
    for (let rodada = 0; rodada < RODADAS; rodada += 1) {
      const itemId = await novoItem(base, pessoa.id)

      await Promise.allSettled([
        concluir(banco, { itemId }, pessoa.ator),
        transferir(
          banco,
          { itemId, paraColaboradorId: outra.id, justificativa: 'redistribuindo a carga' },
          base.operador,
        ),
      ])

      const execucao = await banco.execucao.findFirst({ where: { itemId } })
      const ativa = await banco.atribuicao.findFirstOrThrow({ where: { itemId, ativa: true } })
      // Quem executou é o dono que ficou; sem execução, a transferência venceu.
      expect(ativa.colaboradorId).toBe(execucao ? execucao.colaboradorId : outra.id)
    }
  })
})

/**
 * Achados C-22 e C-23: `resolver` conferia `resolvidoEm` numa leitura sem
 * trava — duas pessoas resolviam a mesma revisão, a segunda sobrescrevia a
 * primeira e a trilha ficava com "aprovada" e "recusada" para o mesmo item —,
 * e aceitava categoria desativada, que nenhuma rodada recolhe.
 */
describe('resolver a mesma revisão', () => {
  function iaIncerta(): AiPort {
    return {
      nome: 'duble',
      interpretar: async () => ({
        itens: [
          {
            categoriaCodigo: 'DOC_CADASTRO' as const,
            titulo: 'Documento sintético',
            confianca: 0.1,
            campos: {},
            camposAusentes: [],
            ligaMencionada: null,
            observacao: null,
          },
        ],
        conteudoSuspeito: false,
        padroesSuspeitos: [],
        modelo: 'duble',
        versaoPrompt: 'teste',
      }),
    }
  }

  async function revisaoPendente(base: Awaited<ReturnType<typeof semearBase>>, messageId: string) {
    const ingestao: IngestaoPort = {
      nome: 'teste',
      buscarNovos: async () => [
        EmailBrutoSchema.parse({
          messageId,
          remetente: 'associado@exemplo.test',
          assunto: 'Documento sintético',
          corpo: 'Segue documento.',
          recebidoEm: new Date(),
        }),
      ],
    }
    await sincronizar({ banco, ingestao, ia: iaIncerta() }, base.operador)
    const item = await banco.item.findFirstOrThrow({ where: { email: { messageId } }, select: { id: true } })
    const { itens } = await listarPendentes(banco, 100)
    return itens.find((linha) => linha.itemId === item.id)!
  }

  it('duas resoluções opostas ao mesmo tempo: vale uma, a outra é recusada', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    for (let rodada = 0; rodada < RODADAS; rodada += 1) {
      const pendente = await revisaoPendente(base, `<corrida-${rodada}@exemplo.test>`)
      const pedido = { revisaoId: pendente.revisaoId, categoriaCodigo: pendente.categoriaCodigo, titulo: pendente.titulo }

      const resultados = await Promise.allSettled([
        resolver(banco, { ...pedido, aprovar: true }, base.operador),
        // Mesma conta nas duas: a corrida é da revisão, não de quem clica.
        resolver(banco, { ...pedido, aprovar: false }, base.operador),
      ])

      expect(resultados.filter((resultado) => resultado.status === 'fulfilled')).toHaveLength(1)
      const trilha = await banco.logAuditoria.count({
        where: { entidadeId: pendente.itemId, acao: { startsWith: 'revisao_' } },
      })
      expect(trilha).toBe(1)
    }
  })

  it('categoria desativada é recusada, e a revisão continua pendente', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pendente = await revisaoPendente(base, '<inativa@exemplo.test>')
    await banco.categoria.update({ where: { codigo: 'LIGANTE' }, data: { ativa: false } })

    await expect(
      resolver(
        banco,
        { revisaoId: pendente.revisaoId, categoriaCodigo: 'LIGANTE', titulo: pendente.titulo },
        base.operador,
      ),
    ).rejects.toThrow(/desativada/)
    const revisao = await banco.revisao.findUniqueOrThrow({ where: { id: pendente.revisaoId } })
    expect(revisao.resolvidoEm).toBeNull()
  })
})

/**
 * Revisão do PR: `definirAtivacao` travava a atribuição antes do item — ordem
 * inversa à da fila — e decidia com uma leitura sem trava. Concluir no mesmo
 * instante em que o gestor desliga a pessoa podia terminar com o item
 * devolvido ao grupo e a execução gravada, ou em impasse do banco.
 */
describe('concluir enquanto o gestor desliga a pessoa', () => {
  it('ou o item fica concluído, ou devolvido sem execução — nunca os dois, e sem erro de impasse', async () => {
    const { base, pessoa } = await itemComDono()
    const gestora = await banco.colaborador.create({
      data: { nome: 'Gestora Sintética', email: 'gestora.corrida@exemplo.test', papel: 'gestor' },
    })
    const gestor = atorDeTeste(gestora.id, 'gestor')

    for (let rodada = 0; rodada < RODADAS; rodada += 1) {
      await banco.colaborador.update({ where: { id: pessoa.id }, data: { ativo: true } })
      const itemId = await novoItem(base, pessoa.id)

      const resultados = await Promise.allSettled([
        concluir(banco, { itemId }, pessoa.ator),
        definirAtivacao(banco, { colaboradorId: pessoa.id, ativo: false }, gestor),
      ])

      const recusas = resultados.flatMap((resultado) =>
        resultado.status === 'rejected' ? [String(resultado.reason)] : [],
      )
      expect(recusas.filter((motivo) => /deadlock|P2034|conflict/i.test(motivo))).toEqual([])
      const item = await banco.item.findUniqueOrThrow({ where: { id: itemId } })
      const execucoes = await banco.execucao.count({ where: { itemId } })
      expect(item.status === 'devolvido' && execucoes > 0).toBe(false)
    }
  })
})
