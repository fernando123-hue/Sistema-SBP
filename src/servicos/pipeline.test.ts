import { beforeEach, describe, expect, it } from 'vitest'

import { IaMock } from '../adapters/ia-mock'
import { IngestaoMock } from '../adapters/ingestao-mock'
import {
  EmailBrutoSchema,
  InterpretacaoSchema,
  type EmailBruto,
  type Interpretacao,
} from '../core/esquemas'
import type { ArmazenamentoPort } from '../ports/armazenamento'
import { InterpretacaoIndisponivelError, type AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { fimDoDia, sequenciaDeDatas } from '../core/util/datas'
import { obterPrisma } from '../servidor/prisma'
import { DATA_BASE, aprovarTudoNoBanco, limparTudo, semearBase } from '../testes/apoio'
import { listarCaixa } from './caixa'
import { confirmar, previa } from './distribuicao'
import { concluir, devolver, minhaFila, transferir } from './fila'
import { sincronizar } from './ingestao'
import { conferirConservacao, porCategoria } from './painel'
import { aprovarTodosPendentes, listarPendentes, resolver } from './revisao'

/**
 * Testes de integração do pipeline.
 *
 * Prioridade máxima do projeto: DISTRIBUIÇÃO e INTEGRIDADE (entrada == saída).
 * Estes testes rodam contra um banco SQLite real, não contra mocks de banco —
 * constraint, transação e índice único são parte do que está sendo verificado.
 */

const banco = obterPrisma()

/**
 * Armazenamento em memória.
 *
 * O adapter de disco tem testes próprios contra o disco de verdade; aqui o que
 * se verifica é a DECISÃO da ingestão — o que ela manda guardar e o que ela
 * recusa antes de chegar perto do armazenamento.
 */
class ArmazenamentoEmMemoria implements ArmazenamentoPort {
  readonly nome = 'memoria'
  readonly guardados = new Map<string, Uint8Array>()
  private proxima = 0

  async guardar(bytes: Uint8Array, extensao: string): Promise<string> {
    const chave = `memoria-${(this.proxima += 1)}${extensao}`
    this.guardados.set(chave, bytes)
    return chave
  }

  async ler(chave: string): Promise<Uint8Array | null> {
    return this.guardados.get(chave) ?? null
  }

  async remover(chave: string): Promise<void> {
    this.guardados.delete(chave)
  }
}

function deps(datas: readonly string[], semente = 7, malicioso = false) {
  return {
    banco,
    ingestao: new IngestaoMock({ datas, semente, incluirMalicioso: malicioso }),
    ia: new IaMock(),
  }
}

beforeEach(async () => {
  await limparTudo(banco)
})

describe('conservação de totais — critério de aceitação nº 1', () => {
  it('em 30 dias simulados, Σ distribuído == Σ entrada em 100% das rodadas', async () => {
    const base = await semearBase(banco, { totalDeDias: 30, pessoasDePlantao: 3 })
    const datas = sequenciaDeDatas(DATA_BASE, 30)

    await sincronizar(deps(datas, 31), base.operador)
    await aprovarTudoNoBanco(banco)

    for (const data of datas) {
      await confirmar(banco, { data, categorias: [] }, base.operador)
    }

    const conservacao = await conferirConservacao(banco)
    expect(conservacao.rodadas).toBeGreaterThan(0)
    expect(conservacao.divergentes).toEqual([])

    // Nada some: todo item aprovado virou exatamente uma atribuição ativa.
    const aprovadosRestantes = await banco.item.count({ where: { status: 'aprovado' } })
    const distribuidos = await banco.item.count({ where: { status: 'distribuido' } })
    const atribuicoes = await banco.atribuicao.count({ where: { ativa: true } })

    expect(aprovadosRestantes).toBe(0)
    expect(atribuicoes).toBe(distribuidos)
  })

  it('com rateio sempre divisível, |crédito| fica abaixo de 1 unidade', async () => {
    // `limiarIndivisivel = 1` desliga o caminho "lote pequeno vai inteiro para
    // um só". Aí vale o invariante forte do PRD: |crédito| < 1 a todo momento.
    const base = await semearBase(banco, {
      totalDeDias: 20,
      pessoasDePlantao: 3,
      limiarIndivisivel: 1,
    })
    const datas = sequenciaDeDatas(DATA_BASE, 20)

    await sincronizar(deps(datas, 99), base.operador)
    await aprovarTudoNoBanco(banco)

    for (const data of datas) {
      await confirmar(banco, { data, categorias: [] }, base.operador)
    }

    const saldos = await banco.saldoCarga.findMany({ select: { creditoAcumulado: true } })
    expect(saldos.length).toBeGreaterThan(0)
    for (const saldo of saldos) {
      expect(Math.abs(saldo.creditoAcumulado)).toBeLessThan(1)
    }
  })

  it('com lote indivisível, o crédito é limitado pelo tamanho do lote e volta a zerar', async () => {
    // Comportamento documentado, não escondido: quando `Q <= limiarIndivisivel`
    // o lote inteiro vai para uma pessoa e o crédito salta até o tamanho do
    // lote. Em troca, ninguém fragmenta trabalho de volume baixo. Ver
    // DECISOES.md § C2 e § AT-01.
    const LIMIAR = 3
    const base = await semearBase(banco, {
      totalDeDias: 20,
      pessoasDePlantao: 3,
      limiarIndivisivel: LIMIAR,
    })
    const datas = sequenciaDeDatas(DATA_BASE, 20)

    await sincronizar(deps(datas, 99), base.operador)
    await aprovarTudoNoBanco(banco)

    for (const data of datas) {
      await confirmar(banco, { data, categorias: [] }, base.operador)
    }

    const saldos = await banco.saldoCarga.findMany({ select: { creditoAcumulado: true } })
    for (const saldo of saldos) {
      expect(Math.abs(saldo.creditoAcumulado)).toBeLessThanOrEqual(LIMIAR)
    }

    // O que importa no fim: a carga acumulada por pessoa fica junta.
    const porPessoa = await banco.atribuicao.groupBy({
      by: ['colaboradorId'],
      where: { ativa: true },
      _count: { _all: true },
    })
    const totais = porPessoa.map((linha) => linha._count._all)
    const media = totais.reduce((soma, valor) => soma + valor, 0) / totais.length
    for (const total of totais) {
      // Desvio proporcional pequeno: o rateio não favorece ninguém de forma sistemática.
      expect(Math.abs(total - media)).toBeLessThan(media * 0.25 + LIMIAR)
    }
  })

  it('não distribui itens que ainda não chegaram', async () => {
    const base = await semearBase(banco, { totalDeDias: 5, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 5)

    await sincronizar(deps(datas, 5), base.operador)
    await aprovarTudoNoBanco(banco)

    // Distribui só o primeiro dia.
    await confirmar(banco, { data: datas[0]!, categorias: [] }, base.operador)

    const distribuidos = await banco.item.findMany({
      where: { status: 'distribuido' },
      include: { email: { select: { recebidoEm: true } } },
    })

    const limite = fimDoDia(datas[0]!)
    for (const item of distribuidos) {
      expect(item.email!.recebidoEm.getTime()).toBeLessThanOrEqual(limite.getTime())
    }
    expect(await banco.item.count({ where: { status: 'aprovado' } })).toBeGreaterThan(0)
  })
})

describe('idempotência', () => {
  it('reprocessar os mesmos e-mails não cria item nenhum a mais', async () => {
    const base = await semearBase(banco, { totalDeDias: 3 })
    const datas = sequenciaDeDatas(DATA_BASE, 3)

    const primeira = await sincronizar(deps(datas), base.operador)
    const segunda = await sincronizar(deps(datas), base.operador)

    expect(primeira.itensCriados).toBeGreaterThan(0)
    expect(segunda.novos).toBe(0)
    expect(segunda.duplicados).toBe(primeira.recebidos)
    expect(segunda.itensCriados).toBe(0)
    expect(await banco.item.count()).toBe(primeira.itensCriados)
  })
})

describe('desdobramento — um e-mail pode gerar N itens (decisão A1)', () => {
  it('um e-mail com lista de ligantes vira N unidades de carga', async () => {
    const base = await semearBase(banco, { totalDeDias: 3 })
    const datas = sequenciaDeDatas(DATA_BASE, 3)

    const resumo = await sincronizar(deps(datas), base.operador)
    expect(resumo.itensCriados).toBeGreaterThan(resumo.recebidos)

    const comMuitosItens = await banco.email.findFirst({
      where: { itens: { some: { sequencia: { gt: 1 } } } },
      include: { itens: true },
    })
    expect(comMuitosItens).not.toBeNull()
    expect(comMuitosItens!.itens.length).toBeGreaterThan(1)
  })

  it('operador aumenta o N ao resolver — o N da IA é sugestão, não teto (AT-06)', async () => {
    const base = await semearBase(banco, { totalDeDias: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 2)

    await sincronizar(deps(datas), base.operador)

    const pendente = (await listarPendentes(banco, 500)).itens.find(
      (item) => item.motivo === 'desdobramento',
    )
    expect(pendente).toBeDefined()

    const itemAntes = await banco.item.findUniqueOrThrow({ where: { id: pendente!.itemId } })
    const totalAntes = await banco.item.count({ where: { emailId: itemAntes.emailId } })

    const resultado = await resolver(
      banco,
      {
        revisaoId: pendente!.revisaoId,
        categoriaCodigo: pendente!.categoriaCodigo,
        titulo: pendente!.titulo,
        campos: {},
        aprovar: true,
        itensExtras: [
          { titulo: 'Ligante esquecido no rodapé 1', campos: { nome: 'Sintético Um' } },
          { titulo: 'Ligante esquecido no rodapé 2', campos: { nome: 'Sintético Dois' } },
        ],
      },
      base.operador,
    )

    expect(resultado.itensExtrasCriados).toHaveLength(2)

    const totalDepois = await banco.item.count({ where: { emailId: itemAntes.emailId } })
    expect(totalDepois).toBe(totalAntes + 2)

    const extras = await banco.item.findMany({
      where: { id: { in: resultado.itensExtrasCriados } },
    })
    for (const extra of extras) {
      expect(extra.status).toBe('aprovado')
      expect(extra.categoriaId).toBe(itemAntes.categoriaId)
    }

    // Carga nova entra normal na próxima distribuição — a conservação não é
    // "quantidade que a IA extraiu do e-mail", é "quantidade aprovada agora".
    await aprovarTudoNoBanco(banco)
    for (const data of datas) {
      await confirmar(banco, { data, categorias: [] }, base.operador)
    }
    const conservacao = await conferirConservacao(banco)
    expect(conservacao.divergentes).toEqual([])
  })

  it('descartar uma revisão NÃO cria os itens extras — dividir só faz sentido junto de aprovar', async () => {
    const base = await semearBase(banco, { totalDeDias: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 2)

    await sincronizar(deps(datas), base.operador)

    const pendente = (await listarPendentes(banco, 500)).itens.find(
      (item) => item.motivo === 'desdobramento',
    )
    expect(pendente).toBeDefined()

    const resultado = await resolver(
      banco,
      {
        revisaoId: pendente!.revisaoId,
        categoriaCodigo: pendente!.categoriaCodigo,
        titulo: pendente!.titulo,
        campos: {},
        aprovar: false,
        itensExtras: [{ titulo: 'Não deveria existir', campos: {} }],
      },
      base.operador,
    )

    expect(resultado.itensExtrasCriados).toHaveLength(0)
  })
})

describe('segurança — conteúdo não confiável', () => {
  it('e-mail com prompt injection vira item comum e cai na fila de revisão', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)

    await sincronizar(deps(datas, 7, true), base.operador)

    const { itens: pendentes } = await listarPendentes(banco, 500)
    const suspeitos = pendentes.filter((item) => item.motivo === 'conteudo_suspeito')

    expect(suspeitos.length).toBe(1)
    // A instrução do remetente NÃO teve efeito: nada foi distribuído nem aprovado.
    const item = await banco.item.findUniqueOrThrow({ where: { id: suspeitos[0]!.itemId } })
    expect(item.status).toBe('aguardando_revisao')
    expect(item.confianca).toBeLessThan(0.85)
    expect(await banco.atribuicao.count()).toBe(0)
  })

  it('aprovação em massa NÃO libera conteúdo suspeito nem desdobramento', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)

    await sincronizar(deps(datas, 7, true), base.operador)
    await aprovarTodosPendentes(banco, base.operador)

    // O atalho de conveniência cobre só as exceções rotineiras. Antes, o filtro
    // era `resolvidoEm: null` — sem restrição — e liberava de uma vez tudo que
    // a defesa tinha acabado de segurar.
    const { itens: restantes } = await listarPendentes(banco, 500)
    const motivos = new Set(restantes.map((item) => item.motivo))

    expect(motivos.has('conteudo_suspeito')).toBe(true)
    expect(motivos.has('baixa_confianca')).toBe(false)
    expect(motivos.has('campo_ausente')).toBe(false)
  })

  it('desdobramento em N itens sempre passa por olho humano', async () => {
    const base = await semearBase(banco, { totalDeDias: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 2)

    await sincronizar(deps(datas), base.operador)

    // A quantidade de carga é decisão humana. Um item de lista sempre tinha
    // nome preenchido, logo confiança alta, logo entrava aprovado sem ninguém
    // ver — e uma assinatura numerada no rodapé viraria 3 unidades de trabalho.
    const desdobrados = (await listarPendentes(banco, 500)).itens.filter(
      (item) => item.motivo === 'desdobramento',
    )
    expect(desdobrados.length).toBeGreaterThan(0)

    for (const pendente of desdobrados) {
      const item = await banco.item.findUniqueOrThrow({ where: { id: pendente.itemId } })
      expect(item.status).toBe('aguardando_revisao')
    }
  })

  it('anexo com travessia de diretório é normalizado e registrado', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)

    await sincronizar(deps(datas, 7, true), base.operador)

    const email = await banco.email.findFirstOrThrow({
      where: { messageId: { contains: 'injecao' } },
      include: { anexos: true },
    })

    expect(email.anexos[0]!.nomeSeguro).toBe('passwd.pdf')
    expect(email.anexos[0]!.nomeSeguro).not.toContain('..')
  })

  it('executável disfarçado de PDF é recusado, e seus bytes não vão para o disco', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)
    const armazenamento = new ArmazenamentoEmMemoria()

    await sincronizar({ ...deps(datas, 7, true), armazenamento }, base.operador)

    const email = await banco.email.findFirstOrThrow({
      where: { messageId: { contains: 'injecao' } },
      include: { anexos: true },
    })
    const anexo = email.anexos[0]!

    // O nome termina em `.pdf` e passa inteiro pela allowlist de extensão. Só a
    // conferência dos bytes denuncia o executável.
    expect(anexo.aceito).toBe(false)
    expect(anexo.motivo).toContain('não corresponde')
    // Não se armazena o que já se sabe que não devia ter chegado. O lote traz
    // anexos legítimos junto, então o que se verifica é que NENHUM byte
    // guardado é o do executável.
    expect(anexo.chaveArmazenamento).toBeNull()
    for (const bytes of armazenamento.guardados.values()) {
      expect(Array.from(bytes.slice(0, 2))).not.toEqual([0x4d, 0x5a])
    }
  })

  it('anexo legítimo é guardado, e a chave aponta para os bytes certos', async () => {
    const base = await semearBase(banco, { totalDeDias: 3 })
    const datas = sequenciaDeDatas(DATA_BASE, 3)
    const armazenamento = new ArmazenamentoEmMemoria()

    await sincronizar({ ...deps(datas), armazenamento }, base.operador)

    const anexo = await banco.anexo.findFirstOrThrow({
      where: { aceito: true, chaveArmazenamento: { not: null } },
    })

    expect(anexo.armazenadoEm).not.toBeNull()
    const bytes = await armazenamento.ler(anexo.chaveArmazenamento!)
    expect(bytes).not.toBeNull()
    // `%PDF` — os bytes guardados são de fato o arquivo que chegou.
    expect(Array.from(bytes!.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46])
  })

  it('sem armazenamento configurado, o metadado é gravado e a ausência dos bytes é declarada', async () => {
    const base = await semearBase(banco, { totalDeDias: 3 })
    const datas = sequenciaDeDatas(DATA_BASE, 3)

    // Nem toda origem entrega o arquivo junto do e-mail. O sistema registra o
    // que chegou e NÃO finge ter guardado o que não guardou.
    await sincronizar(deps(datas), base.operador)

    const anexos = await banco.anexo.findMany({ where: { aceito: true } })
    expect(anexos.length).toBeGreaterThan(0)
    for (const anexo of anexos) {
      expect(anexo.chaveArmazenamento).toBeNull()
      expect(anexo.armazenadoEm).toBeNull()
    }
  })
})

