import { beforeEach, describe, expect, it } from 'vitest'

import { CATEGORIAS_CADASTRO } from '../core/config'
import { ErroDeNegocio } from '../core/erros'
import { conferirSenha } from '../servidor/credenciais'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo } from '../testes/apoio'
import { exigirBaseSintetica } from './base-sintetica'
import { criarPrimeiroGestor, garantirCategorias } from './preparacao-do-servidor'

/**
 * O servidor novo precisa de categorias e de UMA gestora real para alguém
 * entrar. Antes, o único caminho era o seed, que cria a equipe fictícia
 * (revisões do #175, `AT-60`).
 */

const banco = obterPrisma()

/**
 * A recusa precisa ser a NOSSA, não a do banco. A mensagem do Prisma traz o
 * trecho do código em volta da linha que falhou, e esse trecho inclui o texto
 * do `throw` vizinho: só o texto, um erro de constraint passava por recusa
 * (mutação vista sobrevivendo nesta PR).
 */
async function recusa(promessa: Promise<unknown>): Promise<string> {
  const erro = await promessa.then(
    () => null,
    (motivo: unknown) => motivo,
  )
  expect(erro).toBeInstanceOf(ErroDeNegocio)
  return (erro as ErroDeNegocio).message
}

const GESTORA = { nome: 'Gestora Sintética Real', email: 'gestora@outro.example' }

beforeEach(async () => {
  await limparTudo(banco)
})

describe('as categorias da configuração', () => {
  it('nascem todas, e repetir não duplica', async () => {
    expect(await garantirCategorias(banco)).toBe(CATEGORIAS_CADASTRO.length)
    await garantirCategorias(banco)
    expect(await banco.categoria.count()).toBe(CATEGORIAS_CADASTRO.length)
  })

  it('repetir não desfaz o peso que o operador ajustou', async () => {
    await garantirCategorias(banco)
    const codigo = CATEGORIAS_CADASTRO[0]!.codigo
    await banco.categoria.update({ where: { codigo }, data: { peso: 9 } })
    await garantirCategorias(banco)
    expect((await banco.categoria.findUniqueOrThrow({ where: { codigo } })).peso.toString()).toBe('9')
  })
})

describe('a primeira gestora', () => {
  it('nasce gestora, obrigada a trocar a senha, com a provisória conferindo e na trilha sem ela', async () => {
    const criada = await criarPrimeiroGestor(banco, GESTORA)

    const gravada = await banco.colaborador.findUniqueOrThrow({ where: { id: criada.colaboradorId } })
    expect(gravada.papel).toBe('gestor')
    expect(gravada.precisaTrocarSenha).toBe(true)
    expect(await conferirSenha(criada.senhaProvisoria, gravada.senhaHash!)).toBe('confere')

    const trilha = await banco.logAuditoria.findMany({ where: { entidadeId: criada.colaboradorId } })
    expect(trilha).toHaveLength(1)
    expect(trilha[0]!.acao).toBe('primeiro_gestor_criado')
    expect(trilha[0]!.usuario).toBe('sistema')
    expect(JSON.stringify(trilha)).not.toContain(criada.senhaProvisoria)
  })

  it('o e-mail é guardado como o cadastro da tela guarda: sem espaço e em minúsculas', async () => {
    const criada = await criarPrimeiroGestor(banco, { nome: GESTORA.nome, email: '  Gestora@Outro.Example ' })
    expect(criada.email).toBe('gestora@outro.example')
  })

  it('depois dela, a demo e o seed recusam a base', async () => {
    await criarPrimeiroGestor(banco, GESTORA)
    await expect(exigirBaseSintetica(banco, 'o seed')).rejects.toThrow(/domínio sintético/)
  })

  it.each([true, false])('base que já tem gestor (ativo: %s) recusa, e nada é criado', async (ativo) => {
    await banco.colaborador.create({ data: { nome: 'Outra', email: 'outra@outro.example', papel: 'gestor', ativo } })
    expect(await recusa(criarPrimeiroGestor(banco, GESTORA))).toMatch(/já tem gestor/)
    expect(await banco.colaborador.count()).toBe(1)
    expect(await banco.logAuditoria.count()).toBe(0)
  })

  it('o mesmo e-mail como colaborador comum recusa: promover é pela tela', async () => {
    await banco.colaborador.create({ data: { nome: 'Gestora', email: GESTORA.email, papel: 'colaborador' } })
    expect(await recusa(criarPrimeiroGestor(banco, GESTORA))).toMatch(/Já existe uma pessoa com este e-mail/)
    expect((await banco.colaborador.findUniqueOrThrow({ where: { email: GESTORA.email } })).papel).toBe('colaborador')
  })

  it('o domínio de teste recusa', async () => {
    expect(await recusa(criarPrimeiroGestor(banco, { nome: 'Teste', email: 'gestora@exemplo.test' }))).toMatch(/domínio de teste/)
    expect(await banco.colaborador.count()).toBe(0)
  })

  it.each([
    [{ nome: '', email: 'gestora@outro.example' }],
    [{ nome: 'Gestora', email: 'nao-e-email' }],
    [{ email: 'gestora@outro.example' }],
  ])('entrada inválida recusa antes de tocar o banco: %j', async (entrada) => {
    await expect(criarPrimeiroGestor(banco, entrada)).rejects.toThrow()
    expect(await banco.colaborador.count()).toBe(0)
  })
})
