import { beforeEach, describe, expect, it } from 'vitest'

import { LIMITE_ITENS_POR_REGISTRO_MANUAL } from '../core/esquemas'
import { sequenciaDeDatas } from '../core/util/datas'
import { obterPrisma } from '../servidor/prisma'
import { DATA_BASE, atorDeTeste, limparTudo, semearBase } from '../testes/apoio'
import { confirmar } from './distribuicao'
import { listarCaixa } from './caixa'
import { concluir, minhaFila } from './fila'
import { registrarManual } from './itens'
import { porCategoria } from './painel'
import { medirQualidadeDaIa } from './qualidade'

/**
 * Registro manual de item (`H-D4`).
 *
 * O que estes testes protegem não é a criação em si — é o motivo dela existir.
 * `INADIMP.` e `ISENTO` estavam no cadastro e eram inalcançáveis: a IA não pode
 * classificá-las, o motor as ignora, e não havia rota nenhuma que as criasse.
 * Duas colunas da planilha sem correspondente aqui dentro.
 *
 * O risco desta entrega é criar um item que ninguém consegue concluir — ele
 * ficaria pendente para sempre e o painel divergiria da planilha crescendo
 * sozinho, todo dia, sem que ninguém tivesse errado nada. Metade dos testes
 * abaixo existe para provar que esse estado é impossível de alcançar.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

describe('quem pode registrar', () => {
  it('colaborador não registra — inflar a própria carga seria trivial', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!

    await expect(
      registrarManual(
        banco,
        { categoriaCodigo: 'INADIMP', titulo: 'Inadimplente', colaboradorId: pessoa.id },
        pessoa.ator,
      ),
    ).rejects.toThrow(/permissão|papel/i)

    expect(await banco.item.count()).toBe(0)
  })

  it('operador registra', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    const feito = await registrarManual(
      banco,
      {
        categoriaCodigo: 'INADIMP',
        titulo: 'Associado inadimplente',
        colaboradorId: base.colaboradores[0]!.id,
      },
      base.operador,
    )

    expect(feito.itensCriados).toHaveLength(1)
    expect(feito.responsavel?.nome).toBe(base.colaboradores[0]!.nome)
  })
})

describe('categoria fora do rateio exige responsável', () => {
  it('sem responsável, recusa — o item nasceria pendente para sempre', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    await expect(
      registrarManual(
        banco,
        { categoriaCodigo: 'ISENTO', titulo: 'Associado isento' },
        base.operador,
      ),
    ).rejects.toThrow(/fora do rateio/i)

    expect(await banco.item.count()).toBe(0)
  })

  it('com responsável, o item nasce na fila dele e é concluível', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!

    const feito = await registrarManual(
      banco,
      { categoriaCodigo: 'INADIMP', titulo: 'Associado inadimplente', colaboradorId: pessoa.id },
      base.operador,
    )

    const itemId = feito.itensCriados[0]!

    const fila = await minhaFila(banco, pessoa.id, pessoa.ator)
    expect(fila.map((linha) => linha.itemId)).toContain(itemId)
    expect(fila[0]!.remetente).toBeNull()

    // A prova que interessa: o caminho até "concluído" existe de ponta a ponta.
    // Sem a atribuição no nascimento, `concluir` recusaria por falta de
    // responsável ativo e o item seria pendência eterna.
    await concluir(banco, { itemId }, pessoa.ator)

    const depois = await banco.item.findUniqueOrThrow({ where: { id: itemId } })
    expect(depois.status).toBe('concluido')
  })

  it('a atribuição é `manual` e não aponta para rodada nenhuma', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    const feito = await registrarManual(
      banco,
      {
        categoriaCodigo: 'INADIMP',
        titulo: 'Associado inadimplente',
        colaboradorId: base.colaboradores[0]!.id,
      },
      base.operador,
    )

    const atribuicao = await banco.atribuicao.findFirstOrThrow({
      where: { itemId: feito.itensCriados[0]! },
    })

    expect(atribuicao.motivo).toBe('manual')
    // Inventar uma rodada faria a conferência de conservação comparar a soma
    // de atribuições com uma quantidade de entrada que nunca existiu.
    expect(atribuicao.rodadaId).toBeNull()
    expect(atribuicao.atribuidoPor).toBe(base.operadorId)
    expect(atribuicao.ativa).toBe(true)
  })

  it('responsável desligado é recusado — ninguém poderia concluir', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!
    await banco.colaborador.update({ where: { id: pessoa.id }, data: { ativo: false } })

    await expect(
      registrarManual(
        banco,
        { categoriaCodigo: 'INADIMP', titulo: 'Inadimplente', colaboradorId: pessoa.id },
        base.operador,
      ),
    ).rejects.toThrow(/desligado/i)

    expect(await banco.item.count()).toBe(0)
  })

  it('habilitação NÃO é exigida — ninguém é habilitado nessas categorias', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!

    // `semearBase` habilita só as categorias do rateio, como o seed real.
    const habilitacoes = await banco.habilitacao.count({
      where: { colaboradorId: pessoa.id, categoria: { codigo: 'INADIMP' } },
    })
    expect(habilitacoes).toBe(0)

    const feito = await registrarManual(
      banco,
      { categoriaCodigo: 'INADIMP', titulo: 'Inadimplente', colaboradorId: pessoa.id },
      base.operador,
    )
    expect(feito.itensCriados).toHaveLength(1)
  })
})

describe('categoria do rateio recusa responsável escolhido a dedo', () => {
  it('escolher a pessoa seria a porta lateral que o motor existe para fechar', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    await expect(
      registrarManual(
        banco,
        {
          categoriaCodigo: 'DOC_CADASTRO',
          titulo: 'Documento entregue no balcão',
          colaboradorId: base.colaboradores[0]!.id,
        },
        base.operador,
      ),
    ).rejects.toThrow(/rateio diário/i)

    expect(await banco.item.count()).toBe(0)
  })

  it('sem responsável, entra no pool e o motor distribui na próxima rodada', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)

    const feito = await registrarManual(
      banco,
      { categoriaCodigo: 'DOC_CADASTRO', titulo: 'Documento entregue no balcão', quantidade: 3 },
      base.operador,
    )

    const criados = await banco.item.findMany({ where: { id: { in: feito.itensCriados } } })
    expect(criados.every((item) => item.status === 'aprovado')).toBe(true)
    expect(criados.every((item) => item.emailId === null)).toBe(true)

    await confirmar(banco, { data: datas[0]!, categorias: ['DOC_CADASTRO'] }, base.operador)

    const distribuidos = await banco.atribuicao.count({
      where: { itemId: { in: feito.itensCriados }, ativa: true },
    })
    expect(distribuidos).toBe(3)
  })
})

describe('quantidade', () => {
  it('um lançamento de 11 vira 11 itens rastreáveis, como a linha 35 da planilha', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    const feito = await registrarManual(
      banco,
      {
        categoriaCodigo: 'INADIMP',
        titulo: 'Associado inadimplente',
        quantidade: 11,
        colaboradorId: base.colaboradores[0]!.id,
      },
      base.operador,
    )

    expect(feito.itensCriados).toHaveLength(11)
    expect(new Set(feito.itensCriados).size).toBe(11)
    // Cada um com responsável próprio: a fila mostra onze linhas, não "11".
    expect(
      await banco.atribuicao.count({ where: { itemId: { in: feito.itensCriados }, ativa: true } }),
    ).toBe(11)
  })

  it('o teto inteiro cabe numa transação só', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    // 50 itens são 150 escritas (item + atribuição + auditoria) dentro de UMA
    // transação. Se o teto não coubesse no tempo limite do Prisma, o lançamento
    // maior permitido falharia em produção e passaria despercebido aqui, onde
    // os testes usam quantidades pequenas.
    const feito = await registrarManual(
      banco,
      {
        categoriaCodigo: 'INADIMP',
        titulo: 'Inadimplente',
        quantidade: LIMITE_ITENS_POR_REGISTRO_MANUAL,
        colaboradorId: base.colaboradores[0]!.id,
      },
      base.operador,
    )

    expect(feito.itensCriados).toHaveLength(LIMITE_ITENS_POR_REGISTRO_MANUAL)
  })

  it('acima do teto, recusa inteira — 111 no lugar de 11 tem de doer', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    await expect(
      registrarManual(
        banco,
        {
          categoriaCodigo: 'INADIMP',
          titulo: 'Inadimplente',
          quantidade: LIMITE_ITENS_POR_REGISTRO_MANUAL + 1,
          colaboradorId: base.colaboradores[0]!.id,
        },
        base.operador,
      ),
    ).rejects.toThrow()

    expect(await banco.item.count()).toBe(0)
  })

  it('categoria inativa não deixa meio lançamento no banco', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    await banco.categoria.update({ where: { codigo: 'INADIMP' }, data: { ativa: false } })

    // A recusa sai ANTES de o primeiro item existir. Criar quatro e falhar no
    // quinto deixaria o operador sem saber quantos passaram — e a transação
    // desfaz, mas só porque a conferência é feita fora do laço.
    await expect(
      registrarManual(
        banco,
        {
          categoriaCodigo: 'INADIMP',
          titulo: 'Inadimplente',
          quantidade: 5,
          colaboradorId: base.colaboradores[0]!.id,
        },
        base.operador,
      ),
    ).rejects.toThrow(/inativa/i)

    expect(await banco.item.count()).toBe(0)
  })
})

describe('o que o registro manual NÃO faz', () => {
  it('não move o livro-razão de crédito', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    await registrarManual(
      banco,
      {
        categoriaCodigo: 'INADIMP',
        titulo: 'Inadimplente',
        quantidade: 8,
        colaboradorId: base.colaboradores[0]!.id,
      },
      base.operador,
    )

    // Se contasse, quem registrasse muitos inadimplentes apareceria credor e
    // passaria a receber MENOS trabalho das categorias reais. Ver AT-09.
    expect(await banco.saldoCarga.count()).toBe(0)
    expect(await banco.saldoCargaGlobal.count()).toBe(0)
  })

  it('não nasce concluído — a conclusão continua sendo ato do responsável', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    const feito = await registrarManual(
      banco,
      {
        categoriaCodigo: 'INADIMP',
        titulo: 'Inadimplente',
        colaboradorId: base.colaboradores[0]!.id,
      },
      base.operador,
    )

    expect(await banco.execucao.count()).toBe(0)
    const item = await banco.item.findUniqueOrThrow({ where: { id: feito.itensCriados[0]! } })
    expect(item.status).toBe('distribuido')
  })

  it('não entra no denominador da taxa de acerto da IA', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    await registrarManual(
      banco,
      {
        categoriaCodigo: 'INADIMP',
        titulo: 'Inadimplente',
        quantidade: 5,
        colaboradorId: base.colaboradores[0]!.id,
      },
      base.operador,
    )

    // `confianca: 1` num item que nenhum modelo tocou entraria como cinco
    // acertos de graça se `modeloIa` não ficasse nulo.
    const qualidade = await medirQualidadeDaIa(banco)
    expect(qualidade.cobertura.itensDeIa).toBe(0)
  })
})

describe('caixa de entrada', () => {
  it('o item manual não se apresenta como classificação da IA', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })

    await registrarManual(
      banco,
      {
        categoriaCodigo: 'INADIMP',
        titulo: 'Inadimplente',
        colaboradorId: base.colaboradores[0]!.id,
      },
      base.operador,
    )

    const [linha] = await listarCaixa(banco)

    // `confianca: 1` é o que o banco guarda, mas a tela não pode ler isso como
    // "a IA acertou com 100% de certeza" — modelo nenhum olhou para este item.
    expect(linha!.confianca).toBe(1)
    expect(linha!.classificadaPorIa).toBe(false)
    expect(linha!.remetente).toBeNull()
  })
})

describe('painel', () => {
  it('o item manual aparece na categoria certa e some da pendência ao concluir', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const pessoa = base.colaboradores[0]!
    const hoje = new Date().toISOString().slice(0, 10)
    const periodo = { de: hoje, ate: hoje }

    const feito = await registrarManual(
      banco,
      {
        categoriaCodigo: 'INADIMP',
        titulo: 'Associado inadimplente',
        quantidade: 4,
        colaboradorId: pessoa.id,
      },
      base.operador,
    )

    const linhaDe = async () =>
      (await porCategoria(banco, periodo)).find((linha) => linha.categoriaCodigo === 'INADIMP')!

    const antes = await linhaDe()
    expect(antes.entrouNoPeriodo).toBe(4)
    expect(antes.pendente).toBe(4)

    for (const itemId of feito.itensCriados) {
      await concluir(banco, { itemId }, pessoa.ator)
    }

    const depois = await linhaDe()
    expect(depois.concluidoNoPeriodo).toBe(4)
    expect(depois.pendente).toBe(0)
  })
})

describe('auditoria', () => {
  it('cada item registrado deixa linha com quem registrou', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const gestor = await banco.colaborador.create({
      data: { nome: 'Gestora de Teste', email: 'gestora@teste.local', papel: 'gestor' },
    })

    const feito = await registrarManual(
      banco,
      {
        categoriaCodigo: 'ISENTO',
        titulo: 'Associado isento',
        quantidade: 3,
        colaboradorId: base.colaboradores[0]!.id,
        observacao: 'Lançamento de fechamento do dia',
      },
      atorDeTeste(gestor.id, 'gestor'),
    )

    const linhas = await banco.logAuditoria.findMany({
      where: { acao: 'item_registrado_manualmente' },
    })

    expect(linhas).toHaveLength(3)
    expect(new Set(linhas.map((linha) => linha.entidadeId))).toEqual(new Set(feito.itensCriados))
    // A identidade vem do Ator, nunca do corpo da requisição.
    expect(linhas.every((linha) => linha.usuario === gestor.id)).toBe(true)
    // Uma correlação só: as três linhas são o mesmo lançamento.
    expect(new Set(linhas.map((linha) => linha.correlacaoId)).size).toBe(1)
  })
})