describe('retenção — conteúdo separado do histórico operacional', () => {
  it('expurgar o conteúdo do e-mail não derruba item, carga nem conservação', async () => {
    const base = await semearBase(banco, { totalDeDias: 3, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 3)

    await sincronizar(deps(datas), base.operador)
    await aprovarTudoNoBanco(banco)
    for (const data of datas) {
      await confirmar(banco, { data, categorias: [] }, base.operador)
    }

    const itensAntes = await banco.item.count()
    const atribuicoesAntes = await banco.atribuicao.count()
    const conservacaoAntes = await conferirConservacao(banco)

    // O expurgo que a política de retenção fará um dia: apaga o CONTEÚDO,
    // preserva o metadado operacional. É a razão de as duas coisas viverem em
    // linhas separadas.
    await banco.emailConteudo.deleteMany()
    await banco.email.updateMany({ data: { conteudoExpurgadoEm: new Date() } })

    expect(await banco.item.count()).toBe(itensAntes)
    expect(await banco.atribuicao.count()).toBe(atribuicoesAntes)

    // O indicador que prova o valor do sistema continua reconstruível.
    const conservacaoDepois = await conferirConservacao(banco)
    expect(conservacaoDepois.rodadas).toBe(conservacaoAntes.rodadas)
    expect(conservacaoDepois.divergentes).toEqual([])

    // E a operação continua legível: a caixa perde remetente e assunto, nunca
    // o item.
    const caixa = await listarCaixa(banco, { limite: 5 })
    expect(caixa.length).toBeGreaterThan(0)
    expect(caixa[0]!.titulo.length).toBeGreaterThan(0)
    expect(caixa[0]!.remetente).toBeNull()
  })

  it('o carimbo distingue "nunca teve conteúdo" de "foi expurgado"', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)
    await sincronizar(deps(datas), base.operador)

    const antes = await banco.email.findFirstOrThrow({ include: { conteudo: true } })
    expect(antes.conteudo).not.toBeNull()
    expect(antes.conteudoExpurgadoEm).toBeNull()

    await banco.emailConteudo.delete({ where: { emailId: antes.id } })
    await banco.email.update({
      where: { id: antes.id },
      data: { conteudoExpurgadoEm: new Date() },
    })

    // Sem o carimbo, um e-mail sem corpo seria ambíguo: falha de ingestão ou
    // retenção aplicada? Ambiguidade silenciosa é o defeito que este sistema
    // existe para eliminar.
    const depois = await banco.email.findUniqueOrThrow({
      where: { id: antes.id },
      include: { conteudo: true },
    })
    expect(depois.conteudo).toBeNull()
    expect(depois.conteudoExpurgadoEm).not.toBeNull()
  })
})

