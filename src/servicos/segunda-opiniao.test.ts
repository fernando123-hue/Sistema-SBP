import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it } from 'vitest'

import { ClassificadorExterno, type ClienteDeClassificacao } from '../adapters/classificador-externo'
import { clienteMock, PERFIL_MOCK } from '../adapters/classificador-mock'
import { INSTRUCOES } from '../adapters/ia-estruturada'
import { IaMock } from '../adapters/ia-mock'
import { IngestaoMock } from '../adapters/ingestao-mock'
import { DESCRICAO_DAS_CATEGORIAS_PARA_IA } from '../core/config'
import type { EmailBruto } from '../core/esquemas'
import { MARCADOR_FIM, MARCADOR_INICIO } from '../core/seguranca/conteudo-nao-confiavel'
import { sequenciaDeDatas } from '../core/util/datas'
import { ClassificadorIndisponivelError, FalhaDeClassificacao, type ClassificadorPort } from '../ports/classificador'
import { obterPrisma } from '../servidor/prisma'
import { DATA_BASE, limparTudo, semearBase } from '../testes/apoio'
import { sincronizar } from './ingestao'
import {
  colherSegundaOpiniao,
  novoEstadoDaSegundaOpiniao,
  PERGUNTAS_DA_INGESTAO,
  registroDaOpiniao,
  textoParaClassificar,
} from './segunda-opiniao'

/**
 * A segunda opinião na ingestão, em modo sombra (`A62`, fase 3).
 *
 * Dados sintéticos (invariante 8): e-mails em `exemplo.test`, CPF de exemplo.
 */

const EMAIL: EmailBruto = {
  messageId: 'sombra-1@exemplo.test',
  remetente: 'associada.ficticia@exemplo.test',
  assunto: 'Envio de documentos',
  corpo: 'Segue meu diploma. CPF 123.456.789-09.',
  anexos: [{ nome: 'diploma.pdf', tipoDeclarado: 'application/pdf', tamanho: 10, hash: null }],
  recebidoEm: new Date('2026-09-29T12:00:00Z'),
  origem: 'mock',
} as EmailBruto

const dubleDaPolitica = () => new ClassificadorExterno(PERFIL_MOCK, clienteMock())

/** Classificador que conta as chamadas e responde o que o teste mandar. */
function classificadorQue(fazer: () => Promise<never>): ClassificadorPort & { chamadas: number } {
  const classificador = {
    fornecedor: 'teste',
    chamadas: 0,
    async classificar() {
      classificador.chamadas += 1
      return fazer()
    },
  }
  return classificador
}

describe('as perguntas', () => {
  // Uma cópia em cada lugar deriva, e a concordância passaria a medir a
  // diferença entre dois textos, não entre dois modelos.
  it('a categoria usa as MESMAS descrições do prompt da interpretação', () => {
    expect(PERGUNTAS_DA_INGESTAO.categoria.opcoes).toBe(DESCRICAO_DAS_CATEGORIAS_PARA_IA)
    for (const [codigo, descricao] of Object.entries(DESCRICAO_DAS_CATEGORIAS_PARA_IA)) {
      expect(INSTRUCOES).toContain(`- ${codigo}: ${descricao}`)
    }
  })

  it('cada pergunta diz ao modelo que o bloco delimitado é dado, não instrução', () => {
    for (const pergunta of Object.values(PERGUNTAS_DA_INGESTAO)) {
      expect(pergunta.instrucoes).toContain(MARCADOR_INICIO)
      expect(pergunta.instrucoes).toContain(MARCADOR_FIM)
      expect(pergunta.instrucoes).toMatch(/nunca instrução/)
    }
  })

  it('passam pela conferência da política comum', async () => {
    const classificacao = await dubleDaPolitica().classificar({ texto: 'x', perguntas: PERGUNTAS_DA_INGESTAO })
    expect(Object.keys(classificacao.respostas).sort()).toEqual(['categoria', 'suspeita'])
  })
})

