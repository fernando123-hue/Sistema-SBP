import { beforeEach, describe, expect, it } from 'vitest'

import { IaMock } from '../adapters/ia-mock'
import { IngestaoMock } from '../adapters/ingestao-mock'
import { sequenciaDeDatas } from '../core/util/datas'
import { obterPrisma } from '../servidor/prisma'
import { DATA_BASE, limparTudo, semearBase } from '../testes/apoio'
import { sincronizar } from './ingestao'
import { medirQualidadeDaIa } from './qualidade'
import { aprovarTodosPendentes, listarPendentes, resolver } from './revisao'

/**
 * Medida de acerto da IA — integração.
 *
 * O núcleo puro já tem os testes do CRITÉRIO. O que se verifica aqui é a
 * LEITURA: que o par (sugestão, decisão) gravado pelo fluxo real de revisão é
 * o mesmo par que o cálculo recebe. Um erro de leitura produziria um número
 * plausível e falso — o pior resultado possível para uma métrica que vai
 * autorizar mexer no limiar de confiança.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

async function ingerirUmDia() {
  const base = await semearBase(banco, { totalDeDias: 1 })
  const datas = sequenciaDeDatas(DATA_BASE, 1)
  await sincronizar(
    { banco, ingestao: new IngestaoMock({ datas, semente: 11 }), ia: new IaMock() },
    base.operador,
  )
  return base
}

describe('sem dado nenhum', () => {
  it('taxa nula, não zero', async () => {
    await semearBase(banco, { totalDeDias: 1 })
    const resultado = await medirQualidadeDaIa(banco, null)

    // "Ainda não sei" e "a IA errou tudo" são coisas opostas. A planilha
    // confunde as duas mostrando `0` para linha vazia; aqui não.
    expect(resultado.taxa.taxaDeAceitacao).toBeNull()
    expect(resultado.taxa.revisadas).toBe(0)
    expect(resultado.cobertura.fracaoRevisada).toBeNull()
  })
})

describe('leitura do que o fluxo real gravou', () => {
  it('aprovar em massa conta como aceita sem correção', async () => {
    const base = await ingerirUmDia()
    const { aprovados } = await aprovarTodosPendentes(banco, base.operador)
    expect(aprovados).toBeGreaterThan(0)

    const resultado = await medirQualidadeDaIa(banco, null)

    expect(resultado.taxa.revisadas).toBe(aprovados)
    expect(resultado.taxa.aceitasSemCorrecao).toBe(aprovados)
    expect(resultado.taxa.taxaDeAceitacao).toBe(1)
    expect(resultado.ignoradas).toBe(0)
  })

  it('trocar a categoria na tela aparece como categoria trocada', async () => {
    const base = await ingerirUmDia()
    const { itens: pendentes } = await listarPendentes(banco, 1)
    const alvo = pendentes[0]!

    const outra = alvo.categoriaCodigo === 'LIGANTE' ? 'DOC_CADASTRO' : 'LIGANTE'
    await resolver(
      banco,
      {
        revisaoId: alvo.revisaoId,
        categoriaCodigo: outra,
        titulo: alvo.titulo,
        campos: {},
        aprovar: true,
      },
      base.operador,
    )

    const resultado = await medirQualidadeDaIa(banco, null)

    expect(resultado.taxa.revisadas).toBe(1)
    expect(resultado.taxa.porDesfecho.categoria_trocada).toBe(1)
    expect(resultado.taxa.aceitasSemCorrecao).toBe(0)
    expect(resultado.taxa.taxaDeAceitacao).toBe(0)
    // Agrupado pela categoria que a IA SUGERIU — é o limiar dela que se ajusta.
    expect(resultado.taxa.porCategoriaSugerida[0]?.categoriaCodigo).toBe(alvo.categoriaCodigo)
  })

  it('confirmar a sugestão sem mexer em nada conta como acerto', async () => {
    const base = await ingerirUmDia()
    const { itens: pendentes } = await listarPendentes(banco, 1)
    const alvo = pendentes[0]!
    const camposSugeridos = (JSON.parse(alvo.sugestaoIa) as { campos?: Record<string, string> })
      .campos

    await resolver(
      banco,
      {
        revisaoId: alvo.revisaoId,
        categoriaCodigo: alvo.categoriaCodigo,
        titulo: alvo.titulo,
        campos: camposSugeridos ?? {},
        aprovar: true,
      },
      base.operador,
    )

    const resultado = await medirQualidadeDaIa(banco, null)
    expect(resultado.taxa.porDesfecho.aceita_sem_correcao).toBe(1)
  })

  it('revisão ainda aberta não entra na conta', async () => {
    const base = await ingerirUmDia()
    const antesDeResolver = await medirQualidadeDaIa(banco, null)
    expect(antesDeResolver.taxa.revisadas).toBe(0)

    await aprovarTodosPendentes(banco, base.operador)

    const depois = await medirQualidadeDaIa(banco, null)
    expect(depois.taxa.revisadas).toBeGreaterThan(0)
  })
})

/**
 * Faz nas revisões resolvidas o que a parte (a) do `A23` vai fazer no prazo:
 * título e campos saem da sugestão e da decisão, e fica só o que não é dado
 * pessoal — categoria, confiança, aprovado, quantos itens extras, origem.
 */
