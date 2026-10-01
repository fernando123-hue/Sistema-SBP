import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IaMock } from '../adapters/ia-mock'
import { IngestaoMock } from '../adapters/ingestao-mock'
import type { EmailBruto } from '../core/esquemas'
import { sequenciaDeDatas } from '../core/util/datas'
import type { AiPort } from '../ports/ia'
import { InterpretacaoIndisponivelError } from '../ports/ia'
import { ErroOperacional } from '../core/erros'
import { PermissaoNegadaError } from '../servidor/ator'
import { obterPrisma } from '../servidor/prisma'
import { DATA_BASE, limparTudo, semearBase } from '../testes/apoio'
import {
  esperarBuscaParaTeste,
  estadoDaBusca,
  iniciarBusca,
  LIMITE_SEM_AVANCO_MS,
  zerarBuscaParaTeste,
} from './busca-em-segundo-plano'

/**
 * A busca de e-mails roda no servidor e a tela só acompanha.
 *
 * Antes, `POST /api/ingestao` esperava a busca inteira. Com a IA local a
 * 11,3 s por e-mail (medido em 01/10/2026), a tela ficava minutos presa e um
 * proxy cortava a resposta em 60 s, com o servidor ainda trabalhando.
 */

const banco = obterPrisma()

/** Uma IA que só responde quando o teste solta: é o que deixa ver a busca "no meio". */
function iaSegurada(): { ia: AiPort; soltar: () => void; chamadas: () => number } {
  const real = new IaMock()
  let soltar: () => void = () => {}
  const portao = new Promise<void>((pronto) => {
    soltar = pronto
  })
  let chamadas = 0
  return {
    ia: {
      nome: real.nome,
      async interpretar(email: EmailBruto) {
        chamadas += 1
        await portao
        return real.interpretar(email)
      },
    },
    soltar: () => soltar(),
    chamadas: () => chamadas,
  }
}

function dependencias(ia: AiPort) {
  return { banco, ingestao: new IngestaoMock({ datas: sequenciaDeDatas(DATA_BASE, 1), semente: 5 }), ia }
}

/** Espera até a condição valer, sem dormir um tempo fixo: o laço da busca é assíncrono. */
async function ate(condicao: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !condicao(); i += 1) await new Promise((pronto) => setTimeout(pronto, 5))
  expect(condicao()).toBe(true)
}

/** Como `ate`, para uma condição que precisa perguntar ao banco. */
async function ateNoBanco(condicao: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 500 && !(await condicao()); i += 1) await new Promise((pronto) => setTimeout(pronto, 10))
  expect(await condicao()).toBe(true)
}

/** Quantas buscas gravaram o evento de fechamento ("N novos · M duplicados · K itens"). */
function buscasFechadas(): Promise<number> {
  return banco.eventoProcessamento.count({ where: { etapa: 'ingestao', mensagem: { contains: ' novos · ' } } })
}

beforeEach(async () => {
  zerarBuscaParaTeste()
  await limparTudo(banco)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await esperarBuscaParaTeste()
  zerarBuscaParaTeste()
})