describe('carga ponderada e escopo do livro-razão', () => {
  it('grava contagem e carga lado a lado, e separa o razão por frente', async () => {
    const base = await semearBase(banco, { totalDeDias: 2, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 2)

    await sincronizar(deps(datas), base.operador)
    await aprovarTudoNoBanco(banco)
    for (const data of datas) {
      await confirmar(banco, { data, categorias: [] }, base.operador)
    }

    const saldos = await banco.saldoCarga.findMany({ where: { recebido: { gt: 0 } } })
    expect(saldos.length).toBeGreaterThan(0)
    for (const saldo of saldos) {
      // Hoje o peso é 1, então os dois números coincidem. O que importa é que
      // ambos são GRAVADOS: quando o peso passar a variar por item, `recebido`
      // continua respondendo "quantos" e `recebidoPonderado`, "quanta carga".
      expect(saldo.recebidoPonderado).toBeGreaterThan(0)
    }

    // Todo razão global nasce carimbado com a frente. Sem isso, `CADASTRO` e
    // `TITULOS` somariam no mesmo saldo e o crédito perderia significado.
    const globais = await banco.saldoCargaGlobal.findMany()
    expect(globais.length).toBeGreaterThan(0)
    for (const global of globais) {
      expect(global.escopo).toBe('CADASTRO')
    }
  })
})

describe('invariantes de atribuição', () => {
  it('o banco impede dois responsáveis ativos para o mesmo item', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)

    await sincronizar(deps(datas), base.operador)
    await aprovarTudoNoBanco(banco)
    await confirmar(banco, { data: datas[0]!, categorias: [] }, base.operador)

    const existente = await banco.atribuicao.findFirstOrThrow({ where: { ativa: true } })

    // Índice único (itemId, ativa) — a garantia é do banco, não do código.
    await expect(
      banco.atribuicao.create({
        data: {
          itemId: existente.itemId,
          colaboradorId: base.colaboradores[1]!.id,
          motivo: 'manual',
          atribuidoPor: base.operadorId,
          ativa: true,
        },
      }),
    ).rejects.toThrow()
  })

  it('ninguém conclui item que não é seu', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)

    await sincronizar(deps(datas), base.operador)
    await aprovarTudoNoBanco(banco)
    await confirmar(banco, { data: datas[0]!, categorias: [] }, base.operador)

    const atribuicao = await banco.atribuicao.findFirstOrThrow({ where: { ativa: true } })
    const outro = base.colaboradores.find((pessoa) => pessoa.id !== atribuicao.colaboradorId)!

    await expect(concluir(banco, { itemId: atribuicao.itemId }, outro.ator)).rejects.toThrow(
      /responsável ativo/i,
    )
  })

  it('colaborador não puxa para si o item de um colega', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)

    await sincronizar(deps(datas), base.operador)
    await aprovarTudoNoBanco(banco)
    await confirmar(banco, { data: datas[0]!, categorias: [] }, base.operador)

    const atribuicao = await banco.atribuicao.findFirstOrThrow({ where: { ativa: true } })
    const outro = base.colaboradores.find((pessoa) => pessoa.id !== atribuicao.colaboradorId)!

    await expect(
      transferir(
        banco,
        {
          itemId: atribuicao.itemId,
          paraColaboradorId: outro.id,
          justificativa: 'Quero pegar este item para mim.',
        },
        outro.ator,
      ),
    ).rejects.toThrow(/não pode executar/i)
  })

  it('a identidade do autor vem do ator, não do chamador — auditoria não é forjável', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)

    await sincronizar(deps(datas), base.operador)
    await aprovarTudoNoBanco(banco)
    await confirmar(banco, { data: datas[0]!, categorias: [] }, base.operador)

    const atribuicao = await banco.atribuicao.findFirstOrThrow({ where: { ativa: true } })
    const dono = base.colaboradores.find((pessoa) => pessoa.id === atribuicao.colaboradorId)!

    await concluir(banco, { itemId: atribuicao.itemId }, dono.ator)

    const registro = await banco.logAuditoria.findFirstOrThrow({
      where: { entidadeId: atribuicao.itemId, acao: 'concluido' },
    })
    // O log grava quem o ator É, não quem a chamada disse ser.
    expect(registro.usuario).toBe(dono.id)

    const execucao = await banco.execucao.findFirstOrThrow({
      where: { itemId: atribuicao.itemId },
    })
    expect(execucao.colaboradorId).toBe(dono.id)
  })

  it('transferência troca o dono, exige justificativa e não altera a rodada', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)

    await sincronizar(deps(datas), base.operador)
    await aprovarTudoNoBanco(banco)
    await confirmar(banco, { data: datas[0]!, categorias: [] }, base.operador)

    const atribuicao = await banco.atribuicao.findFirstOrThrow({ where: { ativa: true } })
    const rodadaAntes = await banco.rodadaDistribuicao.findUniqueOrThrow({
      where: { id: atribuicao.rodadaId! },
    })
    const outro = base.colaboradores.find((pessoa) => pessoa.id !== atribuicao.colaboradorId)!

    await expect(
      transferir(
        banco,
        { itemId: atribuicao.itemId, paraColaboradorId: outro.id, justificativa: 'x' },
        base.operador,
      ),
    ).rejects.toThrow(/justificativa/i)

    await transferir(
      banco,
      {
        itemId: atribuicao.itemId,
        paraColaboradorId: outro.id,
        justificativa: 'Colega de férias a partir de amanhã.',
      },
      base.operador,
    )

    const ativas = await banco.atribuicao.findMany({
      where: { itemId: atribuicao.itemId, ativa: true },
    })
    expect(ativas).toHaveLength(1)
    expect(ativas[0]!.colaboradorId).toBe(outro.id)
    expect(ativas[0]!.motivo).toBe('transferencia')

    // Histórico imutável: a rodada original continua idêntica.
    const rodadaDepois = await banco.rodadaDistribuicao.findUniqueOrThrow({
      where: { id: atribuicao.rodadaId! },
    })
    expect(rodadaDepois.alocacao).toBe(rodadaAntes.alocacao)
    expect(rodadaDepois.quantidadeEntrada).toBe(rodadaAntes.quantidadeEntrada)

    // E a atribuição anterior virou histórico, não sumiu.
    const encerradas = await banco.atribuicao.count({
      where: { itemId: atribuicao.itemId, ativa: null },
    })
    expect(encerradas).toBe(1)
  })
})

