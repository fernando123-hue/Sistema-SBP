import { beforeEach, describe, expect, it } from 'vitest'

import { TAMANHO_MAXIMO_DA_NOTA } from '../core/esquemas'
import { obterPrisma } from '../servidor/prisma'
import { atorDeTeste, limparTudo, semearBase } from '../testes/apoio'
import { arquivar, listar, paraContexto, registrar } from './notas'

/**
 * Notas do setor.
 *
 * O que estes testes protegem: a memória do setor é a primeira coisa deste
 * sistema escrita por gente, sobre o próprio trabalho, para durar. Se ela
 * puder ser apagada por terceiro, nascer morta apontando para vínculo
 * inexistente, ou vazar texto para uma tabela que ninguém consegue expurgar,
 * ela deixa de ser confiável — e memória em que ninguém confia é pior que
 * memória nenhuma, porque ocupa espaço na tela e treina a equipe a ignorá-la.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

async function ligaDeTeste(nome = 'Liga Acadêmica Sintética') {
  return banco.liga.create({ data: { nome, instituicao: `Instituição ${nome}` } })
}

describe('quem escreve', () => {
  it('colaborador registra — a memória é de quem opera, não da chefia', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!

    const nota = await registrar(
      banco,
      { texto: 'Pedido de segunda via costuma vir sem o comprovante.' },
      pessoa.ator,
    )

    expect(nota.autorId).toBe(pessoa.id)
    expect(nota.autorNome).toBe(pessoa.nome)
    expect(nota.arquivadaEm).toBeNull()
  })

  it('a autoria vem do ator, nunca do corpo — invariante 5', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!
    const outra = base.colaboradores[1]!

    // O esquema de entrada não tem campo de autor. Mesmo que o cliente mande
    // um, ele é descartado, e a nota fica com a identidade da sessão.
    const nota = await registrar(
      banco,
      { texto: 'Uma nota qualquer.', autorId: outra.id, usuario: outra.id },
      pessoa.ator,
    )

    expect(nota.autorId).toBe(pessoa.id)
  })
})

describe('vínculo inexistente é recusado', () => {
  it('categoria que não existe — a nota nasceria morta', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    await expect(
      registrar(
        banco,
        { texto: 'Nota presa a uma categoria inventada.', categoriaCodigo: 'NAO_EXISTE' },
        base.colaboradores[0]!.ator,
      ),
    ).rejects.toThrow()

    expect(await banco.nota.count()).toBe(0)
  })

  it('categoria inativa — ninguém veria a nota', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    await banco.categoria.update({ where: { codigo: 'DOC_CADASTRO' }, data: { ativa: false } })

    await expect(
      registrar(
        banco,
        { texto: 'Conferir o documento antes de aprovar.', categoriaCodigo: 'DOC_CADASTRO' },
        base.colaboradores[0]!.ator,
      ),
    ).rejects.toThrow(/inativa/i)

    expect(await banco.nota.count()).toBe(0)
  })

  it('liga que não existe', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    await expect(
      registrar(
        banco,
        { texto: 'Nota presa a uma liga inventada.', ligaId: 'liga-inexistente' },
        base.colaboradores[0]!.ator,
      ),
    ).rejects.toThrow(/liga não encontrada/i)

    expect(await banco.nota.count()).toBe(0)
  })
})

describe('texto', () => {
  it('recusa texto vazio e texto acima do teto', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const ator = base.colaboradores[0]!.ator

    await expect(registrar(banco, { texto: '   ' }, ator)).rejects.toThrow()
    await expect(
      registrar(banco, { texto: 'x'.repeat(TAMANHO_MAXIMO_DA_NOTA + 1) }, ator),
    ).rejects.toThrow()

    expect(await banco.nota.count()).toBe(0)
  })
})

describe('a trilha registra a nota sem copiar o texto', () => {
  it('grava quem, quando e o vínculo — nunca o conteúdo', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!
    const segredo = 'Texto que não pode acabar numa tabela append-only.'

    const nota = await registrar(
      banco,
      { texto: segredo, categoriaCodigo: 'DOC_CADASTRO' },
      pessoa.ator,
    )

    const linha = await banco.logAuditoria.findFirstOrThrow({
      where: { entidade: 'Nota', entidadeId: nota.id, acao: 'nota_registrada' },
    })

    expect(linha.usuario).toBe(pessoa.id)
    expect(linha.dominio).toBe('distribuicao')
    // `LogAuditoria` é append-only: o que entra não pode ser arquivado nem
    // expurgado. Copiar o texto faria a nota existir em dois lugares com
    // políticas de retenção opostas, e a cópia eterna seria justamente a que
    // ninguém consegue tirar de circulação.
    expect(linha.depois).not.toContain(segredo)
    expect(linha.depois).toContain('tamanhoDoTexto')
  })

  it('nada é gravado quando a transação aborta — invariante 13', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    await expect(
      registrar(
        banco,
        { texto: 'Nota que não vai existir.', ligaId: 'liga-inexistente' },
        base.colaboradores[0]!.ator,
      ),
    ).rejects.toThrow()

    // A auditoria vive na MESMA transação do fato. Se fosse publicada antes do
    // commit, a memória afirmaria uma nota que a transação desfez.
    expect(await banco.logAuditoria.count({ where: { entidade: 'Nota' } })).toBe(0)
  })
})

describe('arquivar carimba, nunca apaga', () => {
  it('o autor arquiva a própria nota, e a linha sobrevive', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!

    const nota = await registrar(banco, { texto: 'Regra que mudou.' }, pessoa.ator)
    const arquivada = await arquivar(banco, nota.id, { motivo: 'A regra mudou em setembro.' }, pessoa.ator)

    expect(arquivada.arquivadaEm).not.toBeNull()
    expect(arquivada.motivoArquivo).toBe('A regra mudou em setembro.')
    // A pergunta "por que a equipe fazia isso em março?" continua com resposta.
    expect(await banco.nota.count()).toBe(1)
  })

  it('terceiro não arquiva nota alheia — é assim que memória compartilhada morre', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const autora = base.colaboradores[0]!
    const outra = base.colaboradores[1]!

    const nota = await registrar(banco, { texto: 'Aviso da autora.' }, autora.ator)

    await expect(arquivar(banco, nota.id, {}, outra.ator)).rejects.toThrow(/permissão|papel/i)

    const atual = await banco.nota.findUniqueOrThrow({ where: { id: nota.id } })
    expect(atual.arquivadaEm).toBeNull()
  })

  it('gestor arquiva a nota de qualquer pessoa — alguém precisa limpar a de quem saiu', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const autora = base.colaboradores[0]!
    const gestora = await banco.colaborador.create({
      data: { nome: 'Gestora de Teste', email: 'gestora.notas@teste.local', papel: 'gestor' },
    })

    const nota = await registrar(banco, { texto: 'Aviso de quem saiu.' }, autora.ator)
    const arquivada = await arquivar(
      banco,
      nota.id,
      {},
      atorDeTeste(gestora.id, 'gestor'),
    )

    expect(arquivada.arquivadaEm).not.toBeNull()
  })

  it('arquivar duas vezes não reescreve a primeira data', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!

    const nota = await registrar(banco, { texto: 'Nota.' }, pessoa.ator)
    const primeira = await arquivar(banco, nota.id, { motivo: 'primeiro motivo' }, pessoa.ator)
    const segunda = await arquivar(banco, nota.id, { motivo: 'segundo motivo' }, pessoa.ator)

    // Re-carimbar faria a trilha afirmar que a nota saiu de circulação num dia
    // em que ela já estava fora.
    expect(segunda.arquivadaEm).toEqual(primeira.arquivadaEm)
    expect(segunda.motivoArquivo).toBe('primeiro motivo')
    expect(await banco.logAuditoria.count({ where: { acao: 'nota_arquivada' } })).toBe(1)
  })
})

describe('a nota encontra o trabalho', () => {
  it('a nota da categoria aparece para aquela categoria, e a de outra não', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const ator = base.colaboradores[0]!.ator

    await registrar(banco, { texto: 'Vale para DOC.', categoriaCodigo: 'DOC_CADASTRO' }, ator)
    await registrar(banco, { texto: 'Vale para FICHA.', categoriaCodigo: 'FICHA_CADASTRO' }, ator)

    const doc = await banco.categoria.findUniqueOrThrow({ where: { codigo: 'DOC_CADASTRO' } })
    const notas = await paraContexto(banco, { categoriaId: doc.id })

    expect(notas.map((linha) => linha.texto)).toEqual(['Vale para DOC.'])
    expect(notas[0]!.categoriaRotulo).toBe(doc.rotulo)
  })

  it('a nota da liga vem antes da nota da categoria', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const ator = base.colaboradores[0]!.ator
    const liga = await ligaDeTeste()
    const doc = await banco.categoria.findUniqueOrThrow({ where: { codigo: 'DOC_CADASTRO' } })

    await registrar(banco, { texto: 'Vale para DOC.', categoriaCodigo: 'DOC_CADASTRO' }, ator)
    await registrar(banco, { texto: 'Essa liga manda a ficha separada.', ligaId: liga.id }, ator)

    const notas = await paraContexto(banco, { categoriaId: doc.id, ligaId: liga.id })

    expect(notas.map((linha) => linha.texto)).toEqual([
      'Essa liga manda a ficha separada.',
      'Vale para DOC.',
    ])
    expect(notas[0]!.ligaNome).toBe(liga.nome)
  })

  it('a nota sem vínculo aparece em todo contexto', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const ator = base.colaboradores[0]!.ator
    const doc = await banco.categoria.findUniqueOrThrow({ where: { codigo: 'DOC_CADASTRO' } })

    await registrar(banco, { texto: 'Vale para o setor inteiro.' }, ator)

    expect((await paraContexto(banco, {})).map((linha) => linha.texto)).toEqual([
      'Vale para o setor inteiro.',
    ])
    expect((await paraContexto(banco, { categoriaId: doc.id })).map((linha) => linha.texto)).toEqual(
      ['Vale para o setor inteiro.'],
    )
  })

  it('arquivada não orienta ninguém, mas continua listável', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!

    const nota = await registrar(banco, { texto: 'Aviso vencido.' }, pessoa.ator)
    await arquivar(banco, nota.id, {}, pessoa.ator)

    expect(await paraContexto(banco, {})).toEqual([])
    expect(await listar(banco)).toEqual([])
    expect((await listar(banco, { incluirArquivadas: true })).map((linha) => linha.texto)).toEqual([
      'Aviso vencido.',
    ])
  })
})