describe('a busca roda no servidor e a tela acompanha', () => {
  it('iniciar volta na hora, com a busca rodando; o andamento sobe e-mail a e-mail; no fim vem o resumo', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const segurada = iaSegurada()

    const pedido = iniciarBusca(dependencias(segurada.ia), base.operador)
    expect(pedido.iniciada).toBe(true)
    expect(pedido.estado.situacao).toBe('rodando')

    // Parada no primeiro e-mail: a busca sabe o total e ainda não leu nenhum.
    await ate(() => segurada.chamadas() === 1)
    const noMeio = estadoDaBusca(base.operador)
    expect(noMeio).toMatchObject({ situacao: 'rodando', lidos: 0 })
    if (noMeio.situacao !== 'rodando') throw new Error('inalcançável')
    expect(noMeio.total).toBeGreaterThan(1)

    segurada.soltar()
    await esperarBuscaParaTeste()

    const fim = estadoDaBusca(base.operador)
    if (fim.situacao !== 'concluida') throw new Error(`esperava concluída, veio ${fim.situacao}`)
    expect(fim.resumo.recebidos).toBe(noMeio.total)
    expect(fim.resumo.novos).toBe(noMeio.total)
    expect(await banco.email.count()).toBe(noMeio.total)
  })

  it('pedir de novo enquanto roda devolve a mesma busca: a IA não é chamada duas vezes para o mesmo e-mail', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const primeira = iaSegurada()
    const segunda = iaSegurada()

    iniciarBusca(dependencias(primeira.ia), base.operador)
    await ate(() => primeira.chamadas() === 1)
    const repetido = iniciarBusca(dependencias(segunda.ia), base.operador)

    expect(repetido.iniciada).toBe(false)
    expect(repetido.estado.situacao).toBe('rodando')
    primeira.soltar()
    await esperarBuscaParaTeste()
    expect(segunda.chamadas()).toBe(0)

    // Terminada, uma busca nova pode começar, e não repete os e-mails já lidos.
    segunda.soltar()
    const depois = iniciarBusca(dependencias(segunda.ia), base.operador)
    expect(depois.iniciada).toBe(true)
    await esperarBuscaParaTeste()
    const fim = estadoDaBusca(base.operador)
    if (fim.situacao !== 'concluida') throw new Error(`esperava concluída, veio ${fim.situacao}`)
    expect(fim.resumo.novos).toBe(0)
    expect(segunda.chamadas()).toBe(0)
  })

  it('a IA fora do ar termina a busca como falha, com a mesma frase que a rota mostrava antes', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const recusa = new InterpretacaoIndisponivelError('a chave da IA foi recusada')
    const foraDoAr: AiPort = {
      nome: 'fora-do-ar',
      interpretar: async () => {
        throw recusa
      },
    }

    iniciarBusca(dependencias(foraDoAr), base.operador)
    await esperarBuscaParaTeste()

    const fim = estadoDaBusca(base.operador)
    if (fim.situacao !== 'falhou') throw new Error(`esperava falhou, veio ${fim.situacao}`)
    // O critério de `rota()`: falha esperada de fronteira sai pela
    // `mensagemPublica`, que cada classe decide quanto da causa pode mostrar.
    expect(fim.erro).toBe(recusa.mensagemPublica)
    // Na trilha também, com a mesma frase: o estado vive só em memória.
    const evento = await banco.eventoProcessamento.findFirst({
      where: { etapa: 'ingestao', situacao: 'reprocessavel', mensagem: recusa.mensagemPublica },
    })
    expect(evento).not.toBeNull()
  })

  it('um defeito qualquer vira frase com código para rastrear, nunca a mensagem crua', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const quebrada: AiPort = {
      nome: 'quebrada',
      interpretar: async () => {
        throw new TypeError('detalhe interno com CPF 123.456.789-09')
      },
    }
    // Defeito por e-mail não para o lote (vira `falhas` no resumo); o que para
    // é a leitura da caixa. É ela que este teste quebra.
    const deps = { ...dependencias(quebrada), ingestao: { nome: 'caixa-quebrada', buscarNovos: async () => { throw new TypeError('detalhe interno com CPF 123.456.789-09') } } }

    iniciarBusca(deps, base.operador)
    await esperarBuscaParaTeste()

    const fim = estadoDaBusca(base.operador)
    if (fim.situacao !== 'falhou') throw new Error(`esperava falhou, veio ${fim.situacao}`)
    expect(fim.erro).toMatch(/A busca parou por um erro do sistema\. Avise a gestão com o código \S+\./)
    expect(fim.erro).not.toContain('123.456')
    const evento = await banco.eventoProcessamento.findFirst({ where: { etapa: 'ingestao', situacao: 'falha' } })
    expect(evento).not.toBeNull()
  })

  it('colaborador não inicia nem acompanha a busca', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const colaborador = base.colaboradores[0]!.ator

    expect(() => iniciarBusca(dependencias(new IaMock()), colaborador)).toThrow(PermissaoNegadaError)
    expect(() => estadoDaBusca(colaborador)).toThrow(PermissaoNegadaError)
    expect(await banco.email.count()).toBe(0)
  })

  it('o estado devolvido é uma cópia: quem o recebe não mexe no da busca', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const segurada = iaSegurada()
    iniciarBusca(dependencias(segurada.ia), base.operador)
    await ate(() => segurada.chamadas() === 1)

    const visto = estadoDaBusca(base.operador) as { situacao: string }
    visto.situacao = 'concluida'
    expect(estadoDaBusca(base.operador).situacao).toBe('rodando')
    segurada.soltar()
  })
})