describe('falha explícita em vez de trabalho perdido', () => {
  it('sem ninguém de plantão, o trabalho fica na fila e a rodada não é gravada', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)

    await sincronizar(deps(datas), base.operador)
    await aprovarTudoNoBanco(banco)

    // Ninguém disponível — o cenário que na planilha some com 16 itens de LIGA.
    await banco.escala.updateMany({ where: { data: datas[0]! }, data: { disponivel: false } })

    const aprovadosAntes = await banco.item.count({ where: { status: 'aprovado' } })
    const relatorio = await confirmar(banco, { data: datas[0]!, categorias: [] }, base.operador)

    expect(relatorio.rodadasGravadas).toBe(0)
    expect(relatorio.planos.every((plano) => plano.erro !== null)).toBe(true)
    expect(relatorio.planos[0]!.erro).toMatch(/elegível/i)

    // Nada perdido: continua tudo aprovado, esperando plantão.
    expect(await banco.item.count({ where: { status: 'aprovado' } })).toBe(aprovadosAntes)
    expect(await banco.atribuicao.count()).toBe(0)
  })
})

describe('devolução ao pool (AT-07)', () => {
  it('item devolvido perde o dono, muda de status e volta na próxima rodada', async () => {
    const base = await semearBase(banco, { totalDeDias: 2, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 2)

    await sincronizar(deps(datas), base.operador)
    await aprovarTudoNoBanco(banco)
    await confirmar(banco, { data: datas[0]!, categorias: [] }, base.operador)

    const atribuicao = await banco.atribuicao.findFirstOrThrow({ where: { ativa: true } })
    const dono = base.colaboradores.find((pessoa) => pessoa.id === atribuicao.colaboradorId)!

    await expect(
      devolver(banco, { itemId: atribuicao.itemId, justificativa: 'x' }, dono.ator),
    ).rejects.toThrow(/justificativa/i)

    await devolver(
      banco,
      { itemId: atribuicao.itemId, justificativa: 'Não é da minha alçada.' },
      dono.ator,
    )

    const item = await banco.item.findUniqueOrThrow({ where: { id: atribuicao.itemId } })
    expect(item.status).toBe('devolvido')

    // Sem dono: é isso que significa "voltar ao pool".
    expect(await banco.atribuicao.count({ where: { itemId: item.id, ativa: true } })).toBe(0)

    // A atribuição encerrada guarda o motivo e a justificativa.
    const encerrada = await banco.atribuicao.findFirstOrThrow({
      where: { itemId: item.id, ativa: null },
    })
    expect(encerrada.motivo).toBe('devolucao')
    expect(encerrada.justificativa).toContain('alçada')

    // E o item volta a ser distribuído — o ponto todo da devolução.
    await confirmar(banco, { data: datas[1]!, categorias: [] }, base.operador)
    const depois = await banco.item.findUniqueOrThrow({ where: { id: atribuicao.itemId } })
    expect(depois.status).toBe('distribuido')
    expect(await banco.atribuicao.count({ where: { itemId: item.id, ativa: true } })).toBe(1)
  })

  it('colaborador não devolve item de um colega', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)

    await sincronizar(deps(datas), base.operador)
    await aprovarTudoNoBanco(banco)
    await confirmar(banco, { data: datas[0]!, categorias: [] }, base.operador)

    const atribuicao = await banco.atribuicao.findFirstOrThrow({ where: { ativa: true } })
    const outro = base.colaboradores.find((pessoa) => pessoa.id !== atribuicao.colaboradorId)!

    await expect(
      devolver(banco, { itemId: atribuicao.itemId, justificativa: 'Quero soltar este.' }, outro.ator),
    ).rejects.toThrow(/não pode executar/i)
  })
})

