import { beforeEach, describe, expect, it } from 'vitest'

import { deslocarDias } from '../core/util/datas'
import { FalhaDeArmazenamento, type ArmazenamentoPort } from '../ports/armazenamento'
import { obterPrisma } from '../servidor/prisma'
import { DATA_BASE, limparTudo, semearBase, type BaseSemeada } from '../testes/apoio'
import { expurgarConteudoDosEmails } from './expurgo-conteudo'

const banco = obterPrisma()

/**
 * `A20`: o conteúdo do e-mail (remetente, assunto, corpo) e os bytes dos anexos
 * saem 7 dias depois da conclusão do último item. A fronteira do dia é testada
 * em `core/retencao.test.ts`; aqui, o que a limpeza faz com o banco e com o
 * armazenamento — o que apaga, o que preserva, e o que acontece quando o disco
 * falha. Dados 100% sintéticos.
 */

class ArmazenamentoDeTeste implements ArmazenamentoPort {
  readonly nome = 'teste'
  readonly arquivos = new Map<string, Uint8Array>()
  readonly falhaAoRemover = new Set<string>()
  private proxima = 0

  async guardar(bytes: Uint8Array): Promise<string> {
    this.proxima += 1
    const chave = `teste/${this.proxima}`
    this.arquivos.set(chave, bytes)
    return chave
  }

  async ler(chave: string): Promise<Uint8Array | null> {
    return this.arquivos.get(chave) ?? null
  }

  async remover(chave: string): Promise<void> {
    if (this.falhaAoRemover.has(chave)) throw new FalhaDeArmazenamento('remover', 'falha simulada')
    this.arquivos.delete(chave)
  }
}

let base: BaseSemeada
let armazenamento: ArmazenamentoDeTeste
let contador = 0

beforeEach(async () => {
  await limparTudo(banco)
  base = await semearBase(banco, { totalDeDias: 1 })
  armazenamento = new ArmazenamentoDeTeste()
})

/** Meio-dia em Brasília do dia `desloc` dias a partir de hoje. */
function meioDia(desloc: number): Date {
  return new Date(`${deslocarDias(DATA_BASE, desloc)}T12:00:00-03:00`)
}

interface ItemDeTeste {
  status: string
  concluidoHa?: number
  canceladoHa?: number
}

async function emailDeTeste(opcoes: {
  recebidoHa: number
  itens?: ItemDeTeste[]
  anexos?: number
  suspeito?: boolean
}) {
  contador += 1
  const categoria = await banco.categoria.findFirstOrThrow()
  const chaves: string[] = []
  for (let i = 0; i < (opcoes.anexos ?? 0); i += 1) {
    chaves.push(await armazenamento.guardar(new Uint8Array([1, 2, 3])))
  }

  const email = await banco.email.create({
    data: {
      messageId: `<conteudo-${contador}@exemplo.test>`,
      recebidoEm: meioDia(-opcoes.recebidoHa),
      conteudoSuspeito: opcoes.suspeito ?? false,
      conteudo: {
        create: {
          remetente: 'remetente.sintetico@exemplo.test',
          assunto: 'Assunto sintético de teste',
          corpo: 'Corpo sintético de teste',
        },
      },
      anexos: {
        create: chaves.map((chave) => ({
          nomeSeguro: 'documento-sintetico.pdf',
          tipoDeclarado: 'application/pdf',
          tamanho: 3,
          aceito: true,
          chaveArmazenamento: chave,
          armazenadoEm: new Date(),
        })),
      },
    },
  })

  for (const [posicao, item] of (opcoes.itens ?? []).entries()) {
    const criado = await banco.item.create({
      data: {
        emailId: email.id,
        categoriaId: categoria.id,
        sequencia: posicao + 1,
        titulo: 'Item sintético',
        status: item.status,
        canceladoEm: item.canceladoHa === undefined ? null : meioDia(-item.canceladoHa),
      },
    })
    if (item.concluidoHa !== undefined) {
      await banco.execucao.create({
        data: {
          itemId: criado.id,
          colaboradorId: base.colaboradores[0]!.id,
          concluidoEm: meioDia(-item.concluidoHa),
          resultado: 'concluido',
        },
      })
    }
  }

  return { id: email.id, chaves }
}

