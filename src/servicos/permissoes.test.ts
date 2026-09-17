import { describe, expect, it } from 'vitest'

import { PermissaoNegadaError } from '../servidor/ator'
import { obterPrisma } from '../servidor/prisma'
import { atorDeTeste } from '../testes/apoio'
import { criarColaborador, definirHabilitacoes } from './colaboradores'
import { definirAtivacao, definirSenhaProvisoria, destravarConta } from './autenticacao'
import { confirmar, previa } from './distribuicao'
import { definirEscala } from './escala'
import { minhaFila } from './fila'
import { registrarManual } from './itens'
import { aprovarTodosPendentes, resolver } from './revisao'

/**
 * O mapa de quem pode o quê — uma linha por operação sensível.
 *
 * ═══ O BURACO QUE ESTE ARQUIVO FECHA (achado N-11) ═══
 *
 * `exigirPapel` tinha teste próprio, e quatro ROTAS tinham teste negativo. As
 * operações de SERVIÇO não tinham nenhum: apagar a linha `exigirPapel(...)` de
 * `resolver`, `definirHabilitacoes`, `definirEscala`, `registrarManual` ou
 * `confirmar` deixava a suíte inteira verde — e um colaborador comum passaria
 * a confirmar distribuição, mudar a habilitação dos colegas e resolver
 * revisões.
 *
 * É o mesmo tipo de regressão que `pureza.test.ts` e as fronteiras guardam:
 * não aparece como erro, aparece como permissão a mais que ninguém nota.
 *
 * ═══ POR QUE A ENTRADA PODE SER VAZIA ═══
 *
 * A conferência de papel vem ANTES do `parse` da entrada em todas elas, e isso
 * é parte do que se está guardando: quem não pode a operação não deve nem
 * chegar à validação, que é onde as mensagens contam sobre o formato dos dados
 * internos. Se alguém inverter essa ordem, estes testes falham com erro de
 * validação em vez de `PermissaoNegadaError` — e o vermelho conta o que mudou.
 */

const banco = obterPrisma()

/**
 * Pedido deliberadamente vazio.
 *
 * Estas duas funções são tipadas, e o teste quer justamente provar que a
 * recusa por papel acontece ANTES de olhar o conteúdo. O `as` é o preço de
 * escrever, em TypeScript, uma chamada que nunca deveria chegar ao parse.
 */
const PEDIDO_VAZIO = {} as Parameters<typeof confirmar>[1]

const colaborador = atorDeTeste('pessoa-sintetica', 'colaborador')
const operador = atorDeTeste('operador-sintetico', 'operador')

interface CasoDePermissao {
  readonly operacao: string
  readonly ator: typeof colaborador
  readonly executar: () => Promise<unknown>
}

/** Recusadas para COLABORADOR: a operação é de quem toca a distribuição. */
const NEGADAS_PARA_COLABORADOR: readonly CasoDePermissao[] = [
  {
    operacao: 'ver a fila de outra pessoa',
    ator: colaborador,
    executar: () => minhaFila(banco, 'outra-pessoa-qualquer', colaborador),
  },
  { operacao: 'ver prévia da distribuição', ator: colaborador, executar: () => previa(banco, PEDIDO_VAZIO, colaborador) },
  { operacao: 'confirmar distribuição', ator: colaborador, executar: () => confirmar(banco, PEDIDO_VAZIO, colaborador) },
  { operacao: 'resolver revisão', ator: colaborador, executar: () => resolver(banco, {}, colaborador) },
  {
    operacao: 'aprovar revisões em massa',
    ator: colaborador,
    executar: () => aprovarTodosPendentes(banco, colaborador),
  },
  { operacao: 'definir escala', ator: colaborador, executar: () => definirEscala(banco, {}, colaborador) },
  {
    operacao: 'registrar item manualmente',
    ator: colaborador,
    executar: () => registrarManual(banco, {}, colaborador),
  },
]

/** Recusadas até para OPERADOR: mexem em quem tem acesso e no que cada um pode. */
const SO_PARA_GESTOR: readonly CasoDePermissao[] = [
  { operacao: 'cadastrar colaborador', ator: operador, executar: () => criarColaborador(banco, {}, operador) },
  {
    operacao: 'definir habilitação',
    ator: operador,
    executar: () => definirHabilitacoes(banco, {}, operador),
  },
  {
    operacao: 'definir senha de outro colaborador',
    ator: operador,
    executar: () => definirSenhaProvisoria(banco, {}, operador),
  },
  { operacao: 'destravar conta', ator: operador, executar: () => destravarConta(banco, {}, operador) },
  {
    operacao: 'ativar ou desativar colaborador',
    ator: operador,
    executar: () => definirAtivacao(banco, {}, operador),
  },
]

describe('papel insuficiente é recusado ANTES de qualquer efeito', () => {
  it.each(NEGADAS_PARA_COLABORADOR)('colaborador não pode: $operacao', async ({ executar }) => {
    await expect(executar()).rejects.toBeInstanceOf(PermissaoNegadaError)
  })

  it.each(SO_PARA_GESTOR)('operador não pode: $operacao', async ({ executar }) => {
    await expect(executar()).rejects.toBeInstanceOf(PermissaoNegadaError)
  })

  it('a recusa nomeia a operação — é o que a trilha e o suporte leem depois', async () => {
    await expect(confirmar(banco, PEDIDO_VAZIO, colaborador)).rejects.toThrow(/confirmar distribuição/)
  })

  it('ver a PRÓPRIA fila continua liberado para colaborador', async () => {
    // O contraponto: sem ele, uma trava escrita larga demais passaria aqui e
    // ninguém enxergaria a própria fila — que é a tela de trabalho da equipe.
    await expect(minhaFila(banco, colaborador.colaboradorId, colaborador)).resolves.toEqual([])
  })
})