describe('vigência de habilitação', () => {
  it('a habilitação vale até o último dia, e não vale no dia seguinte', async () => {
    const base = await semearBase(banco, { totalDeDias: 3, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 3)
    const ultimoDia = datas[1]!

    // Nenhum teste criava habilitação com fim: a fronteira estava escrita mas
    // nunca exercitada. Trocar `gte` por `gt` passaria despercebido.
    const saindo = base.colaboradores[0]!
    await banco.habilitacao.updateMany({
      where: { colaboradorId: saindo.id },
      data: { vigenciaFim: fimDoDia(ultimoDia) },
    })

    await sincronizar(deps(datas), base.operador)
    await aprovarTudoNoBanco(banco)

    const noUltimoDia = await previa(banco, { data: ultimoDia, categorias: [] }, base.operador)
    const elegiveisNoUltimoDia = noUltimoDia.planos.flatMap(
      (plano) => plano.resultado?.ordemDesempate ?? [],
    )
    expect(elegiveisNoUltimoDia).toContain(saindo.id)

    const depois = await previa(banco, { data: datas[2]!, categorias: [] }, base.operador)
    const elegiveisDepois = depois.planos.flatMap((plano) => plano.resultado?.ordemDesempate ?? [])
    expect(elegiveisDepois).not.toContain(saindo.id)
  })

  it('colaborador desativado sai do rateio mas mantém o histórico', async () => {
    const base = await semearBase(banco, { totalDeDias: 2, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 2)

    await sincronizar(deps(datas), base.operador)
    await aprovarTudoNoBanco(banco)
    await confirmar(banco, { data: datas[0]!, categorias: [] }, base.operador)

    const saindo = base.colaboradores[0]!
    const atribuidosAntes = await banco.atribuicao.count({
      where: { colaboradorId: saindo.id, ativa: true },
    })
    expect(atribuidosAntes).toBeGreaterThan(0)

    await banco.colaborador.update({ where: { id: saindo.id }, data: { ativo: false } })

    const depois = await previa(banco, { data: datas[1]!, categorias: [] }, base.operador)
    const elegiveis = depois.planos.flatMap((plano) => plano.resultado?.ordemDesempate ?? [])
    expect(elegiveis).not.toContain(saindo.id)

    // Nada foi apagado: o que ele já tinha continua atribuído a ele.
    expect(await banco.atribuicao.count({ where: { colaboradorId: saindo.id, ativa: true } })).toBe(
      atribuidosAntes,
    )
  })
})

describe('conservação detecta divergência de verdade', () => {
  it('uma rodada com contagem adulterada é reportada', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)

    await sincronizar(deps(datas), base.operador)
    await aprovarTudoNoBanco(banco)
    await confirmar(banco, { data: datas[0]!, categorias: [] }, base.operador)

    expect((await conferirConservacao(banco, { desde: DATA_BASE })).divergentes).toEqual([])

    // Corrompe deliberadamente: sem este teste, inverter o `!==` do filtro
    // faria a verificação parar de detectar QUALQUER coisa em silêncio — e o
    // critério de aceitação nº 1 do projeto viraria decoração.
    const rodada = await banco.rodadaDistribuicao.findFirstOrThrow()
    await banco.rodadaDistribuicao.update({
      where: { id: rodada.id },
      data: { quantidadeEntrada: rodada.quantidadeEntrada + 5 },
    })

    const conferencia = await conferirConservacao(banco, { desde: DATA_BASE })
    expect(conferencia.divergentes).toHaveLength(1)
    expect(conferencia.divergentes[0]!.rodadaId).toBe(rodada.id)
  })
})