async function apagarValoresDasRevisoes() {
  const resolvidas = await banco.revisao.findMany({ where: { resolvidoEm: { not: null } } })
  for (const revisao of resolvidas) {
    const sugestao = JSON.parse(revisao.sugestaoIa) as { categoriaCodigo: string; confianca: number }
    const final = JSON.parse(revisao.valorFinal!) as {
      categoriaCodigo?: string
      aprovado: boolean
      itensExtras?: number
      origem?: string
    }
    await banco.revisao.update({
      where: { id: revisao.id },
      data: {
        sugestaoIa: JSON.stringify({
          categoriaCodigo: sugestao.categoriaCodigo,
          confianca: sugestao.confianca,
        }),
        valorFinal: JSON.stringify({
          categoriaCodigo: final.categoriaCodigo,
          aprovado: final.aprovado,
          itensExtras: final.itensExtras ?? 0,
          origem: final.origem,
        }),
      },
    })
  }
}

async function primeiraPendente() {
  const { itens } = await listarPendentes(banco, 1)
  const alvo = itens[0]!
  const campos = (JSON.parse(alvo.sugestaoIa) as { campos?: Record<string, string> }).campos ?? {}
  return { alvo, campos }
}

describe('acerto gravado na hora da revisão (A23(c))', () => {
  it('campo corrigido continua contado depois que os valores saem', async () => {
    const base = await ingerirUmDia()
    const { alvo, campos } = await primeiraPendente()

    await resolver(
      banco,
      {
        revisaoId: alvo.revisaoId,
        categoriaCodigo: alvo.categoriaCodigo,
        titulo: alvo.titulo,
        campos: { ...campos, cpf: '111.444.777-35' },
        aprovar: true,
      },
      base.operador,
    )
    await apagarValoresDasRevisoes()

    const resultado = await medirQualidadeDaIa(banco, null)

    // Sem o rótulo gravado, a comparação veria campos vazios dos dois lados e
    // contaria ACERTO: um número plausível, falso e sem aviso nenhum.
    expect(resultado.taxa.porDesfecho.campos_corrigidos).toBe(1)
    expect(resultado.taxa.aceitasSemCorrecao).toBe(0)
    expect(resultado.ignoradas).toBe(0)
  })

  it('título editado continua contado depois que os valores saem', async () => {
    const base = await ingerirUmDia()
    const { alvo, campos } = await primeiraPendente()

    await resolver(
      banco,
      {
        revisaoId: alvo.revisaoId,
        categoriaCodigo: alvo.categoriaCodigo,
        titulo: `${alvo.titulo} (corrigido)`,
        campos,
        aprovar: true,
      },
      base.operador,
    )
    await apagarValoresDasRevisoes()

    const resultado = await medirQualidadeDaIa(banco, null)
    expect(resultado.taxa.porDesfecho.titulo_editado).toBe(1)
    expect(resultado.taxa.aceitasSemCorrecao).toBe(0)
  })

  it('grava quais campos mudaram, nunca o que estava escrito', async () => {
    const base = await ingerirUmDia()
    const { alvo, campos } = await primeiraPendente()

    await resolver(
      banco,
      {
        revisaoId: alvo.revisaoId,
        categoriaCodigo: alvo.categoriaCodigo,
        titulo: alvo.titulo,
        campos: { ...campos, cpf: '111.444.777-35', telefone: '(00) 0000-0000' },
        aprovar: true,
      },
      base.operador,
    )

    const gravada = await banco.revisao.findUniqueOrThrow({ where: { id: alvo.revisaoId } })
    expect(gravada.desfecho).toBe('campos_corrigidos')
    const correcoes = JSON.parse(gravada.correcoes!) as { camposAlterados: string[] }
    expect(correcoes.camposAlterados).toEqual(expect.arrayContaining(['cpf', 'telefone']))
    // Esta coluna não tem data de exclusão. Valor aqui seria o CPF guardado
    // para sempre, que é exatamente o que o `A23` decidiu não guardar.
    expect(gravada.correcoes).not.toContain('111.444.777-35')
    expect(gravada.correcoes).not.toContain('0000-0000')
  })

  it('aprovação em massa grava o acerto de cada revisão', async () => {
    const base = await ingerirUmDia()
    const { aprovados } = await aprovarTodosPendentes(banco, base.operador)

    const gravadas = await banco.revisao.findMany({
      where: { resolvidoEm: { not: null } },
      select: { desfecho: true },
    })
    expect(gravadas).toHaveLength(aprovados)
    expect(gravadas.every((gravada) => gravada.desfecho === 'aceita_sem_correcao')).toBe(true)
  })

  it('revisão resolvida antes do rótulo existir ainda é calculada pelos valores', async () => {
    const base = await ingerirUmDia()
    const { alvo } = await primeiraPendente()
    const outra = alvo.categoriaCodigo === 'LIGANTE' ? 'DOC_CADASTRO' : 'LIGANTE'

    await resolver(
      banco,
      { revisaoId: alvo.revisaoId, categoriaCodigo: outra, titulo: alvo.titulo, campos: {}, aprovar: true },
      base.operador,
    )
    await banco.revisao.update({
      where: { id: alvo.revisaoId },
      data: { desfecho: null, correcoes: null },
    })

    const resultado = await medirQualidadeDaIa(banco, null)
    expect(resultado.taxa.porDesfecho.categoria_trocada).toBe(1)
    expect(resultado.ignoradas).toBe(0)
  })

  it('rótulo gravado que não se reconhece é contado, nunca engolido', async () => {
    const base = await ingerirUmDia()
    await aprovarTodosPendentes(banco, base.operador)

    const alguma = await banco.revisao.findFirst({ where: { resolvidoEm: { not: null } } })
    await banco.revisao.update({ where: { id: alguma!.id }, data: { desfecho: 'quase_certo' } })

    const resultado = await medirQualidadeDaIa(banco, null)
    expect(resultado.ignoradas).toBe(1)
  })
})