// "A pergunta é do código" só é verdade enquanto ninguém montar uma fora
// daqui: `instrucoes` e rótulos saem SEM a camada de defesa (revisão do #142).
describe('varredura: só este módulo pergunta ao classificador', () => {
  const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

  function arquivos(pasta: string): string[] {
    return readdirSync(pasta).flatMap((nome) => {
      const caminho = join(pasta, nome)
      if (statSync(caminho).isDirectory()) return arquivos(caminho)
      return /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : []
    })
  }

  it('`classificar(` só aparece em `servicos/segunda-opiniao.ts`, com as perguntas constantes', () => {
    const chamadores = ['servicos', 'app', 'componentes', 'servidor', 'core']
      .flatMap((pasta) => arquivos(join(RAIZ, pasta)))
      .filter((arquivo) => /\.classificar\(/.test(readFileSync(arquivo, 'utf8')))
      .map((arquivo) => relative(RAIZ, arquivo).replaceAll('\\', '/'))
    expect(chamadores).toEqual(['servicos/segunda-opiniao.ts'])

    const fonte = readFileSync(join(RAIZ, 'servicos/segunda-opiniao.ts'), 'utf8')
    const chamadas = fonte.match(/\.classificar\([^)]*\)/g) ?? []
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0]).toContain('perguntas: PERGUNTAS_DA_INGESTAO')
  })
})

describe('o texto classificado', () => {
  it('leva assunto, corpo e nomes de anexo — os três vêm do remetente', () => {
    const texto = textoParaClassificar(EMAIL)
    expect(texto).toContain('Assunto: Envio de documentos')
    expect(texto).toContain('Segue meu diploma.')
    expect(texto).toContain('Anexos: diploma.pdf')
  })

  it('sem conteúdo nenhum, é vazio', () => {
    expect(textoParaClassificar({ assunto: '  ', corpo: '', anexos: [] })).toBe('')
  })

  // O nome do anexo também passa pela camada de defesa: o que sai é o protegido.
  it('o que sai para o fornecedor passa pela camada de defesa', async () => {
    const recebidos: string[] = []
    const cliente: ClienteDeClassificacao = {
      async perguntar(pedido) {
        recebidos.push(pedido.estado)
        return clienteMock().perguntar(pedido)
      },
    }
    await colherSegundaOpiniao(
      new ClassificadorExterno(PERFIL_MOCK, cliente),
      { ...EMAIL, anexos: [{ ...EMAIL.anexos[0]!, nome: 'CPF 12345678909.pdf' }] },
      novoEstadoDaSegundaOpiniao(),
      'c',
    )
    expect(recebidos[0]).not.toContain('123.456.789-09')
    expect(recebidos[0]).not.toContain('12345678909')
  })
})

describe('colher a opinião nunca derruba o e-mail', () => {
  it('texto vazio não chama ninguém', async () => {
    const classificador = classificadorQue(() => Promise.reject(new Error('não devia ser chamado')))
    const opiniao = await colherSegundaOpiniao(
      classificador,
      { ...EMAIL, assunto: '', corpo: '', anexos: [] },
      novoEstadoDaSegundaOpiniao(),
      'c',
    )
    expect(opiniao).toEqual({ tipo: 'sem_texto' })
    expect(classificador.chamadas).toBe(0)
  })

  it('falha do fornecedor e defeito nosso viram "falhou", sem lançar', async () => {
    for (const [erro, motivo] of [
      [new FalhaDeClassificacao('a TypeSafe respondeu 500'), 'falha_do_fornecedor'],
      [new TypeError('contrato quebrado'), 'defeito'],
    ] as const) {
      const opiniao = await colherSegundaOpiniao(
        classificadorQue(() => Promise.reject(erro)),
        EMAIL,
        novoEstadoDaSegundaOpiniao(),
        'c',
      )
      expect(opiniao).toEqual({ tipo: 'falhou', motivo })
    }
  })

  it('indisponível para de perguntar no resto do lote, e conta quantos ficaram sem', async () => {
    const estado = novoEstadoDaSegundaOpiniao()
    const classificador = classificadorQue(() => Promise.reject(new ClassificadorIndisponivelError('teto diário')))

    expect(await colherSegundaOpiniao(classificador, EMAIL, estado, 'c')).toEqual({
      tipo: 'falhou',
      motivo: 'indisponivel',
    })
    expect(await colherSegundaOpiniao(classificador, EMAIL, estado, 'c')).toBeNull()
    expect(await colherSegundaOpiniao(classificador, EMAIL, estado, 'c')).toBeNull()

    expect(classificador.chamadas).toBe(1)
    expect(estado.semPergunta).toBe(2)
    expect(estado.indisponivel?.causa).toMatch(/teto diário/)
  })
})

