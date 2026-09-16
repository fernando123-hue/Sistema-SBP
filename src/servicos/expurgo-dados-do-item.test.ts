import { beforeEach, describe, expect, it } from 'vitest'

import { deslocarDias } from '../core/util/datas'
import { protegerCpf } from '../servidor/cpf-protegido'
import { obterPrisma } from '../servidor/prisma'
import { DATA_BASE, limparTudo, semearBase, type BaseSemeada } from '../testes/apoio'
import { expurgarDadosDosItens } from './expurgo-dados-do-item'
import { medirQualidadeDaIa } from './qualidade'
import { rodarLimpezaDiaria } from './rotinas'

/**
 * `A23(a)`: o que a IA extraiu, o título do item e os valores da revisão saem
 * pelo mesmo relógio do texto do e-mail (`A20`). Item registrado à mão conta da
 * própria conclusão (`A40`, resposta 23). Ficam a chave de busca, a carga, a
 * trilha e a observação escrita ao concluir (`A41`, resposta 27).
 *
 * Nome, CPF e matrícula são sintéticos.
 */

const banco = obterPrisma()
const NOME = 'Helena Prado Sintética'
const CPF = '111.444.777-35'

let base: BaseSemeada
let contador = 0

beforeEach(async () => {
  await limparTudo(banco)
  base = await semearBase(banco, { totalDeDias: 1 })
})

/** Meio-dia em Brasília do dia `desloc` dias a partir de hoje. */
function meioDia(desloc: number): Date {
  return new Date(`${deslocarDias(DATA_BASE, desloc)}T12:00:00-03:00`)
}

function payloadComDados(): string {
  return JSON.stringify({
    campos: { nome: NOME, cpf: CPF },
    camposAusentes: ['crm', CPF],
    ligaMencionada: `Liga da ${NOME}`,
    observacao: `${NOME} ligou`,
    revisadoPorHumano: true,
  })
}

async function emailComItens(opcoes: {
  textoApagado: boolean
  itens: number
  codigo?: string
  ligaNome?: string
}) {
  contador += 1
  const categoria = await banco.categoria.findUniqueOrThrow({
    where: { codigo: opcoes.codigo ?? 'DOC_CADASTRO' },
  })
  const liga = opcoes.ligaNome ? await banco.liga.create({ data: { nome: opcoes.ligaNome } }) : null

  const email = await banco.email.create({
    data: {
      messageId: `<dados-do-item-${contador}@exemplo.test>`,
      recebidoEm: meioDia(-30),
      conteudoExpurgadoEm: opcoes.textoApagado ? meioDia(-1) : null,
      ...(opcoes.textoApagado
        ? {}
        : {
            conteudo: {
              create: { remetente: 'remetente@exemplo.test', assunto: 'Assunto sintético', corpo: 'Corpo sintético' },
            },
          }),
    },
  })

  const itens = []
  for (let posicao = 1; posicao <= opcoes.itens; posicao += 1) {
    const item = await banco.item.create({
      data: {
        emailId: email.id,
        categoriaId: categoria.id,
        ligaId: liga?.id ?? null,
        sequencia: posicao,
        titulo: `Inscrição de ${NOME} ${posicao}`,
        payload: payloadComDados(),
        status: 'concluido',
        confianca: 0.9,
        modeloIa: 'duble',
        cpfProtegido: protegerCpf(CPF),
        matricula: '12345',
      },
    })
    // Concluído DE VERDADE, com registro de conclusão: sem ele o item conta como
    // aberto ("na dúvida, fica") e não perde os dados.
    await banco.execucao.create({
      data: {
        itemId: item.id,
        colaboradorId: base.colaboradores[0]!.id,
        concluidoEm: meioDia(-10),
        resultado: 'concluido',
      },
    })
    itens.push(item)
  }
  return { email, itens }
}