describe('cobertura', () => {
  it('anda junto com a taxa e nunca fica negativa', async () => {
    const base = await ingerirUmDia()
    await aprovarTodosPendentes(banco, base.operador)

    const resultado = await medirQualidadeDaIa(banco, null)

    expect(resultado.cobertura.itensDeIa).toBeGreaterThan(0)
    expect(resultado.cobertura.naoRevisados).toBeGreaterThanOrEqual(0)
    expect(resultado.cobertura.fracaoRevisada).not.toBeNull()
    expect(resultado.cobertura.fracaoRevisada!).toBeGreaterThan(0)
    expect(resultado.cobertura.fracaoRevisada!).toBeLessThanOrEqual(1)
  })
})

describe('linha ilegível', () => {
  it('é contada, nunca engolida', async () => {
    const base = await ingerirUmDia()
    await aprovarTodosPendentes(banco, base.operador)

    // Simula uma linha gravada por uma versão anterior do pipeline, com JSON
    // que os esquemas de hoje não reconhecem — e, por ser anterior, sem o
    // acerto gravado na hora (`A23(c)`), que dispensaria ler o JSON.
    const alguma = await banco.revisao.findFirst({ where: { resolvidoEm: { not: null } } })
    await banco.revisao.update({
      where: { id: alguma!.id },
      data: { valorFinal: '{"isto":"não é um valor final"}', desfecho: null, correcoes: null },
    })

    const resultado = await medirQualidadeDaIa(banco, null)

    // Desfalcar a amostra em silêncio inflaria ou esvaziaria a taxa sem que
    // ninguém pudesse notar — numa métrica onde ninguém iria procurar.
    expect(resultado.ignoradas).toBe(1)
  })
})

describe('recorte por janela', () => {
  it('taxa e cobertura falam do MESMO universo', async () => {
    const base = await ingerirUmDia()
    await aprovarTodosPendentes(banco, base.operador)

    // Empurra os itens para 90 dias atrás, deixando as revisões resolvidas
    // hoje. É o caso real de quem revisa uma fila acumulada: item velho,
    // decisão nova.
    const antigo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    await banco.item.updateMany({ data: { criadoEm: antigo } })

    const janela = await medirQualidadeDaIa(banco, 30)

    // Se o denominador contasse item por data de criação e o numerador
    // contasse revisão por data de resolução, este caso daria cobertura acima
    // de 100% — e o `Math.min` a esconderia mostrando exatamente 100%, que é
    // pior que o erro: um número redondo e falso.
    expect(janela.cobertura.itensDeIa).toBe(0)
    expect(janela.cobertura.revisados).toBe(0)
    expect(janela.cobertura.fracaoRevisada).toBeNull()

    // E a taxa segue o mesmo recorte: nenhum item da janela, nenhuma revisão
    // na conta. Um universo só.
    expect(janela.taxa.revisadas).toBe(0)
    expect(janela.taxa.taxaDeAceitacao).toBeNull()

    // Sem janela, tudo volta a aparecer.
    const tudo = await medirQualidadeDaIa(banco, null)
    expect(tudo.taxa.revisadas).toBeGreaterThan(0)
    expect(tudo.cobertura.fracaoRevisada).not.toBeNull()
  })

  it('a cobertura nunca passa de 100% nem fica negativa', async () => {
    const base = await ingerirUmDia()
    await aprovarTodosPendentes(banco, base.operador)

    const resultado = await medirQualidadeDaIa(banco, null)

    expect(resultado.cobertura.revisados).toBeLessThanOrEqual(resultado.cobertura.itensDeIa)
    expect(resultado.cobertura.naoRevisados).toBeGreaterThanOrEqual(0)
    expect(resultado.cobertura.fracaoRevisada!).toBeLessThanOrEqual(1)
  })
})