describe('o que vai para a trilha', () => {
  const interpretacao = {
    conteudoSuspeito: false,
    itens: [{ categoriaCodigo: 'DOC_CADASTRO' }, { categoriaCodigo: 'DOC_CADASTRO' }],
  } as Parameters<typeof registroDaOpiniao>[1]

  it('só códigos e números: nem texto do e-mail, nem a confiança do fornecedor', async () => {
    const opiniao = await colherSegundaOpiniao(dubleDaPolitica(), EMAIL, novoEstadoDaSegundaOpiniao(), 'c')
    const registro = registroDaOpiniao(opiniao!, interpretacao)

    expect(registro).toMatchObject({
      resultado: 'colhida',
      fornecedor: 'mock',
      categoria: {
        interpretacao: ['DOC_CADASTRO'],
        // O dublê responde sempre o primeiro rótulo.
        classificador: 'DOC_CADASTRO',
        probabilidade: 1,
        concordancia: 'concorda',
      },
      suspeita: { interpretacao: false, probabilidadeDoClassificador: 0 },
    })
    const serializado = JSON.stringify(registro)
    expect(serializado).not.toMatch(/diploma|associada|exemplo\.test|123\.456/)
    expect(serializado).not.toMatch(/confianca/)
    // Sem espaço em lugar nenhum: nenhuma frase, de ninguém, entrou.
    expect(serializado).not.toMatch(/\s/)
  })

  it('opinião que não veio registra só o motivo', () => {
    expect(registroDaOpiniao({ tipo: 'falhou', motivo: 'indisponivel' }, interpretacao)).toEqual({
      resultado: 'indisponivel',
    })
    expect(registroDaOpiniao({ tipo: 'sem_texto' }, interpretacao)).toEqual({ resultado: 'sem_texto' })
  })
})