async function estado(emailId: string) {
  return banco.email.findUniqueOrThrow({
    where: { id: emailId },
    include: { conteudo: true, anexos: true, itens: true },
  })
}

function expurgar(extra: Partial<Parameters<typeof expurgarConteudoDosEmails>[1]> = {}) {
  return expurgarConteudoDosEmails(banco, { diasDeRetencao: 7, armazenamento, hoje: DATA_BASE, ...extra })
}

describe('o que a limpeza apaga', () => {
  it('7 dias depois da conclusão do último item, texto e arquivos saem — na véspera, nada muda', async () => {
    const venceHoje = await emailDeTeste({
      recebidoHa: 20,
      itens: [
        { status: 'concluido', concluidoHa: 15 },
        { status: 'concluido', concluidoHa: 7 },
      ],
      anexos: 2,
    })
    const venceAmanha = await emailDeTeste({
      recebidoHa: 20,
      itens: [{ status: 'concluido', concluidoHa: 6 }],
      anexos: 1,
    })

    const resultado = await expurgar()

    expect(resultado).toEqual({ avaliados: 2, vencidos: 1, apagados: 1, anexosRemovidos: 2 })

    const apagado = await estado(venceHoje.id)
    expect(apagado.conteudo).toBeNull()
    expect(apagado.conteudoExpurgadoEm).not.toBeNull()
    for (const chave of venceHoje.chaves) expect(armazenamento.arquivos.has(chave)).toBe(false)
    // O histórico operacional fica inteiro (invariante 11): data de chegada,
    // itens e os METADADOS do anexo — é com eles que se acha o original.
    expect(apagado.recebidoEm).toEqual(meioDia(-20))
    expect(apagado.itens).toHaveLength(2)
    expect(apagado.anexos).toHaveLength(2)
    for (const anexo of apagado.anexos) {
      expect(anexo.chaveArmazenamento).toBeNull()
      expect(anexo.bytesExpurgadosEm).not.toBeNull()
      expect(anexo.nomeSeguro).toBe('documento-sintetico.pdf')
      expect(anexo.tamanho).toBe(3)
    }

    const intacto = await estado(venceAmanha.id)
    expect(intacto.conteudo?.remetente).toBe('remetente.sintetico@exemplo.test')
    expect(intacto.anexos[0]!.chaveArmazenamento).toBe(venceAmanha.chaves[0])
    expect(armazenamento.arquivos.has(venceAmanha.chaves[0]!)).toBe(true)
  })

  it('um item aberto segura o conteúdo, mesmo com o irmão concluído há dois meses', async () => {
    const email = await emailDeTeste({
      recebidoHa: 70,
      itens: [
        { status: 'concluido', concluidoHa: 60 },
        { status: 'distribuido' },
      ],
      anexos: 1,
    })

    const resultado = await expurgar()

    expect(resultado.vencidos).toBe(0)
    expect((await estado(email.id)).conteudo).not.toBeNull()
  })

  it('e-mail que não virou item conta da chegada', async () => {
    const venceu = await emailDeTeste({ recebidoHa: 7 })
    const aindaNao = await emailDeTeste({ recebidoHa: 6 })

    await expurgar()

    expect((await estado(venceu.id)).conteudo).toBeNull()
    expect((await estado(aindaNao.id)).conteudo).not.toBeNull()
  })

  it('e-mail SUSPEITO que não virou item fica guardado até uma pessoa decidir (A34)', async () => {
    const suspeito = await emailDeTeste({ recebidoHa: 100, suspeito: true })

    const resultado = await expurgar()

    expect(resultado.vencidos).toBe(0)
    expect((await estado(suspeito.id)).conteudo).not.toBeNull()
  })

  it('item cancelado conta do cancelamento', async () => {
    const email = await emailDeTeste({ recebidoHa: 30, itens: [{ status: 'cancelado', canceladoHa: 7 }] })

    await expurgar()

    expect((await estado(email.id)).conteudo).toBeNull()
  })

  it('item concluído sem registro de conclusão conta como aberto — na dúvida, o conteúdo fica', async () => {
    const email = await emailDeTeste({ recebidoHa: 90, itens: [{ status: 'concluido' }] })

    await expurgar()

    expect((await estado(email.id)).conteudo).not.toBeNull()
  })
})

