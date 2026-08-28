import { beforeEach, describe, expect, it } from 'vitest'

import { conferirSenha } from '../servidor/credenciais'
import { obterPrisma } from '../servidor/prisma'
import { atorDeTeste, limparTudo, semearBase } from '../testes/apoio'
import { criarColaborador, definirHabilitacoes } from './colaboradores'
import { obterEscala } from './escala'

/**
 * Cadastro de pessoas e habilitação.
 *
 * O risco desta funcionalidade não é ela falhar — é ela funcionar pela metade.
 * Alguém cadastrado sem categoria não aparece na tela de plantão nem entra no
 * rateio: some da operação sem que nada acuse. Metade destes testes existe
 * para provar que esse estado é detectável, não para provar que ele é raro.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

async function baseComGestor() {
  const base = await semearBase(banco, { totalDeDias: 1 })
  const gestor = await banco.colaborador.create({
    data: { nome: 'Gestora de Teste', email: 'gestora@teste.local', papel: 'gestor' },
  })
  return { base, gestor: atorDeTeste(gestor.id, 'gestor') }
}

describe('quem pode cadastrar', () => {
  it('só gestor', async () => {
    const { base } = await baseComGestor()

    await expect(
      criarColaborador(
        banco,
        { nome: 'Fulano', email: 'fulano@teste.local', papel: 'colaborador' },
        base.operador,
      ),
    ).rejects.toThrow()
  })
})

describe('cadastro', () => {
  it('cria a pessoa com senha provisória que de fato abre a conta', async () => {
    const { gestor } = await baseComGestor()

    const criado = await criarColaborador(
      banco,
      { nome: 'Fulano Sintético', email: 'fulano@teste.local', papel: 'colaborador' },
      gestor,
    )

    const gravado = await banco.colaborador.findUnique({
      where: { id: criado.colaboradorId },
      select: { senhaHash: true, precisaTrocarSenha: true, ativo: true },
    })

    // A senha devolvida precisa realmente conferir contra o hash gravado —
    // entregar ao gestor uma senha que não abre a conta seria uma pessoa
    // cadastrada e trancada do lado de fora.
    expect(await conferirSenha(criado.senhaProvisoria, gravado!.senhaHash!)).toBe(true)
    expect(gravado!.precisaTrocarSenha).toBe(true)
    expect(gravado!.ativo).toBe(true)
  })

  it('normaliza o e-mail do mesmo jeito que a entrada', async () => {
    const { gestor } = await baseComGestor()

    const criado = await criarColaborador(
      banco,
      { nome: 'Fulano', email: '  Fulano@Exemplo.TEST  ', papel: 'colaborador' },
      gestor,
    )

    // Normalizar só na entrada criaria uma conta que existe e não abre.
    expect(criado.email).toBe('fulano@exemplo.test')
  })

  it('recusa e-mail repetido com mensagem que diz o que fazer', async () => {
    const { gestor } = await baseComGestor()
    await criarColaborador(
      banco,
      { nome: 'Fulano', email: 'fulano@teste.local', papel: 'colaborador' },
      gestor,
    )

    await expect(
      criarColaborador(
        banco,
        { nome: 'Outro Fulano', email: 'fulano@teste.local', papel: 'colaborador' },
        gestor,
      ),
    ).rejects.toThrow(/Já existe colaborador/)
  })

  it('manda reativar em vez de duplicar quando o e-mail é de alguém desligado', async () => {
    const { gestor } = await baseComGestor()
    const criado = await criarColaborador(
      banco,
      { nome: 'Fulano', email: 'fulano@teste.local', papel: 'colaborador' },
      gestor,
    )
    await banco.colaborador.update({
      where: { id: criado.colaboradorId },
      data: { ativo: false },
    })

    // Cadastrar de novo partiria o histórico de carga em duas pessoas que são
    // a mesma — e o crédito acumulado da primeira ficaria órfão.
    await expect(
      criarColaborador(
        banco,
        { nome: 'Fulano', email: 'fulano@teste.local', papel: 'colaborador' },
        gestor,
      ),
    ).rejects.toThrow(/Reative/)
  })

  it('categoria desativada não grava NADA — nem a pessoa', async () => {
    const { gestor } = await baseComGestor()
    await banco.categoria.update({ where: { codigo: 'INADIMP' }, data: { ativa: false } })

    await expect(
      criarColaborador(
        banco,
        {
          nome: 'Fulano',
          email: 'fulano@teste.local',
          papel: 'colaborador',
          categorias: ['LIGANTE', 'INADIMP'],
        },
        gestor,
      ),
    ).rejects.toThrow(/Categoria inexistente/)

    // Transação inteira desfeita. Meia gravação aqui deixaria uma pessoa
    // cadastrada com metade das categorias que o gestor pediu, sem ele saber.
    expect(await banco.colaborador.count({ where: { email: 'fulano@teste.local' } })).toBe(0)
  })
})

describe('cadastro e habilitação andam juntos', () => {
  it('quem nasce com categoria aparece na tela de plantão', async () => {
    const { base, gestor } = await baseComGestor()

    const criado = await criarColaborador(
      banco,
      {
        nome: 'Fulano Habilitado',
        email: 'habilitado@teste.local',
        papel: 'colaborador',
        categorias: ['LIGANTE'],
      },
      gestor,
    )

    const escala = await obterEscala(banco, base.datas[0]!)
    expect(escala.map((linha) => linha.colaboradorId)).toContain(criado.colaboradorId)
  })

  it('quem nasce SEM categoria não aparece — é o estado que a tela precisa denunciar', async () => {
    const { base, gestor } = await baseComGestor()

    const criado = await criarColaborador(
      banco,
      { nome: 'Fulano Invisível', email: 'invisivel@teste.local', papel: 'colaborador' },
      gestor,
    )

    // Este teste NÃO documenta um defeito: documenta por que cadastro sem
    // habilitação é perigoso, e por que as duas coisas entraram na mesma
    // entrega. A pessoa existe, tem senha, entra no sistema — e não recebe
    // nada, sem nada acusar. A tela mostra esse estado em destaque.
    const escala = await obterEscala(banco, base.datas[0]!)
    expect(escala.map((linha) => linha.colaboradorId)).not.toContain(criado.colaboradorId)
  })
})

describe('habilitação', () => {
  it('a lista enviada é o estado final, não um acréscimo', async () => {
    const { gestor } = await baseComGestor()
    const criado = await criarColaborador(
      banco,
      {
        nome: 'Fulano',
        email: 'fulano@teste.local',
        papel: 'colaborador',
        categorias: ['LIGANTE', 'LIGA'],
      },
      gestor,
    )

    const depois = await definirHabilitacoes(
      banco,
      { colaboradorId: criado.colaboradorId, categorias: ['LIGA', 'DOC_CADASTRO'] },
      gestor,
    )

    expect(depois.categorias.sort()).toEqual(['DOC_CADASTRO', 'LIGA'])
  })

  it('tirar uma categoria desliga a linha, nunca apaga', async () => {
    const { gestor } = await baseComGestor()
    const criado = await criarColaborador(
      banco,
      {
        nome: 'Fulano',
        email: 'fulano@teste.local',
        papel: 'colaborador',
        categorias: ['LIGANTE'],
      },
      gestor,
    )

    await definirHabilitacoes(
      banco,
      { colaboradorId: criado.colaboradorId, categorias: [] },
      gestor,
    )

    const linhas = await banco.habilitacao.findMany({
      where: { colaboradorId: criado.colaboradorId },
      select: { podeReceber: true },
    })

    // A linha continua lá, desligada. Apagar perderia o registro de que aquela
    // pessoa esteve habilitada, e o histórico de carga se apoia nele.
    expect(linhas).toHaveLength(1)
    expect(linhas[0]!.podeReceber).toBe(false)
  })

  it('religar reaproveita a linha em vez de criar outra', async () => {
    const { gestor } = await baseComGestor()
    const criado = await criarColaborador(
      banco,
      {
        nome: 'Fulano',
        email: 'fulano@teste.local',
        papel: 'colaborador',
        categorias: ['LIGANTE'],
      },
      gestor,
    )

    await definirHabilitacoes(banco, { colaboradorId: criado.colaboradorId, categorias: [] }, gestor)
    await definirHabilitacoes(
      banco,
      { colaboradorId: criado.colaboradorId, categorias: ['LIGANTE'] },
      gestor,
    )

    const linhas = await banco.habilitacao.findMany({
      where: { colaboradorId: criado.colaboradorId },
    })
    expect(linhas).toHaveLength(1)
    expect(linhas[0]!.podeReceber).toBe(true)
  })

  it('desligar tira a pessoa do plantão na mesma hora', async () => {
    const { base, gestor } = await baseComGestor()
    const criado = await criarColaborador(
      banco,
      {
        nome: 'Fulano',
        email: 'fulano@teste.local',
        papel: 'colaborador',
        categorias: ['LIGANTE'],
      },
      gestor,
    )

    await definirHabilitacoes(banco, { colaboradorId: criado.colaboradorId, categorias: [] }, gestor)

    // Efeito imediato importa: o gestor tira a categoria justamente ANTES da
    // distribuição do dia. Uma revogação que só vale amanhã chegaria tarde.
    const escala = await obterEscala(banco, base.datas[0]!)
    expect(escala.map((linha) => linha.colaboradorId)).not.toContain(criado.colaboradorId)
  })

  it('categoria desativada não aplica nenhuma da lista', async () => {
    const { gestor } = await baseComGestor()
    await banco.categoria.update({ where: { codigo: 'INADIMP' }, data: { ativa: false } })
    const criado = await criarColaborador(
      banco,
      {
        nome: 'Fulano',
        email: 'fulano@teste.local',
        papel: 'colaborador',
        categorias: ['LIGANTE'],
      },
      gestor,
    )

    await expect(
      definirHabilitacoes(
        banco,
        { colaboradorId: criado.colaboradorId, categorias: ['LIGA', 'INADIMP'] },
        gestor,
      ),
    ).rejects.toThrow(/Categoria inexistente/)

    // Aplicar só as válidas deixaria o gestor achando que gravou uma coisa e o
    // banco com outra.
    const depois = await banco.habilitacao.findMany({
      where: { colaboradorId: criado.colaboradorId, podeReceber: true },
      include: { categoria: { select: { codigo: true } } },
    })
    expect(depois.map((linha) => linha.categoria.codigo)).toEqual(['LIGANTE'])
  })
})

describe('o que a API recusa antes de gravar', () => {
  it('nome só de espaços não vira pessoa sem nome', async () => {
    const { gestor } = await baseComGestor()

    // `.trim()` depois de `.min(1)` valida a string CRUA e só então apara:
    // "   " tem comprimento 3, passa, e vira "". A pessoa nasceria sem nome
    // nenhum na lista de acesso e na tela de plantão.
    await expect(
      criarColaborador(
        banco,
        { nome: '   ', email: 'fulano@teste.local', papel: 'colaborador' },
        gestor,
      ),
    ).rejects.toThrow()

    expect(await banco.colaborador.count({ where: { email: 'fulano@teste.local' } })).toBe(0)
  })

  it('e-mail sem formato de e-mail é recusado', async () => {
    const { gestor } = await baseComGestor()

    // O estrago não é estético. "ana.silva" sem domínio cria uma conta que a
    // pessoa nunca vai encontrar; o gestor cadastra de novo com o endereço
    // certo, e agora existem DUAS pessoas que são a mesma — com o histórico de
    // carga partido entre elas. É exatamente o dano que a regra de "reative em
    // vez de duplicar" existe para impedir, entrando pela porta da frente.
    await expect(
      criarColaborador(
        banco,
        { nome: 'Ana Sintética', email: 'ana.silva', papel: 'colaborador' },
        gestor,
      ),
    ).rejects.toThrow()

    expect(await banco.colaborador.count({ where: { nome: 'Ana Sintética' } })).toBe(0)
  })

  it('e-mail só de espaços não vira conta inalcançável', async () => {
    const { gestor } = await baseComGestor()

    // Gravado como "", a conta existe e NUNCA abre: a entrada exige e-mail com
    // ao menos um caractere. Ninguém consegue entrar, e ninguém consegue ver
    // que o problema é esse.
    await expect(
      criarColaborador(banco, { nome: 'Fulano', email: '     ', papel: 'colaborador' }, gestor),
    ).rejects.toThrow()
  })

  it('aceita e-mail normal com maiúsculas e espaço sobrando', async () => {
    const { gestor } = await baseComGestor()

    const criado = await criarColaborador(
      banco,
      { nome: '  Fulano Sintético  ', email: '  Fulano@Exemplo.TEST  ', papel: 'colaborador' },
      gestor,
    )

    // Aparar e normalizar continua funcionando — a correção não pode ter
    // virado uma regra que recusa entrada legítima.
    expect(criado.nome).toBe('Fulano Sintético')
    expect(criado.email).toBe('fulano@exemplo.test')
  })
})