async function itemAMao(opcoes: { status: string; concluidoHa?: number; canceladoHa?: number }) {
  const categoria = await banco.categoria.findUniqueOrThrow({ where: { codigo: 'INADIMP' } })
  const item = await banco.item.create({
    data: {
      emailId: null,
      categoriaId: categoria.id,
      titulo: `Ligação de ${NOME} sobre anuidade`,
      payload: JSON.stringify({
        campos: {},
        camposAusentes: [],
        ligaMencionada: null,
        observacao: `CPF ${CPF}, pediu segunda via`,
        revisadoPorHumano: true,
      }),
      status: opcoes.status,
      confianca: 1,
      canceladoEm: opcoes.canceladoHa === undefined ? null : meioDia(-opcoes.canceladoHa),
    },
  })
  if (opcoes.concluidoHa !== undefined) {
    await banco.execucao.create({
      data: {
        itemId: item.id,
        colaboradorId: base.colaboradores[0]!.id,
        concluidoEm: meioDia(-opcoes.concluidoHa),
        resultado: 'concluido',
        observacao: 'Observação de conclusão sintética',
      },
    })
  }
  return item
}

function expurgar() {
  return expurgarDadosDosItens(banco, { diasDeRetencao: 7, hoje: DATA_BASE })
}

describe('item de e-mail cujo texto já saiu', () => {
  it('o título vira neutro e o que a IA extraiu sai; a chave de busca fica', async () => {
    const { itens } = await emailComItens({ textoApagado: true, itens: 1 })

    const resultado = await expurgar()
    expect(resultado.apagados).toBe(1)

    const depois = await banco.item.findUniqueOrThrow({ where: { id: itens[0]!.id } })
    expect(depois.titulo).toBe('Doc. Cadastro')
    expect(depois.dadosExtraidosExpurgadosEm).not.toBeNull()
    expect(JSON.parse(depois.payload)).toEqual({
      campos: {},
      camposAusentes: ['crm', 'outro'],
      ligaMencionada: null,
      observacao: null,
      revisadoPorHumano: true,
    })
    expect(`${depois.titulo}${depois.payload}`).not.toContain('Helena')
    expect(`${depois.titulo}${depois.payload}`).not.toContain('111.444')
    // É o que sobra para achar o item depois (`A23(b)`).
    expect(depois.cpfProtegido).toBe(protegerCpf(CPF))
    expect(depois.matricula).toBe('12345')
  })

  it('vários itens com liga: categoria · liga · posição', async () => {
    const { itens } = await emailComItens({
      textoApagado: true,
      itens: 2,
      codigo: 'LIGANTE',
      ligaNome: 'Liga Sintética de Neonatologia',
    })

    await expurgar()

    const titulos = await banco.item.findMany({
      where: { id: { in: itens.map((item) => item.id) } },
      orderBy: { sequencia: 'asc' },
      select: { titulo: true },
    })
    expect(titulos.map((linha) => linha.titulo)).toEqual([
      'Ligante · Liga Sintética de Neonatologia · 1',
      'Ligante · Liga Sintética de Neonatologia · 2',
    ])
  })

  it('item ainda aberto não perde os dados, mesmo com o texto do e-mail apagado', async () => {
    // Segunda trava. Hoje nenhum caminho apaga o texto de um e-mail com item
    // aberto, mas essa garantia mora em outro serviço — e um cancelamento ou
    // reenvio futuro (`A27`, `A28`) poderia quebrá-la sem ninguém ver.
    // Revisão de segurança de 13/09/2026.
    const { itens } = await emailComItens({ textoApagado: true, itens: 1 })
    await banco.execucao.deleteMany({ where: { itemId: itens[0]!.id } })
    await banco.item.update({ where: { id: itens[0]!.id }, data: { status: 'distribuido' } })

    const resultado = await expurgar()

    expect(resultado.apagados).toBe(0)
    expect((await banco.item.findUniqueOrThrow({ where: { id: itens[0]!.id } })).titulo).toContain('Helena')
  })

  it('enquanto o texto do e-mail existe, nada do item sai', async () => {
    const { itens } = await emailComItens({ textoApagado: false, itens: 1 })

    const resultado = await expurgar()

    expect(resultado.apagados).toBe(0)
    const depois = await banco.item.findUniqueOrThrow({ where: { id: itens[0]!.id } })
    expect(depois.titulo).toContain('Helena')
    expect(depois.dadosExtraidosExpurgadosEm).toBeNull()
  })
})