describe('a trilha e a repetição', () => {
  it('a trilha diz que o conteúdo saiu, e nunca guarda remetente, assunto nem nome de anexo', async () => {
    const email = await emailDeTeste({ recebidoHa: 30, anexos: 1 })

    await expurgar({ atorId: 'rotina-de-teste' })

    const registro = await banco.logAuditoria.findFirstOrThrow({ where: { acao: 'conteudo_do_email_expurgado' } })
    expect(registro.entidadeId).toBe(email.id)
    expect(registro.usuario).toBe('rotina-de-teste')
    expect(JSON.parse(registro.depois!)).toEqual({ anexosRemovidos: 1, prazoEmDias: 7 })
  })

  it('rodar duas vezes não apaga de novo nem duplica a trilha', async () => {
    await emailDeTeste({ recebidoHa: 30, anexos: 1 })

    const primeira = await expurgar()
    const segunda = await expurgar()

    expect(primeira.apagados).toBe(1)
    expect(segunda).toEqual({ avaliados: 0, vencidos: 0, apagados: 0, anexosRemovidos: 0 })
    expect(await banco.logAuditoria.count({ where: { acao: 'conteudo_do_email_expurgado' } })).toBe(1)
  })
})

describe('falha alto, e nunca apaga do banco o que ficou no disco', () => {
  it('o arquivo que não saiu deixa o e-mail inteiro pendente; os outros seguem; e a execução falha', async () => {
    const travado = await emailDeTeste({ recebidoHa: 30, anexos: 2 })
    const livre = await emailDeTeste({ recebidoHa: 30, anexos: 1 })
    armazenamento.falhaAoRemover.add(travado.chaves[1]!)

    await expect(expurgar()).rejects.toThrow(/continuam com o conteúdo guardado/)

    // Nada marcado no travado: a próxima execução tenta de novo. O primeiro
    // arquivo já saiu, e isso não é problema — `remover` é idempotente.
    const pendente = await estado(travado.id)
    expect(pendente.conteudo).not.toBeNull()
    expect(pendente.conteudoExpurgadoEm).toBeNull()
    expect(pendente.anexos.every((anexo) => anexo.chaveArmazenamento !== null)).toBe(true)
    expect(armazenamento.arquivos.has(travado.chaves[1]!)).toBe(true)

    expect((await estado(livre.id)).conteudo).toBeNull()
  })

  it('sem armazenamento, e-mail com anexo não é marcado — sem anexo, segue', async () => {
    const comAnexo = await emailDeTeste({ recebidoHa: 30, anexos: 1 })
    const semAnexo = await emailDeTeste({ recebidoHa: 30 })

    await expect(expurgar({ armazenamento: null })).rejects.toThrow(/continuam com o conteúdo guardado/)

    expect((await estado(comAnexo.id)).conteudoExpurgadoEm).toBeNull()
    expect((await estado(semAnexo.id)).conteudo).toBeNull()
  })

  it('recusa prazo inválido sem tocar em nada', async () => {
    const email = await emailDeTeste({ recebidoHa: 30 })

    for (const dias of [0, -1, Number.NaN]) {
      await expect(expurgar({ diasDeRetencao: dias })).rejects.toThrow(/Prazo de retenção inválido/)
    }

    expect((await estado(email.id)).conteudo).not.toBeNull()
  })
})
