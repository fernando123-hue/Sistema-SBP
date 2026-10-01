import { beforeEach, describe, expect, it } from 'vitest'

import { ErroDeNegocio } from '../core/erros'
import { serializar } from '../core/esquemas'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo, semearBase, type BaseSemeada } from '../testes/apoio'
import { concluirDoMesmoEmail, lerDadosDoItem, minhaFila, transferir } from './fila'
import { registrarManual } from './itens'

/**
 * A Minha fila em lista e detalhe (`A69`, 3A e 3B).
 *
 * 3A: os itens de um e-mail se concluem juntos — uma lista de 34 ligantes é
 * um pedido só, trabalhado de uma vez no sistema da associação. Concluir
 * continua sendo item a item no banco (cada um conta no Painel), numa
 * transação só: ou os N, ou nenhum.
 *
 * 3B: o que a IA já leu (CPF, matrícula) aparece sob demanda, só para quem
 * está com o item, e cada leitura fica na trilha sem os valores.
 *
 * Dados 100% sintéticos (invariante 8).
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

const CPF = '111.444.777-35'

let sequenciaDeEmail = 0

/** Um e-mail com `quantos` itens na fila de `donoId`, como a distribuição os deixaria. */
async function emailComItens(
  base: BaseSemeada,
  donoId: string,
  quantos: number,
  campos: Record<string, string> = { nome: 'Beltrana Sintética', cpf: CPF, matricula: '48213' },
): Promise<{ emailId: string; itemIds: string[] }> {
  sequenciaDeEmail += 1
  const categoria = await banco.categoria.findFirstOrThrow({ where: { codigo: 'DOC_CADASTRO' } })
  const email = await banco.email.create({
    data: {
      messageId: `fila-por-email-${sequenciaDeEmail}@teste.local`,
      recebidoEm: new Date('2026-09-01T12:00:00Z'),
      conteudo: {
        create: { remetente: 'liga@exemplo.test', assunto: 'Inclusão de ligantes', corpo: 'corpo sintético' },
      },
    },
  })
  const itemIds: string[] = []
  for (let posicao = 1; posicao <= quantos; posicao += 1) {
    const item = await banco.item.create({
      data: {
        emailId: email.id,
        categoriaId: categoria.id,
        sequencia: posicao,
        titulo: `Ligante sintético ${posicao}`,
        payload: serializar({
          campos,
          camposAusentes: [],
          ligaMencionada: null,
          observacao: null,
          revisadoPorHumano: false,
        }),
        confianca: 0.9,
        status: 'distribuido',
      },
    })
    await banco.atribuicao.create({
      data: { itemId: item.id, colaboradorId: donoId, motivo: 'manual', atribuidoPor: base.operadorId, ativa: true },
    })
    itemIds.push(item.id)
  }
  return { emailId: email.id, itemIds }
}

describe('minhaFila traz o e-mail de cada item', () => {
  it('itens do mesmo e-mail saem com o mesmo emailId; item à mão sai com null', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const dono = base.colaboradores[0]!
    const { emailId } = await emailComItens(base, dono.id, 3)
    await registrarManual(
      banco,
      { categoriaCodigo: 'INADIMP', titulo: 'Associado inadimplente', colaboradorId: dono.id },
      base.operador,
    )

    const fila = await minhaFila(banco, dono.id, dono.ator)

    expect(fila.filter((item) => item.emailId === emailId)).toHaveLength(3)
    expect(fila.filter((item) => item.emailId === null)).toHaveLength(1)
  })

  // A lista continua sem os dados extraídos: eles saem só no clique, item a
  // item, com trilha (3B). Trazê-los aqui seria expor o CPF de toda a fila a
  // cada carregamento, sem ninguém ter pedido.
  it('a lista não carrega os dados extraídos', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const dono = base.colaboradores[0]!
    await emailComItens(base, dono.id, 2)

    const fila = await minhaFila(banco, dono.id, dono.ator)

    expect(JSON.stringify(fila)).not.toContain('111.444')
    expect(JSON.stringify(fila)).not.toContain('48213')
  })
})

