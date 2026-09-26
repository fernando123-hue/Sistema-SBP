import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErroDeNegocio } from '../core/erros'
import { DOMINIO_ATUAL } from '../core/esquemas'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo, semearBase } from '../testes/apoio'
import { concluir, transferir } from './fila'
import { registrarManual } from './itens'

/**
 * Tentar concluir o item de OUTRA pessoa deixa rastro (pendência 8).
 *
 * A recusa já existia (422, "Só o responsável ativo pode concluir o item"),
 * mas calada: um colaborador varrendo ids para concluir o que não é dele não
 * deixava linha em evento nem em log — a sondagem **horizontal** que o C-24
 * fechou para a vertical (403). A resposta continua a mesma: o caso legítimo
 * existe (a tela estava aberta quando o item foi transferido) e a frase o
 * explica bem.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function itemDe(base: Awaited<ReturnType<typeof semearBase>>, colaboradorId: string): Promise<string> {
  const feito = await registrarManual(
    banco,
    { categoriaCodigo: 'INADIMP', titulo: 'Associado inadimplente', colaboradorId },
    base.operador,
  )
  return feito.itensCriados[0]!
}

describe('concluir item de outra pessoa', () => {
  it('é recusado como antes E vira evento de autorização com quem tentou', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const [dono, intruso] = base.colaboradores
    const itemId = await itemDe(base, dono!.id)

    const tentativa = concluir(banco, { itemId }, intruso!.ator)

    await expect(tentativa).rejects.toBeInstanceOf(ErroDeNegocio)
    await expect(tentativa).rejects.toThrow('Só o responsável ativo pode concluir o item')
    const eventos = await banco.eventoProcessamento.findMany({ where: { etapa: 'autorizacao' } })
    expect(eventos).toHaveLength(1)
    expect(eventos[0]!.situacao).toBe('falha')
    expect(eventos[0]!.referencia).toBe(intruso!.id)
    expect(eventos[0]!.mensagem).toContain('concluir item de outra pessoa')
    // Invariante 14: a linha nasce sabendo de que domínio é.
    expect(eventos[0]!.dominio).toBe(DOMINIO_ATUAL)
    // Nem o id do item: a mensagem é gravada sem redação e para sempre.
    expect(eventos[0]!.mensagem).not.toContain(itemId)
    // Nada foi concluído.
    expect((await banco.item.findUniqueOrThrow({ where: { id: itemId } })).status).not.toBe('concluido')
  })

  it('insistir não enche a tabela: uma linha por pessoa a cada janela', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const [dono, intruso] = base.colaboradores

    for (let vez = 0; vez < 5; vez += 1) {
      const itemId = await itemDe(base, dono!.id)
      await expect(concluir(banco, { itemId }, intruso!.ator)).rejects.toBeInstanceOf(ErroDeNegocio)
    }

    expect(await banco.eventoProcessamento.count({ where: { etapa: 'autorizacao' } })).toBe(1)
  })

  it('o dono concluindo o próprio item não deixa rastro de negação', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const dono = base.colaboradores[0]!
    const itemId = await itemDe(base, dono.id)

    await concluir(banco, { itemId }, dono.ator)

    expect(await banco.eventoProcessamento.count({ where: { etapa: 'autorizacao' } })).toBe(0)
  })

  // O caso legítimo (revisões do #130): a tela estava aberta quando o item foi
  // remanejado. Quem já foi responsável não está sondando — e uma linha de
  // "negação" com o nome dela, numa trilha que nunca é apagada, seria lida
  // como acusação (invariante 10).
  it('tela desatualizada (o item já foi seu) é recusada sem virar evento', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const [antiga, nova] = base.colaboradores
    const itemId = await itemDe(base, antiga!.id)
    await transferir(banco, { itemId, paraColaboradorId: nova!.id, justificativa: 'remanejar carga do dia' }, base.operador)

    await expect(concluir(banco, { itemId }, antiga!.ator)).rejects.toThrow(
      'Só o responsável ativo pode concluir o item',
    )

    expect(await banco.eventoProcessamento.count({ where: { etapa: 'autorizacao' } })).toBe(0)
  })

  it('falha ao gravar o rastro não troca a recusa por erro interno', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const [dono, intruso] = base.colaboradores
    const itemId = await itemDe(base, dono!.id)
    const espiao = vi.spyOn(banco.eventoProcessamento, 'create').mockRejectedValueOnce(new Error('banco fora'))

    const tentativa = concluir(banco, { itemId }, intruso!.ator)

    await expect(tentativa).rejects.toBeInstanceOf(ErroDeNegocio)
    await expect(tentativa).rejects.toThrow('Só o responsável ativo pode concluir o item')
    // Sem isto o teste passaria sem exercitar o `catch` (revisão de segurança do #130).
    expect(espiao).toHaveBeenCalled()
  })
})