describe('na ingestão, em modo sombra', () => {
  const banco = obterPrisma()

  beforeEach(async () => {
    await limparTudo(banco)
  })

  async function sincronizarDia(classificador: ClassificadorPort | null) {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const [data] = sequenciaDeDatas(DATA_BASE, 1)
    const resumo = await sincronizar(
      {
        banco,
        ingestao: new IngestaoMock({ datas: [data!], semente: 7, incluirMalicioso: true }),
        ia: new IaMock(),
        classificador,
      },
      base.operador,
    )
    const itens = await banco.item.findMany({
      select: { status: true, confianca: true, email: { select: { messageId: true } } },
      orderBy: [{ email: { messageId: 'asc' } }, { sequencia: 'asc' }],
    })
    // O que o fluxo produz, além dos itens: a marca de suspeito no e-mail e a
    // fila de revisão. Qualquer um dos três mudando é a opinião decidindo.
    const emails = await banco.email.findMany({
      select: { messageId: true, conteudoSuspeito: true },
      orderBy: { messageId: 'asc' },
    })
    const revisoes = await banco.revisao.findMany({
      select: { motivo: true, item: { select: { email: { select: { messageId: true } } } } },
      orderBy: [{ item: { email: { messageId: 'asc' } } }, { item: { sequencia: 'asc' } }],
    })
    const opinioes = await banco.eventoProcessamento.findMany({
      where: { correlacaoId: resumo.correlacaoId, etapa: 'segunda_opiniao' },
    })
    return { resumo, itens, emails, revisoes, opinioes }
  }

  const semCorrelacao = ({ correlacaoId: _, ...resto }: { correlacaoId: string }) => resto

  // O coração do modo sombra: com ou sem opinião, o trabalho é o mesmo.
  it('não muda nada no fluxo: mesmo resumo, itens, e-mails e revisões', async () => {
    const sem = await sincronizarDia(null)
    await limparTudo(banco)
    const com = await sincronizarDia(dubleDaPolitica())

    expect(semCorrelacao(com.resumo)).toEqual(semCorrelacao(sem.resumo))
    expect(com.itens).toEqual(sem.itens)
    expect(com.emails).toEqual(sem.emails)
    expect(com.revisoes).toEqual(sem.revisoes)
    expect(sem.opinioes).toHaveLength(0)
  })

  it('cada e-mail novo ganha uma opinião, gravada só com códigos e números', async () => {
    const { resumo, opinioes } = await sincronizarDia(dubleDaPolitica())

    expect(resumo.novos).toBeGreaterThan(0)
    expect(opinioes).toHaveLength(resumo.novos)
    expect(new Set(opinioes.map((evento) => evento.referencia)).size).toBe(resumo.novos)
    for (const evento of opinioes) {
      expect(evento.situacao).toBe('sucesso')
      expect(JSON.parse(evento.detalhe!)).toMatchObject({ resultado: 'colhida', fornecedor: 'mock' })
      expect(evento.detalhe).not.toMatch(/\s/)
    }

    // O e-mail com injeção: a política viu o padrão no texto original.
    const suspeitos = opinioes.filter((evento) => JSON.parse(evento.detalhe!).suspeita.padraoNoTexto)
    expect(suspeitos.length).toBeGreaterThan(0)
  })

  // Invariante 14: a opinião nasce na transação do e-mail, ou não nasce.
  it('e-mail cuja transação aborta não deixa opinião na trilha', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    // Os e-mails de liga deste dia abortam (categoria ausente do banco); os outros entram.
    await banco.categoria.delete({ where: { codigo: 'LIGA' } })
    const [data] = sequenciaDeDatas(DATA_BASE, 1)
    const resumo = await sincronizar(
      {
        banco,
        ingestao: new IngestaoMock({ datas: [data!], semente: 7 }),
        ia: new IaMock(),
        classificador: dubleDaPolitica(),
      },
      base.operador,
    )

    const abortados = await banco.eventoProcessamento.findMany({
      where: { correlacaoId: resumo.correlacaoId, etapa: 'ingestao', situacao: 'reprocessavel' },
      select: { referencia: true },
    })
    // Sem isto, o teste passaria num dia em que nenhum e-mail fosse de liga.
    expect(abortados.length).toBeGreaterThan(0)

    const opinioes = await banco.eventoProcessamento.findMany({
      where: { correlacaoId: resumo.correlacaoId, etapa: 'segunda_opiniao' },
      select: { referencia: true },
    })
    const comOpiniao = new Set(opinioes.map((evento) => evento.referencia))
    for (const { referencia } of abortados) expect(comOpiniao.has(referencia)).toBe(false)
    expect(opinioes).toHaveLength(resumo.novos)
  })

  it('classificador indisponível: o lote segue igual, e um evento diz a causa e quantos ficaram sem', async () => {
    const sem = await sincronizarDia(null)
    await limparTudo(banco)
    const indisponivel = new ClassificadorExterno(
      { ...PERFIL_MOCK, ehCredencialRecusada: () => true },
      {
        async perguntar() {
          throw Object.assign(new Error('a TypeSafe respondeu 401'), { status: 401 })
        },
      },
    )
    const com = await sincronizarDia(indisponivel)

    expect(semCorrelacao(com.resumo)).toEqual(semCorrelacao(sem.resumo))
    expect(com.itens).toEqual(sem.itens)
    expect(com.emails).toEqual(sem.emails)
    expect(com.revisoes).toEqual(sem.revisoes)

    const doPrimeiro = com.opinioes.filter((evento) => evento.referencia !== null)
    expect(doPrimeiro).toHaveLength(1)
    expect(JSON.parse(doPrimeiro[0]!.detalhe!)).toEqual({ resultado: 'indisponivel' })

    const doLote = com.opinioes.filter((evento) => evento.referencia === null)
    expect(doLote).toHaveLength(1)
    expect(doLote[0]!.situacao).toBe('falha')
    expect(doLote[0]!.mensagem).toMatch(/401/)
    expect(JSON.parse(doLote[0]!.detalhe!)).toEqual({ resultado: 'indisponivel', semPergunta: com.resumo.novos - 1 })
  })
})