describe('concluirDoMesmoEmail (3A)', () => {
  it('conclui os N itens, um a um no banco: N execuções, N linhas de trilha', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const dono = base.colaboradores[0]!
    const { itemIds } = await emailComItens(base, dono.id, 4)

    const feito = await concluirDoMesmoEmail(banco, { itemIds }, dono.ator)

    expect(feito.concluidos).toBe(4)
    const itens = await banco.item.findMany({ where: { id: { in: itemIds } } })
    expect(itens.every((item) => item.status === 'concluido')).toBe(true)
    const execucoes = await banco.execucao.findMany({ where: { itemId: { in: itemIds } } })
    expect(execucoes).toHaveLength(4)
    expect(execucoes.every((execucao) => execucao.colaboradorId === dono.id)).toBe(true)
    const trilha = await banco.logAuditoria.findMany({ where: { acao: 'concluido', entidadeId: { in: itemIds } } })
    expect(trilha).toHaveLength(4)
    expect(trilha.every((linha) => linha.usuario === dono.id)).toBe(true)
    // A mesma correlação junta as N linhas: "foram concluídos juntos" é
    // pergunta que a trilha responde.
    expect(new Set(trilha.map((linha) => linha.correlacaoId)).size).toBe(1)
    expect(await minhaFila(banco, dono.id, dono.ator)).toHaveLength(0)
  })

  // Tudo ou nada. Se um item do e-mail mudou de mão desde que a tela abriu,
  // concluir os outros calado deixaria a pessoa achando que fechou o e-mail.
  it('um item que mudou de mão recusa o grupo inteiro, e nada é concluído', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const [dono, outra] = base.colaboradores
    const { itemIds } = await emailComItens(base, dono!.id, 3)
    await banco.atribuicao.updateMany({
      where: { itemId: itemIds[2]!, ativa: true },
      data: { ativa: null, encerradoEm: new Date() },
    })
    await banco.atribuicao.create({
      data: {
        itemId: itemIds[2]!,
        colaboradorId: outra!.id,
        motivo: 'transferencia',
        atribuidoPor: base.operadorId,
        ativa: true,
      },
    })

    const tentativa = concluirDoMesmoEmail(banco, { itemIds }, dono!.ator)

    await expect(tentativa).rejects.toBeInstanceOf(ErroDeNegocio)
    await expect(tentativa).rejects.toThrow('Atualize a tela')
    expect(await banco.execucao.count()).toBe(0)
    expect(await banco.item.count({ where: { status: 'concluido' } })).toBe(0)
    // Quem já foi dono está com a tela desatualizada, não sondando: nada de
    // evento de negação com o nome dela (invariante 10).
    expect(await banco.eventoProcessamento.count({ where: { etapa: 'autorizacao' } })).toBe(0)
  })

  // Revisão de segurança do #165: ids inventados chegavam à transação e
  // travavam linhas antes de abortar.
  it('id inexistente ou item sem dono recusa antes da transação, e nada é concluído', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const dono = base.colaboradores[0]!
    const { itemIds } = await emailComItens(base, dono.id, 2)

    await expect(
      concluirDoMesmoEmail(banco, { itemIds: [...itemIds, 'nao-existe-1', 'nao-existe-2'] }, dono.ator),
    ).rejects.toThrow('Nada foi concluído')
    expect(await banco.execucao.count()).toBe(0)
  })

  // Corrida de verdade: quem chega primeiro vale, e o outro recebe recusa —
  // nunca as duas coisas pela metade.
  it('concluir o e-mail e transferir um item dele ao mesmo tempo: um dos dois, inteiro', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const [dono, outra] = base.colaboradores
    const { itemIds } = await emailComItens(base, dono!.id, 5)

    const [lote, transferencia] = await Promise.allSettled([
      concluirDoMesmoEmail(banco, { itemIds }, dono!.ator),
      transferir(banco, { itemId: itemIds[2]!, paraColaboradorId: outra!.id, justificativa: 'é da outra liga' }, dono!.ator),
    ])

    const concluidos = await banco.item.count({ where: { id: { in: itemIds }, status: 'concluido' } })
    if (lote.status === 'fulfilled') {
      expect(concluidos).toBe(5)
      expect(transferencia.status).toBe('rejected')
    } else {
      expect(concluidos).toBe(0)
      expect(transferencia.status).toBe('fulfilled')
    }
    expect(await banco.execucao.count()).toBe(concluidos)
  })

  // Um e-mail chega a 500 itens (`LIMITE_ITENS_POR_EMAIL`). A trava é uma
  // consulta só e a transação tem prazo próprio (revisão técnica do #165).
  it('conclui um e-mail de 500 itens', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const dono = base.colaboradores[0]!
    const categoria = await banco.categoria.findFirstOrThrow({ where: { codigo: 'DOC_CADASTRO' } })
    const email = await banco.email.create({
      data: { messageId: 'quinhentos@teste.local', recebidoEm: new Date('2026-09-01T12:00:00Z') },
    })
    const itemIds = Array.from({ length: 500 }, (_, posicao) => `quinhentos-${String(posicao).padStart(3, '0')}`)
    await banco.item.createMany({
      data: itemIds.map((id, posicao) => ({
        id,
        emailId: email.id,
        categoriaId: categoria.id,
        sequencia: posicao + 1,
        titulo: `Ligante sintético ${posicao}`,
        payload: '{}',
        status: 'distribuido',
      })),
    })
    await banco.atribuicao.createMany({
      data: itemIds.map((itemId) => ({
        itemId,
        colaboradorId: dono.id,
        motivo: 'manual',
        atribuidoPor: base.operadorId,
        ativa: true,
      })),
    })

    const feito = await concluirDoMesmoEmail(banco, { itemIds }, dono.ator)

    expect(feito.concluidos).toBe(500)
    expect(await banco.execucao.count()).toBe(500)
    expect(await banco.logAuditoria.count({ where: { acao: 'concluido' } })).toBe(500)
  })

  it('não junta itens de e-mails diferentes', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const dono = base.colaboradores[0]!
    const primeiro = await emailComItens(base, dono.id, 2)
    const segundo = await emailComItens(base, dono.id, 2)

    await expect(
      concluirDoMesmoEmail(banco, { itemIds: [primeiro.itemIds[0]!, segundo.itemIds[0]!] }, dono.ator),
    ).rejects.toThrow('mesmo e-mail')
    expect(await banco.execucao.count()).toBe(0)
  })

  // Item à mão não tem e-mail: "concluir junto" não pode virar um "concluir
  // tudo" disfarçado.
  it('não junta item registrado à mão', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const dono = base.colaboradores[0]!
    const feito = await registrarManual(
      banco,
      { categoriaCodigo: 'INADIMP', titulo: 'Associado inadimplente', colaboradorId: dono.id, quantidade: 2 },
      base.operador,
    )

    await expect(concluirDoMesmoEmail(banco, { itemIds: feito.itensCriados }, dono.ator)).rejects.toThrow(
      'mesmo e-mail',
    )
    expect(await banco.execucao.count()).toBe(0)
  })

  it('o item de outra pessoa é recusado como no concluir de um item, e vira rastro de sondagem', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const [dono, intruso] = base.colaboradores
    const { itemIds } = await emailComItens(base, dono!.id, 2)

    // A mesma frase de "mudou de mão": a recusa não diz de quem é o item.
    await expect(concluirDoMesmoEmail(banco, { itemIds }, intruso!.ator)).rejects.toThrow('Nada foi concluído')
    expect(await banco.execucao.count()).toBe(0)
    expect(await banco.eventoProcessamento.count({ where: { etapa: 'autorizacao' } })).toBe(1)
  })

  it('id repetido conta uma vez só', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const dono = base.colaboradores[0]!
    const { itemIds } = await emailComItens(base, dono.id, 2)

    const feito = await concluirDoMesmoEmail(banco, { itemIds: [...itemIds, itemIds[0]!] }, dono.ator)

    expect(feito.concluidos).toBe(2)
    expect(await banco.execucao.count()).toBe(2)
  })

  // Item já concluído (outra aba) não é concluído de novo, como no concluir de
  // um item: a segunda execução contaria duas vezes no Painel.
  it('item já concluído fica de fora sem nova execução', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const dono = base.colaboradores[0]!
    const { itemIds } = await emailComItens(base, dono.id, 3)
    await concluirDoMesmoEmail(banco, { itemIds: [itemIds[0]!, itemIds[1]!] }, dono.ator)

    const feito = await concluirDoMesmoEmail(banco, { itemIds }, dono.ator)

    expect(feito.concluidos).toBe(1)
    expect(await banco.execucao.count()).toBe(3)
  })

  it('recusa lista vazia', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    await expect(concluirDoMesmoEmail(banco, { itemIds: [] }, base.colaboradores[0]!.ator)).rejects.toBeInstanceOf(
      ErroDeNegocio,
    )
  })
})