describe('revisão do item', () => {
  it('ganha o acerto que faltava ANTES de os valores saírem, e fica só com o que não é pessoal', async () => {
    const { itens } = await emailComItens({ textoApagado: true, itens: 1 })
    // Resolvida antes de o acerto passar a ser gravado na hora: sem `desfecho`.
    const revisao = await banco.revisao.create({
      data: {
        itemId: itens[0]!.id,
        motivo: 'baixa_confianca',
        campoIncerto: CPF,
        confianca: 0.4,
        sugestaoIa: JSON.stringify({
          categoriaCodigo: 'DOC_CADASTRO',
          titulo: `Inscrição de ${NOME}`,
          confianca: 0.4,
          campos: { cpf: '111.444.777-36' },
        }),
        valorFinal: JSON.stringify({
          categoriaCodigo: 'DOC_CADASTRO',
          titulo: `Inscrição de ${NOME}`,
          campos: { cpf: CPF },
          aprovado: true,
          itensExtras: 0,
        }),
        resolvidoPor: base.operador.colaboradorId,
        resolvidoEm: meioDia(-20),
      },
    })

    await expurgar()

    const depois = await banco.revisao.findUniqueOrThrow({ where: { id: revisao.id } })
    // Sem gravar antes, a comparação de depois veria vazio contra vazio e
    // contaria acerto — foi o vermelho da parte (c).
    expect(depois.desfecho).toBe('campos_corrigidos')
    expect(JSON.parse(depois.sugestaoIa)).toEqual({ categoriaCodigo: 'DOC_CADASTRO', confianca: 0.4 })
    expect(JSON.parse(depois.valorFinal!)).toEqual({ categoriaCodigo: 'DOC_CADASTRO', aprovado: true, itensExtras: 0 })
    expect(depois.campoIncerto).toBe('outro')

    const texto = `${depois.sugestaoIa}${depois.valorFinal}${depois.correcoes}${depois.campoIncerto}`
    expect(texto).not.toContain('Helena')
    expect(texto).not.toContain('111.444')

    const qualidade = await medirQualidadeDaIa(banco, null)
    expect(qualidade.taxa.porDesfecho.campos_corrigidos).toBe(1)
    expect(qualidade.ignoradas).toBe(0)
  })
})

describe('revisão ainda aberta', () => {
  it('segura os dados do item: quem vai revisar ainda precisa deles', async () => {
    const { itens } = await emailComItens({ textoApagado: true, itens: 1 })
    await banco.revisao.create({
      data: {
        itemId: itens[0]!.id,
        motivo: 'baixa_confianca',
        confianca: 0.4,
        sugestaoIa: JSON.stringify({
          categoriaCodigo: 'DOC_CADASTRO',
          titulo: `Inscrição de ${NOME}`,
          confianca: 0.4,
          campos: { cpf: CPF },
        }),
      },
    })

    const resultado = await expurgar()

    expect(resultado.apagados).toBe(0)
    const revisao = await banco.revisao.findFirstOrThrow({ where: { itemId: itens[0]!.id } })
    expect(revisao.sugestaoIa).toContain('Helena')
  })
})