describe('item de origem manual, sem e-mail', () => {
  it('entra na distribuição como qualquer outro', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)
    const categoria = await banco.categoria.findFirstOrThrow({ where: { codigo: 'LIGA' } })

    const manual = await banco.item.create({
      data: {
        categoriaId: categoria.id,
        titulo: 'Pedido registrado por telefone',
        status: 'aprovado',
        confianca: 1,
      },
    })

    await confirmar(banco, { data: datas[0]!, categorias: ['LIGA'] }, base.operador)

    const depois = await banco.item.findUniqueOrThrow({ where: { id: manual.id } })
    expect(depois.status).toBe('distribuido')
  })
})

describe('categoria fora do rateio', () => {
  it('itens de INADIMP nunca são distribuídos, e isso não é perda', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)
    const categoria = await banco.categoria.findFirstOrThrow({ where: { codigo: 'INADIMP' } })

    const item = await banco.item.create({
      data: {
        categoriaId: categoria.id,
        titulo: 'Associado inadimplente',
        status: 'aprovado',
        confianca: 1,
      },
    })

    await confirmar(banco, { data: datas[0]!, categorias: [] }, base.operador)

    // Continua aprovado: sai do rateio automático, mas não some.
    const depois = await banco.item.findUniqueOrThrow({ where: { id: item.id } })
    expect(depois.status).toBe('aprovado')
    expect(await banco.atribuicao.count({ where: { itemId: item.id } })).toBe(0)
  })
})

