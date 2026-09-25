import { beforeEach, describe, expect, it } from 'vitest'

import { TAMANHO_MAXIMO_DA_NOTA } from '../core/esquemas'
import { LIMITE_DE_NOTAS_EXIBIDAS } from '../core/notas'
import { obterPrisma } from '../servidor/prisma'
import { atorDeTeste, limparTudo, semearBase } from '../testes/apoio'
import { LIMITE_DA_LISTAGEM, arquivar, listar, paraContexto, registrar } from './notas'

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

/**
 * Busca-ou-cria, nunca cria direto.
 *
 * `limparTudo` NÃO apaga `Liga` — nenhum teste do repositório apaga — então um
 * `create` puro estoura no índice único `[nome, instituicao]` assim que o mesmo
 * arquivo roda duas vezes contra o mesmo banco. Em `vitest run` isso não
 * aparece (o `globalSetup` recria `teste.db` a cada invocação); em modo watch,
 * a segunda execução falha. Mesma forma do helper de `agrupamento.test.ts`.
 */
async function ligaDeTeste(nome = 'Liga Acadêmica Sintética') {
  const instituicao = `Instituição ${nome}`
  return (
    (await banco.liga.findFirst({ where: { nome, instituicao } })) ??
    (await banco.liga.create({ data: { nome, instituicao } }))
  )
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

  it('nada é gravado quando a transação aborta — invariante 14', async () => {
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

    await expect(arquivar(banco, nota.id, {}, outra.ator)).rejects.toMatchObject({ name: 'PermissaoNegadaError' })

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

  it('contexto vazio NÃO devolve nota de categoria — só as do setor inteiro', async () => {
    // Esta é a garantia que a ROTA anulava por fora. Três das quatro telas
    // pedem com contexto vazio; enquanto o padrão do `GET` era a listagem
    // plana, elas recebiam também as notas presas a categorias em que a pessoa
    // não estava trabalhando — e o núcleo seguia verde, porque o defeito não
    // estava na regra, estava em quem a chamava.
    const base = await semearBase(banco, { totalDeDias: 1 })
    const ator = base.colaboradores[0]!.ator

    await registrar(banco, { texto: 'Só para DOC.', categoriaCodigo: 'DOC_CADASTRO' }, ator)
    await registrar(banco, { texto: 'Para o setor inteiro.' }, ator)

    expect((await paraContexto(banco, {})).map((linha) => linha.texto)).toEqual([
      'Para o setor inteiro.',
    ])

    // E a listagem plana continua devolvendo as duas — ela existe para
    // administrar a memória, e é por isso que virou o modo que precisa ser
    // pedido por escrito (`?todas=1`).
    expect((await listar(banco)).notas).toHaveLength(2)
  })

  it('arquivada não orienta ninguém, mas continua listável', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!

    const nota = await registrar(banco, { texto: 'Aviso vencido.' }, pessoa.ator)
    await arquivar(banco, nota.id, {}, pessoa.ator)

    expect(await paraContexto(banco, {})).toEqual([])
    expect((await listar(banco)).notas).toEqual([])
    expect((await listar(banco, { incluirArquivadas: true })).notas.map((linha) => linha.texto)).toEqual([
      'Aviso vencido.',
    ])
  })
})
describe('a leitura tem teto, e o teto não troca a nota certa por outra (achado C-16)', () => {
  /**
   * Notas em lote, direto no banco: `registrar` passaria pela trilha uma a
   * uma, e o que se testa aqui é a LEITURA com muitas linhas vivas.
   * `criadoEm` crescente e explícito, para a ordem não depender do relógio.
   */
  async function notasGerais(quantas: number, autorId: string, desde: Date) {
    await banco.nota.createMany({
      data: Array.from({ length: quantas }, (_, indice) => ({
        texto: `Nota geral sintética ${indice}`,
        autorId,
        criadoEm: new Date(desde.getTime() + (indice + 1) * 1000),
      })),
    })
  }

  it('muitas notas gerais novas não empurram para fora a nota antiga da categoria, e o banco não é lido inteiro', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!
    const doc = await banco.categoria.findUniqueOrThrow({ where: { codigo: 'DOC_CADASTRO' } })
    const antes = new Date('2026-01-01T00:00:00Z')

    // A nota da categoria é a MAIS ANTIGA de todas: um `take` único, ordenado
    // por data, é exatamente o que a descartaria em silêncio.
    await banco.nota.create({
      data: { texto: 'Vale para DOC.', categoriaId: doc.id, autorId: pessoa.id, criadoEm: antes },
    })
    await notasGerais(LIMITE_DE_NOTAS_EXIBIDAS + 50, pessoa.id, antes)

    // `vi.spyOn(banco.nota, ...)` não serve: o Prisma entrega um objeto
    // `nota` novo a cada acesso, e o espião ficaria num que ninguém usa.
    const consultas: { take: number | undefined }[] = []
    const espiao = new Proxy(banco, {
      get(alvo, chave, receptor) {
        if (chave !== 'nota') return Reflect.get(alvo, chave, receptor)
        return {
          findMany: (argumentos: Parameters<typeof banco.nota.findMany>[0]) => {
            consultas.push({ take: argumentos?.take })
            return alvo.nota.findMany(argumentos)
          },
        }
      },
    })
    const notas = await paraContexto(espiao, { categoriaId: doc.id })

    expect(notas.map((linha) => linha.texto)[0]).toBe('Vale para DOC.')
    expect(notas).toHaveLength(LIMITE_DE_NOTAS_EXIBIDAS)
    // E as gerais que sobram são as MAIS RECENTES — o teto por faixa devolve
    // o mesmo que a leitura inteira devolvia.
    expect(notas[1]!.texto).toBe(`Nota geral sintética ${LIMITE_DE_NOTAS_EXIBIDAS + 49}`)
    // Toda consulta ao banco tem teto: a leitura não cresce com o volume.
    expect(consultas.length).toBeGreaterThan(0)
    for (const consulta of consultas) {
      expect(consulta.take).toBeLessThanOrEqual(LIMITE_DE_NOTAS_EXIBIDAS)
    }
  })

  it('notas da liga certa presas a outra categoria não gastam o teto da faixa da liga', async () => {
    // A faixa da liga é PRECISA (liga do contexto E categoria nula ou a do
    // contexto) por causa deste caso: com um filtro largo por liga, as notas
    // presas a outra categoria — que a seleção elimina — ocupariam o `take`, e
    // a nota válida, mais antiga, ficaria de fora sem ninguém saber.
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!
    const liga = await ligaDeTeste()
    const doc = await banco.categoria.findUniqueOrThrow({ where: { codigo: 'DOC_CADASTRO' } })
    const outra = await banco.categoria.findUniqueOrThrow({ where: { codigo: 'EMAIL_CADASTRO' } })
    const antes = new Date('2026-01-01T00:00:00Z')

    await banco.nota.create({
      data: { texto: 'Vale para esta liga.', ligaId: liga.id, autorId: pessoa.id, criadoEm: antes },
    })
    await banco.nota.createMany({
      data: Array.from({ length: LIMITE_DE_NOTAS_EXIBIDAS + 5 }, (_, indice) => ({
        texto: `Da liga, mas de outra categoria ${indice}`,
        ligaId: liga.id,
        categoriaId: outra.id,
        autorId: pessoa.id,
        criadoEm: new Date(antes.getTime() + (indice + 1) * 1000),
      })),
    })

    const notas = await paraContexto(banco, { categoriaId: doc.id, ligaId: liga.id })

    expect(notas.map((linha) => linha.texto)).toEqual(['Vale para esta liga.'])
  })

  it('a listagem plana corta no teto e AVISA que cortou', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!
    await notasGerais(LIMITE_DA_LISTAGEM + 1, pessoa.id, new Date('2026-01-01T00:00:00Z'))

    const listagem = await listar(banco)

    expect(listagem.notas).toHaveLength(LIMITE_DA_LISTAGEM)
    expect(listagem.truncado).toBe(true)
    // As mais recentes primeiro — o corte leva as mais antigas.
    expect(listagem.notas[0]!.texto).toBe(`Nota geral sintética ${LIMITE_DA_LISTAGEM}`)
  })

  it('sem corte, a listagem diz que não cortou', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    await notasGerais(3, base.colaboradores[0]!.id, new Date('2026-01-01T00:00:00Z'))

    expect(await listar(banco)).toMatchObject({ truncado: false })
  })
})