describe('a busca nunca fica presa em "rodando" (revisões do #178)', () => {
  it('um erro ao montar a frase da falha ainda tira a busca de "rodando", e outra pode começar', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    class ErroTraicoeiro extends ErroOperacional {
      readonly codigo = 'TRAICOEIRO'
      readonly statusHttp = 503 as const
      override get mensagemPublica(): string {
        throw new Error('a frase quebrou')
      }
    }
    const quebraAFrase: AiPort = {
      nome: 'quebra-a-frase',
      interpretar: async () => {
        throw new ErroTraicoeiro('x')
      },
    }
    // Erro operacional por e-mail não para o lote; o que para é a leitura da caixa.
    const deps = {
      ...dependencias(quebraAFrase),
      ingestao: { nome: 'caixa', buscarNovos: async () => { throw new ErroTraicoeiro('x') } },
    }

    iniciarBusca(deps, base.operador)
    await esperarBuscaParaTeste()

    const fim = estadoDaBusca(base.operador)
    if (fim.situacao !== 'falhou') throw new Error(`esperava falhou, veio ${fim.situacao}`)
    expect(fim.erro).toMatch(/nem o registro dele foi possível/)
    expect(iniciarBusca(dependencias(new IaMock()), base.operador).iniciada).toBe(true)
  })

  it(`sem avançar por ${LIMITE_SEM_AVANCO_MS / 60_000} min, outra busca assume; a antiga, quando termina, não apaga a nova`, async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const antiga = iaSegurada()
    iniciarBusca(dependencias(antiga.ia), base.operador)
    await ate(() => antiga.chamadas() === 1)

    // Antes do limite, pedir de novo devolve a que está rodando.
    expect(iniciarBusca(dependencias(new IaMock()), base.operador).iniciada).toBe(false)

    const nova = iaSegurada()
    const agora = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(agora + LIMITE_SEM_AVANCO_MS + 1)
    const pedido = iniciarBusca(dependencias(nova.ia), base.operador)
    vi.restoreAllMocks()
    expect(pedido.iniciada).toBe(true)
    if (pedido.estado.situacao !== 'rodando') throw new Error('inalcançável')
    const daNova = pedido.estado.iniciadaEm
    await ate(() => nova.chamadas() === 1)

    // A antiga termina PRIMEIRO, com a nova ainda segurada: o fim dela fica na
    // trilha (`sincronizar` grava o evento de fechamento), mas não no estado.
    antiga.soltar()
    await ateNoBanco(async () => (await buscasFechadas()) === 1)
    expect(estadoDaBusca(base.operador)).toMatchObject({ situacao: 'rodando', iniciadaEm: daNova })

    nova.soltar()
    await esperarBuscaParaTeste()
    const fim = estadoDaBusca(base.operador)
    if (fim.situacao !== 'concluida') throw new Error(`esperava concluída, veio ${fim.situacao}`)
    expect(fim.iniciadaEm).toBe(daNova)
  })
})