describe('auditoria da rodada', () => {
  it('grava o snapshot completo dos elegíveis, não só quem venceu', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 3 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)

    await sincronizar(deps(datas), base.operador)
    await aprovarTudoNoBanco(banco)
    await confirmar(banco, { data: datas[0]!, categorias: [] }, base.operador)

    const rodada = await banco.rodadaDistribuicao.findFirstOrThrow({
      where: { criterio: 'resto_maior' },
    })

    const elegiveis = JSON.parse(rodada.elegiveis) as Record<string, unknown>[]
    const ordem = JSON.parse(rodada.ordemDesempate) as string[]

    // Os dois campos NÃO podem guardar a mesma coisa: `ordemDesempate` são ids,
    // `elegiveis` é o estado que produziu essa ordem.
    expect(rodada.elegiveis).not.toBe(rodada.ordemDesempate)
    expect(elegiveis).toHaveLength(ordem.length)

    // Sem estes campos é impossível responder "por que ela levou a sobra?".
    for (const elegivel of elegiveis) {
      expect(elegivel).toHaveProperty('colaboradorId')
      expect(elegivel).toHaveProperty('creditoCategoria')
      expect(elegivel).toHaveProperty('creditoGlobal')
      expect(elegivel).toHaveProperty('recebidoPeriodo')
      expect(elegivel).toHaveProperty('recebidoDia')
    }

    // A decisão é reconstituível: o primeiro da ordem é o primeiro do snapshot.
    expect(elegiveis[0]!['colaboradorId']).toBe(ordem[0])
  })

  it('a rodada guarda quem disparou, e é o ator autenticado', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)

    await sincronizar(deps(datas), base.operador)
    await aprovarTudoNoBanco(banco)
    await confirmar(banco, { data: datas[0]!, categorias: [] }, base.operador)

    const rodada = await banco.rodadaDistribuicao.findFirstOrThrow()
    expect(rodada.executadoPor).toBe(base.operadorId)
    expect(rodada.correlacaoId).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('painel derivado', () => {
  it('todo número do painel vem de agregação, e pendente cai ao concluir', async () => {
    const base = await semearBase(banco, { totalDeDias: 2, pessoasDePlantao: 2 })
    const datas = sequenciaDeDatas(DATA_BASE, 2)

    await sincronizar(deps(datas), base.operador)
    await aprovarTudoNoBanco(banco)
    for (const data of datas) {
      await confirmar(banco, { data, categorias: [] }, base.operador)
    }

    const antes = await porCategoria(banco)
    const pendenteAntes = antes.reduce((total, linha) => total + linha.pendente, 0)

    const pessoa = base.colaboradores[0]!
    const fila = await minhaFila(banco, pessoa.id, pessoa.ator)
    expect(fila.length).toBeGreaterThan(0)

    await concluir(banco, { itemId: fila[0]!.itemId }, pessoa.ator)

    const depois = await porCategoria(banco)
    const pendenteDepois = depois.reduce((total, linha) => total + linha.pendente, 0)
    expect(pendenteDepois).toBe(pendenteAntes - 1)
  })

  it('prévia e confirmação produzem a mesma alocação', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 3 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)

    await sincronizar(deps(datas), base.operador)
    await aprovarTudoNoBanco(banco)

    const pedido = { data: datas[0]!, categorias: [] }
    const antes = await previa(banco, pedido, base.operador)
    const depois = await confirmar(banco, pedido, base.operador)

    const alocacaoDaPrevia = antes.planos.map((plano) => plano.resultado?.alocacao)
    const alocacaoGravada = depois.planos.map((plano) => plano.resultado?.alocacao)

    expect(alocacaoGravada).toEqual(alocacaoDaPrevia)
    // E a prévia realmente não gravou nada por conta própria.
    expect(depois.rodadasGravadas).toBe(antes.planos.filter((plano) => plano.resultado).length)
  })
})