describe('lerDadosDoItem (3B)', () => {
  it('devolve os campos que a IA leu, prontos para copiar, e grava a leitura na trilha sem os valores', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const dono = base.colaboradores[0]!
    const { itemIds } = await emailComItens(base, dono.id, 1)

    const dados = await lerDadosDoItem(banco, itemIds[0]!, dono.ator)

    expect(dados).toEqual({
      situacao: 'disponivel',
      campos: [
        { campo: 'nome', rotulo: 'Nome', conhecido: true, valor: 'Beltrana Sintética' },
        { campo: 'cpf', rotulo: 'CPF', conhecido: true, valor: CPF },
        { campo: 'matricula', rotulo: 'Matrícula', conhecido: true, valor: '48213' },
      ],
    })
    const linhas = await banco.logAuditoria.findMany({ where: { acao: 'dados_do_item_lidos' } })
    expect(linhas).toHaveLength(1)
    expect(linhas[0]!.entidadeId).toBe(itemIds[0])
    expect(linhas[0]!.usuario).toBe(dono.id)
    const texto = `${linhas[0]!.antes ?? ''}${linhas[0]!.depois ?? ''}`
    expect(texto).not.toContain('111.444')
    expect(texto).not.toContain('48213')
    expect(texto).not.toContain('Beltrana')
  })

  // Só quem executa: o dado pessoal não vira material de quem só coordena.
  // Operador e gestor já leem o e-mail inteiro na Revisão, onde ele é conferido.
  it('quem não está com o item não lê, nem operador, e a sondagem deixa rastro', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const [dono, intruso] = base.colaboradores
    const { itemIds } = await emailComItens(base, dono!.id, 1)

    await expect(lerDadosDoItem(banco, itemIds[0]!, intruso!.ator)).rejects.toBeInstanceOf(ErroDeNegocio)
    await expect(lerDadosDoItem(banco, itemIds[0]!, base.operador)).rejects.toBeInstanceOf(ErroDeNegocio)
    expect(await banco.logAuditoria.count({ where: { acao: 'dados_do_item_lidos' } })).toBe(0)
    const eventos = await banco.eventoProcessamento.findMany({ where: { etapa: 'autorizacao' } })
    expect(eventos.length).toBeGreaterThan(0)
    expect(eventos.every((evento) => !(evento.mensagem ?? '').includes(itemIds[0]!))).toBe(true)
  })

  // Vale estar com o item, não o papel (revisão de segurança do #165).
  it('operador lê os dados do item que está na fila DELE', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const { itemIds } = await emailComItens(base, base.operadorId, 1)

    const dados = await lerDadosDoItem(banco, itemIds[0]!, base.operador)

    expect(dados.situacao).toBe('disponivel')
  })

  // Item que saiu da fila não é caminho lateral para ler dado antigo.
  it('item concluído não mostra mais os dados', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const dono = base.colaboradores[0]!
    const { itemIds } = await emailComItens(base, dono.id, 1)
    await concluirDoMesmoEmail(banco, { itemIds }, dono.ator)

    await expect(lerDadosDoItem(banco, itemIds[0]!, dono.ator)).rejects.toThrow('não está mais na sua fila')
    expect(await banco.logAuditoria.count({ where: { acao: 'dados_do_item_lidos' } })).toBe(0)
  })

  // Invariante 11: depois do prazo, a tela diz que saiu, e quando — não um
  // "nenhum dado" que pareceria falha da IA.
  it('dados já expurgados dizem que saíram, e quando', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const dono = base.colaboradores[0]!
    const { itemIds } = await emailComItens(base, dono.id, 1)
    const quando = new Date('2026-09-20T03:00:00Z')
    await banco.item.update({
      where: { id: itemIds[0]! },
      data: {
        dadosExtraidosExpurgadosEm: quando,
        payload: serializar({
          campos: {},
          camposAusentes: [],
          ligaMencionada: null,
          observacao: null,
          revisadoPorHumano: false,
        }),
      },
    })

    expect(await lerDadosDoItem(banco, itemIds[0]!, dono.ator)).toEqual({
      situacao: 'expurgado',
      expurgadoEm: quando.toISOString(),
    })
  })

  it('item sem campo lido diz que não há dados, sem inventar', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const dono = base.colaboradores[0]!
    const { itemIds } = await emailComItens(base, dono.id, 1, {})

    expect(await lerDadosDoItem(banco, itemIds[0]!, dono.ator)).toEqual({ situacao: 'disponivel', campos: [] })
  })

  // Invariante 7: payload ilegível é dado quebrado, não "sem campos".
  it('payload ilegível falha alto', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const dono = base.colaboradores[0]!
    const { itemIds } = await emailComItens(base, dono.id, 1)
    await banco.item.update({ where: { id: itemIds[0]! }, data: { payload: '{"campos": 5}' } })

    await expect(lerDadosDoItem(banco, itemIds[0]!, dono.ator)).rejects.toThrow()
    expect(await banco.logAuditoria.count({ where: { acao: 'dados_do_item_lidos' } })).toBe(0)
  })

  it('item que não existe é recusado sem dizer de quem é', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    await expect(lerDadosDoItem(banco, 'nao-existe', base.colaboradores[0]!.ator)).rejects.toBeInstanceOf(
      ErroDeNegocio,
    )
  })
})
