import { beforeEach, describe, expect, it } from 'vitest'

import { IaMock } from '../adapters/ia-mock'
import { IngestaoMock } from '../adapters/ingestao-mock'
import { sequenciaDeDatas } from '../core/util/datas'
import { obterPrisma, type Banco, type Transacao } from '../servidor/prisma'
import { DATA_BASE, aprovarTudoNoBanco, atorDeTeste, limparTudo, semearBase } from '../testes/apoio'
import { definirAtivacao } from './autenticacao'
import { confirmar } from './distribuicao'
import { sincronizar } from './ingestao'

/**
 * Distribuição e desativação ao mesmo tempo (achado N-33).
 *
 * A distribuição escolhe quem recebe numa fotografia do banco. Se a gestora
 * desliga uma pessoa DEPOIS dessa fotografia e ANTES de a distribuição gravar,
 * a desativação devolve só o que a pessoa já tinha, e a distribuição grava
 * itens novos para ela logo em seguida — a chave estrangeira não olha `ativo`.
 * Os itens ficam `distribuido` na fila de quem não abre sessão, fora de "Por
 * pessoa", e ninguém os recolhe: o "item some do mundo" que `definirAtivacao`
 * foi corrigida para evitar.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

/**
 * Banco cuja transação PARA na primeira gravação de rodada, até ser liberada.
 * É o intervalo entre planejar e gravar, alargado para caber a desativação.
 */
function bancoQuePausaAntesDeGravar(original: Banco) {
  let chegou: () => void = () => {}
  let liberar: () => void = () => {}
  const chegouNaGravacao = new Promise<void>((pronto) => {
    chegou = pronto
  })
  const podeGravar = new Promise<void>((pronto) => {
    liberar = pronto
  })
  let pausou = false

  const pausar = (tx: Transacao): Transacao =>
    new Proxy(tx, {
      get(alvo, chave) {
        const valor: unknown = Reflect.get(alvo, chave)
        if (chave !== 'rodadaDistribuicao') return valor
        return new Proxy(valor as object, {
          get(delegate, metodo) {
            const funcao: unknown = Reflect.get(delegate, metodo)
            if (metodo !== 'create' || typeof funcao !== 'function') return funcao
            return async (...argumentos: unknown[]) => {
              if (!pausou) {
                pausou = true
                chegou()
                await podeGravar
              }
              return (funcao as (...a: unknown[]) => unknown).apply(delegate, argumentos)
            }
          },
        })
      },
    })

  const comPausa = new Proxy(original, {
    get(alvo, chave) {
      if (chave !== '$transaction') return Reflect.get(alvo, chave)
      return (executar: (tx: Transacao) => Promise<unknown>) =>
        alvo.$transaction((tx) => executar(pausar(tx)), { timeout: 30_000 })
    },
  })

  return { banco: comPausa, chegouNaGravacao, liberar: () => liberar() }
}

describe('distribuição concorrente com a desativação de uma pessoa (N-33)', () => {
  it('nenhuma atribuição ativa fica com quem foi desligado', async () => {
    const base = await semearBase(banco, { totalDeDias: 1, pessoasDePlantao: 3 })
    const datas = sequenciaDeDatas(DATA_BASE, 1)
    await sincronizar(
      { banco, ingestao: new IngestaoMock({ datas, semente: 5 }), ia: new IaMock() },
      base.operador,
    )
    await aprovarTudoNoBanco(banco)
    const gestor = await banco.colaborador.create({
      data: { nome: 'Gestora de Teste', email: 'gestora@teste.local', papel: 'gestor' },
    })
    const desligada = base.colaboradores[0]!.id

    const pausa = bancoQuePausaAntesDeGravar(banco)
    const distribuicao = confirmar(pausa.banco, { data: datas[0]!, categorias: [] }, base.operador)
    // Não deixa uma rejeição da distribuição escapar sem dono enquanto o teste espera.
    distribuicao.catch(() => {})

    await pausa.chegouNaGravacao
    const desativacao = definirAtivacao(
      banco,
      { colaboradorId: desligada, ativo: false },
      atorDeTeste(gestor.id, 'gestor'),
    )
    desativacao.catch(() => {})

    // Sem a correção, a desativação termina aqui, no meio da distribuição.
    // Com ela, espera a distribuição e só então devolve o que foi gravado.
    await new Promise((pronto) => setTimeout(pronto, 800))
    pausa.liberar()

    const [resultadoDaDistribuicao, resultadoDaDesativacao] = await Promise.allSettled([
      distribuicao,
      desativacao,
    ])

    // A desligada fica desligada: a desativação não pode se perder no conflito.
    expect(resultadoDaDesativacao.status).toBe('fulfilled')
    expect((await banco.colaborador.findUniqueOrThrow({ where: { id: desligada } })).ativo).toBe(false)

    // O invariante: nenhum item aberto na fila de quem não abre sessão.
    const orfas = await banco.atribuicao.count({
      where: {
        ativa: true,
        colaborador: { ativo: false },
        item: { status: { in: ['distribuido', 'em_andamento'] } },
      },
    })
    expect(orfas).toBe(0)

    // E a distribuição, se passou, deixou trabalho com alguém.
    if (resultadoDaDistribuicao.status === 'fulfilled') {
      expect(await banco.atribuicao.count({ where: { ativa: true } })).toBeGreaterThan(0)
    }
  }, 60_000)
})