/**
 * Um único e-mail sintético.
 *
 * O `IngestaoMock` gera volume realista, mas nunca produz os dois casos abaixo.
 * Aqui o que importa é controlar exatamente o que entra.
 */
class IngestaoDeUmEmail implements IngestaoPort {
  readonly nome = 'um-email'

  constructor(private readonly messageId: string) {}

  async buscarNovos(): Promise<EmailBruto[]> {
    return [
      EmailBrutoSchema.parse({
        messageId: this.messageId,
        remetente: 'remetente@teste.local',
        assunto: 'Resposta automática de ausência',
        corpo: 'Estou fora do escritório até segunda-feira.',
        recebidoEm: new Date(`${DATA_BASE}T12:00:00.000Z`),
      }),
    ]
  }
}

/** Devolve a interpretação combinada. Produz respostas que o `IaMock` jamais produziria. */
class IaCombinada implements AiPort {
  readonly nome = 'combinada'

  constructor(private readonly itens: Interpretacao['itens']) {}

  async interpretar(): Promise<Interpretacao> {
    return InterpretacaoSchema.parse({
      itens: this.itens,
      modelo: 'combinada-de-teste',
      versaoPrompt: 'teste-1.0.0',
    })
  }
}

/**
 * O trabalho nunca desaparece sem deixar rastro.
 *
 * Estes dois casos são a razão de existir do sistema: a planilha perde carga em
 * silêncio, e um substituto que perca carga em silêncio não substitui nada.
 */
describe('e-mail que não vira item', () => {
  it('interpretação sem nenhum item é contada e registrada, nunca silenciosa', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const messageId = 'sem-item@teste.local'

    const resumo = await sincronizar(
      { banco, ingestao: new IngestaoDeUmEmail(messageId), ia: new IaCombinada([]) },
      base.operador,
    )

    // Zero item é resultado legítimo — resposta automática, aviso de entrega,
    // boletim. O que não pode é passar despercebido.
    expect(resumo.novos).toBe(1)
    expect(resumo.itensCriados).toBe(0)
    expect(resumo.emailsSemItem).toBe(1)

    const eventos = await banco.eventoProcessamento.findMany({
      where: { correlacaoId: resumo.correlacaoId, referencia: messageId },
    })
    expect(eventos).toHaveLength(1)
    expect(eventos[0]?.situacao).toBe('falha')
  })

  it('categoria ausente do banco aborta a transação e mantém o e-mail reprocessável', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const messageId = 'categoria-sumida@teste.local'

    // Simula o banco fora de sincronia com o enum: categoria que o código
    // conhece e o banco não tem. Seed incompleto, migração pela metade.
    await banco.categoria.delete({ where: { codigo: 'LIGANTE' } })

    const resumo = await sincronizar(
      {
        banco,
        ingestao: new IngestaoDeUmEmail(messageId),
        ia: new IaCombinada([
          {
            categoriaCodigo: 'LIGANTE',
            titulo: 'Ligante para cadastro',
            confianca: 0.95,
            campos: {},
            camposAusentes: [],
            ligaMencionada: null,
            observacao: null,
          },
        ]),
      },
      base.operador,
    )

    expect(resumo.falhas).toBe(1)
    expect(resumo.novos).toBe(0)

    // A transação inteira volta atrás: o e-mail não fica marcado como
    // processado, então corrigir o cadastro e sincronizar de novo recupera o
    // trabalho. Descartar o item em silêncio o perderia para sempre, porque a
    // idempotência por `messageId` nunca mais deixaria ele voltar.
    const email = await banco.email.findUnique({ where: { messageId } })
    expect(email).toBeNull()
  })
})

/** Vários e-mails sintéticos, para provar que o lote PARA em vez de insistir. */
class IngestaoDeVariosEmails implements IngestaoPort {
  readonly nome = 'varios-emails'

  constructor(private readonly quantidade: number) {}

  async buscarNovos(): Promise<EmailBruto[]> {
    return Array.from({ length: this.quantidade }, (_, indice) =>
      EmailBrutoSchema.parse({
        messageId: `lote-${indice}@teste.local`,
        remetente: 'remetente@teste.local',
        assunto: `Mensagem ${indice}`,
        corpo: 'Segue a ficha de cadastro.',
        recebidoEm: new Date(`${DATA_BASE}T12:00:00.000Z`),
      }),
    )
  }
}

describe('camada de IA fora do ar', () => {
  it('para o lote na primeira ocorrência em vez de falhar e-mail por e-mail', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    let chamadas = 0

    const ia: AiPort = {
      nome: 'fora-do-ar',
      async interpretar() {
        chamadas += 1
        throw new InterpretacaoIndisponivelError('invalid x-api-key')
      },
    }

    await expect(
      sincronizar({ banco, ingestao: new IngestaoDeVariosEmails(5), ia }, base.operador),
    ).rejects.toThrow(InterpretacaoIndisponivelError)

    // Uma tentativa, não cinco. Seguir o laço gastaria uma chamada condenada
    // por mensagem e enterraria a causa real — chave errada — no meio de
    // cinco linhas de erro idênticas.
    expect(chamadas).toBe(1)

    // E nada ficou marcado como processado: corrigida a chave, o lote inteiro
    // volta na próxima sincronização.
    expect(await banco.email.count({ where: { processadoEm: { not: null } } })).toBe(0)
  })
})