describe('justificativas de transferência e devolução (A40, resposta 25)', () => {
  it('saem com os dados do item; a atribuição fica', async () => {
    const { itens } = await emailComItens({ textoApagado: true, itens: 1 })
    const pessoa = base.colaboradores[0]!.id
    const atribuicao = await banco.atribuicao.create({
      data: {
        itemId: itens[0]!.id,
        colaboradorId: pessoa,
        motivo: 'devolucao',
        atribuidoPor: pessoa,
        ativa: null,
        encerradoEm: meioDia(-10),
        justificativas: {
          create: [
            { motivo: 'transferencia', texto: `${NOME} pediu para falar com a colega` },
            { motivo: 'devolucao', texto: 'Não é da minha alçada.' },
          ],
        },
      },
    })

    await expurgar()

    expect(await banco.justificativaDeAtribuicao.count({ where: { atribuicaoId: atribuicao.id } })).toBe(0)
    expect(await banco.atribuicao.count({ where: { id: atribuicao.id } })).toBe(1)
  })
})

describe('item registrado à mão (A40, resposta 23)', () => {
  it('conta da própria conclusão: com 7 dias sai, com 6 fica, aberto fica', async () => {
    const venceu = await itemAMao({ status: 'concluido', concluidoHa: 7 })
    const aindaNao = await itemAMao({ status: 'concluido', concluidoHa: 6 })
    const aberto = await itemAMao({ status: 'distribuido' })

    await expurgar()

    const saiu = await banco.item.findUniqueOrThrow({ where: { id: venceu.id } })
    expect(saiu.titulo).toBe('Inadimplente')
    expect(JSON.parse(saiu.payload).observacao).toBeNull()
    expect(saiu.dadosExtraidosExpurgadosEm).not.toBeNull()

    expect((await banco.item.findUniqueOrThrow({ where: { id: aindaNao.id } })).titulo).toContain('Helena')
    expect((await banco.item.findUniqueOrThrow({ where: { id: aberto.id } })).titulo).toContain('Helena')
  })

  it('cancelado conta do cancelamento', async () => {
    const cancelado = await itemAMao({ status: 'cancelado', canceladoHa: 7 })

    await expurgar()

    expect((await banco.item.findUniqueOrThrow({ where: { id: cancelado.id } })).titulo).toBe('Inadimplente')
  })

  it('a observação escrita ao concluir fica guardada (A41, resposta 27)', async () => {
    const venceu = await itemAMao({ status: 'concluido', concluidoHa: 30 })

    await expurgar()

    const execucao = await banco.execucao.findFirstOrThrow({ where: { itemId: venceu.id } })
    expect(execucao.observacao).toBe('Observação de conclusão sintética')
  })
})

describe('trilha e repetição', () => {
  it('a trilha diz que os dados saíram, sem título nem valores; rodar de novo não refaz', async () => {
    const { itens } = await emailComItens({ textoApagado: true, itens: 1 })

    const primeira = await expurgar()
    const segunda = await expurgar()

    expect(primeira.apagados).toBe(1)
    expect(segunda.apagados).toBe(0)

    const linhas = await banco.logAuditoria.findMany({ where: { acao: 'dados_do_item_expurgados' } })
    expect(linhas).toHaveLength(1)
    expect(linhas[0]!.entidadeId).toBe(itens[0]!.id)
    const texto = `${linhas[0]!.antes ?? ''}${linhas[0]!.depois ?? ''}`
    expect(texto).not.toContain('Helena')
    expect(texto).not.toContain('111.444')
  })

  it('a limpeza diária também tira os dados dos itens', async () => {
    const { itens } = await emailComItens({ textoApagado: true, itens: 1 })

    const resultado = await rodarLimpezaDiaria(banco, { hoje: DATA_BASE })

    if (!resultado.executou || resultado.situacao !== 'sucesso') throw new Error('esperava sucesso')
    expect(resultado.resumo.dadosDosItens).toMatchObject({ apagados: 1, prazoEmDias: 7 })
    expect((await banco.item.findUniqueOrThrow({ where: { id: itens[0]!.id } })).titulo).toBe('Doc. Cadastro')
  })
})
