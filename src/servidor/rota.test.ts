import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { ConservacaoVioladaError, ElegiveisInvalidosError, ErroDeNegocio } from '../core/erros'
import { FalhaDoAssistente } from '../ports/assistente'
import { FalhaDeInterpretacao } from '../ports/ia'
import { PermissaoNegadaError, atorDaSessao } from './ator'
import { rota } from './http'
import { obterPrisma } from './prisma'
import { SemSessaoError, SenhaProvisoriaError } from './sessao'

/**
 * `rota()` — o único lugar que traduz erro em status HTTP.
 *
 * Achado 8 da auditoria de 08/09/2026: só o ramo 500 tinha prova. Nenhum teste
 * cobria 401, 403, 400, 422 nem o ramo de `ErroOperacional`, cujo comentário diz
 * que sem ele "seis classes com mensagem escrita para humano chegavam à tela
 * como Erro interno". `mensagemPublica` não era mencionada em teste nenhum.
 *
 * Duas promessas em sentidos opostos, e as duas precisam de prova: abaixo de 500
 * a mensagem chega INTEIRA (ela foi escrita para quem usa); de 500 para cima,
 * nada do erro atravessa.
 */

const lancar = (erro: unknown) => rota(async () => Promise.reject(erro))

const colaborador = atorDaSessao({ colaboradorId: 'pessoa-sintetica', papel: 'colaborador' })

describe('rota(): erro de uso chega à tela com a mensagem inteira', () => {
  it.each([
    ['sessão ausente', 401, () => new SemSessaoError()],
    ['senha provisória', 403, () => new SenhaProvisoriaError()],
    [
      'papel sem permissão',
      403,
      () => new PermissaoNegadaError(colaborador, 'confirmar distribuição'),
    ],
    ['regra de negócio', 422, () => new ErroDeNegocio('Transferência exige justificativa.')],
  ] as const)('%s responde %i', async (_, status, criar) => {
    const erro = criar()
    const resposta = await lancar(erro)

    expect(resposta.status).toBe(status)
    expect(await resposta.json()).toEqual({ sucesso: false, dados: null, erro: erro.message })
  })

  it('validação responde 400 dizendo QUAL campo falhou', async () => {
    const erro = z.object({ data: z.string() }).safeParse({}).error
    const resposta = await lancar(erro)

    expect(resposta.status).toBe(400)
    expect((await resposta.json()).erro).toBe('Data: é obrigatório.')
  })

  it('papel sem permissão: frase para a equipe, sem papel, operação nem lista de permitidos (N-28)', async () => {
    // Antes: `Papel "colaborador" não pode executar "confirmar distribuição".
    // Permitidos: operador, gestor.` — vocabulário interno e o mapa de
    // permissões entregue a quem sonda. Quem, papel e operação continuam no
    // rastro de C-24, que é onde a investigação precisa deles.
    const resposta = await lancar(new PermissaoNegadaError(colaborador, 'confirmar distribuição'))
    const { erro } = await resposta.json()

    expect(resposta.status).toBe(403)
    expect(erro).toBe('Seu acesso não permite esta ação. Se precisar dela, fale com a gestão do setor.')
  })
})

describe('rota(): falha operacional', () => {
  it('devolve o status da classe e a mensagemPublica — nunca a causa crua', async () => {
    const resposta = await lancar(new FalhaDoAssistente('invalid_type em itens.0.confianca'))
    const corpo = await resposta.json()

    expect(resposta.status).toBe(503)
    expect(corpo.erro).toBe('Não consegui responder agora. Tente de novo em alguns instantes.')
    expect(corpo.erro).not.toContain('invalid_type')
  })

  it('quando a mensagem pública é a própria mensagem, ela chega inteira', async () => {
    const erro = new FalhaDeInterpretacao('msg-sintetica@teste.local', 'resposta vazia')
    const resposta = await lancar(erro)

    expect(resposta.status).toBe(422)
    expect((await resposta.json()).erro).toBe(erro.message)
  })
})

describe('rota(): falha do servidor não fala', () => {
  it('conservação violada vira 500 sem a alocação — nem na resposta, nem na memória', async () => {
    const idDaColega = 'colaboradora-sintetica-7f3a'
    const resposta = await lancar(new ConservacaoVioladaError(3, 2, { [idDaColega]: 2 }))
    const corpo = await resposta.json()

    expect(resposta.status).toBe(500)
    expect(JSON.stringify(corpo)).not.toContain(idDaColega)
    expect(corpo.correlacaoId).toEqual(expect.any(String))

    // O identificador promete rastreabilidade — e a consulta de memória é um
    // cliente também, uma requisição depois.
    const evento = await obterPrisma().eventoProcessamento.findFirst({
      where: { correlacaoId: corpo.correlacaoId },
    })
    expect(evento).not.toBeNull()
    expect(evento?.mensagem ?? '').not.toContain(idDaColega)
  })

  // A lista de elegíveis é montada pelo servidor a partir do banco
  // (`carregarElegiveis`): quem usa não escolhe quem entra nela. Se ela chega
  // inválida ao motor, o defeito é nosso — e a mensagem traz o id interno de
  // uma colega, que não serve a quem está na tela (pendência 1, 25/09/2026).
  it('lista de elegíveis inválida vira 500 sem o id da colega', async () => {
    const idDaColega = 'colaboradora-sintetica-9b21'
    const resposta = await lancar(new ElegiveisInvalidosError(`colaborador "${idDaColega}" aparece duas vezes`))
    const corpo = await resposta.json()

    expect(resposta.status).toBe(500)
    expect(JSON.stringify(corpo)).not.toContain(idDaColega)
    expect(corpo.correlacaoId).toEqual(expect.any(String))

    // A memória é um cliente também: quem recebeu o 500 tem o papel que lê
    // `/api/memoria` e tem o identificador na mão (revisões do PR #120).
    const evento = await obterPrisma().eventoProcessamento.findFirst({
      where: { correlacaoId: corpo.correlacaoId },
    })
    expect(evento).not.toBeNull()
    expect(evento?.mensagem ?? '').not.toContain(idDaColega)
  })

  it('erro inesperado vira 500 genérico, sem a mensagem original', async () => {
    const resposta = await lancar(new Error('falha ao gravar: e-mail pessoa@teste.local já existe'))
    const corpo = await resposta.json()

    expect(resposta.status).toBe(500)
    expect(corpo.erro).toMatch(/^Erro interno\./)
    expect(JSON.stringify(corpo)).not.toContain('pessoa@teste.local')
  })
})
