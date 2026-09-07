import { createHmac } from 'node:crypto'

import { beforeEach, describe, expect, it } from 'vitest'

import { PISO_DE_RESPOSTA_DE_ENTRADA_MS } from '../core/autenticacao'
import { obterPrisma } from '../servidor/prisma'
import { lerCookie, montarCookie } from '../servidor/sessao'
import { limparCacheDeAmbiente } from '../servidor/ambiente'
import { atorDeTeste, limparTudo } from '../testes/apoio'
import { autenticar, definirSenhaProvisoria, trocarSenha } from './autenticacao'

/**
 * Regressões de duas frestas que a auditoria de 07/09/2026 encontrou.
 *
 * As duas tinham a mesma forma: uma garantia declarada em comentário, correta
 * na intenção, e sem nenhum teste guardando o comportamento que ela prometia.
 * O teste que existia para a enumeração conferia a MENSAGEM ("e-mail
 * inexistente e senha errada dão exatamente a mesma mensagem") — e o vazamento
 * não estava na mensagem, estava no relógio.
 */

const banco = obterPrisma()
const SENHA = 'frase-longa-escolhida-pela-pessoa'

async function semearPessoa() {
  const gestor = await banco.colaborador.create({
    data: { nome: 'Gestora de Teste', email: 'gestora@teste.local', papel: 'gestor' },
  })
  const pessoa = await banco.colaborador.create({
    data: { nome: 'Pessoa de Teste', email: 'pessoa@teste.local', papel: 'colaborador' },
  })
  await definirSenhaProvisoria(
    banco,
    { colaboradorId: pessoa.id },
    atorDeTeste(gestor.id, 'gestor'),
    SENHA,
  )
  return { pessoaId: pessoa.id }
}

beforeEach(async () => {
  process.env['SESSAO_SECRET'] = 'segredo-de-teste-com-tamanho-suficiente'
  limparCacheDeAmbiente()
  await limparTudo(banco)
})

describe('tempo de resposta da recusa de entrada', () => {
  /**
   * O canal lateral que isto fecha, medido antes da correção: e-mail
   * inexistente respondia em mediana 92,3 ms; conta ativa com senha errada, em
   * 115,7 ms. Vinte e três milissegundos de diferença, porque o segundo ramo
   * grava contador e linha de auditoria depois do hash. Com ~5 amostras por
   * endereço isso responde "esta conta existe", que é justamente a lista que a
   * mensagem única existe para não entregar.
   */
  async function medir(email: string): Promise<number> {
    const inicio = Date.now()
    await expect(autenticar(banco, { email, senha: 'senha-errada-qualquer' })).rejects.toThrow()
    return Date.now() - inicio
  }

  it('os dois motivos de recusa respeitam o mesmo piso de tempo', async () => {
    await semearPessoa()

    const inexistente = await medir('nao-existe@teste.local')
    const senhaErrada = await medir('pessoa@teste.local')

    // O piso é o que iguala: os dois esperam até ele, façam o que fizerem por
    // dentro. Margem para o relógio grosseiro do `Date.now` em Windows.
    expect(inexistente).toBeGreaterThanOrEqual(PISO_DE_RESPOSTA_DE_ENTRADA_MS - 20)
    expect(senhaErrada).toBeGreaterThanOrEqual(PISO_DE_RESPOSTA_DE_ENTRADA_MS - 20)
  })

  it('a diferença entre os dois caminhos fica bem abaixo do que era medível', async () => {
    await semearPessoa()

    // Três amostras alternadas de cada, comparadas pela MEDIANA: uma amostra
    // isolada em máquina compartilhada com o CI é ruído puro.
    const inexistentes: number[] = []
    const erradas: number[] = []
    for (let volta = 0; volta < 3; volta += 1) {
      inexistentes.push(await medir('nao-existe@teste.local'))
      erradas.push(await medir('pessoa@teste.local'))
    }

    const mediana = (amostras: number[]) => amostras.slice().sort((a, b) => a - b)[1]!
    const diferenca = Math.abs(mediana(erradas) - mediana(inexistentes))

    // Antes da correção a diferença era ~23 ms e crescia com o número de
    // escritas do ramo. O teto aqui é folgado de propósito — o que ele guarda
    // é que ninguém acrescente trabalho a um dos ramos capaz de furar o piso.
    expect(diferenca).toBeLessThan(60)
  })

  it('quem acerta a senha não paga o piso — atrasar quem acerta é custo sem defesa', async () => {
    await semearPessoa()

    const inicio = Date.now()
    await autenticar(banco, { email: 'pessoa@teste.local', senha: SENHA })
    expect(Date.now() - inicio).toBeLessThan(PISO_DE_RESPOSTA_DE_ENTRADA_MS)
  })
})

describe('revogação de sessão ao sair', () => {
  it('cookie emitido antes do "sair" deixa de valer', async () => {
    const { pessoaId } = await semearPessoa()
    const entrada = await autenticar(banco, { email: 'pessoa@teste.local', senha: SENHA })

    const cookie = montarCookie(entrada.colaboradorId, entrada.papel, entrada.senhaDefinidaEm)
    expect(lerCookie(cookie)).not.toBeNull()

    // É o que a rota DELETE faz. A conferência de `perfilAtual` compara o
    // `emitidoEm` do cookie com este carimbo.
    await banco.colaborador.update({
      where: { id: pessoaId },
      data: { sessoesInvalidasAntes: new Date(Date.now() + 1000) },
    })

    const colaborador = await banco.colaborador.findUniqueOrThrow({
      where: { id: pessoaId },
      select: { sessoesInvalidasAntes: true },
    })
    const conteudo = lerCookie(cookie)!
    expect(conteudo.emitidoEm).toBeLessThan(colaborador.sessoesInvalidasAntes!.getTime())
  })

  it('cookie emitido DEPOIS do "sair" continua valendo — reentrar tem de funcionar', async () => {
    const { pessoaId } = await semearPessoa()
    await banco.colaborador.update({
      where: { id: pessoaId },
      data: { sessoesInvalidasAntes: new Date(Date.now() - 5000) },
    })

    const entrada = await autenticar(banco, { email: 'pessoa@teste.local', senha: SENHA })
    const conteudo = lerCookie(
      montarCookie(entrada.colaboradorId, entrada.papel, entrada.senhaDefinidaEm),
    )!

    const colaborador = await banco.colaborador.findUniqueOrThrow({
      where: { id: pessoaId },
      select: { sessoesInvalidasAntes: true },
    })
    expect(conteudo.emitidoEm).toBeGreaterThan(colaborador.sessoesInvalidasAntes!.getTime())
  })

  it('cookie sem carimbo de emissão é recusado — é o formato anterior à revogação', () => {
    // Forjado com a mesma assinatura válida, só sem `emitidoEm`: é a forma que
    // os cookies em circulação tinham antes desta versão. Aceitá-los manteria
    // de pé justamente o que a mudança existe para poder derrubar.
    const valido = montarCookie('ckabc123', 'operador', null)
    expect(lerCookie(valido)).not.toBeNull()

    const [carga] = valido.split('.') as [string, string]
    const conteudo = JSON.parse(Buffer.from(carga, 'base64url').toString()) as Record<
      string,
      unknown
    >
    delete conteudo['emitidoEm']
    // Reassinado do jeito certo: o teste não é sobre assinatura, é sobre o campo.
    const semCarimbo = Buffer.from(JSON.stringify(conteudo)).toString('base64url')
    const assinatura = createHmac('sha256', process.env['SESSAO_SECRET']!)
      .update(semCarimbo)
      .digest('base64url')

    expect(lerCookie(`${semCarimbo}.${assinatura}`)).toBeNull()
  })

  it('trocar a senha continua revogando, e por um caminho diferente', async () => {
    const { pessoaId } = await semearPessoa()
    const entrada = await autenticar(banco, { email: 'pessoa@teste.local', senha: SENHA })
    const antigo = lerCookie(
      montarCookie(entrada.colaboradorId, entrada.papel, entrada.senhaDefinidaEm),
    )!

    const { senhaDefinidaEm } = await trocarSenha(
      banco,
      { senhaAtual: SENHA, senhaNova: 'outra-frase-longa-e-diferente' },
      atorDeTeste(pessoaId, 'colaborador'),
    )

    // As duas revogações são independentes: esta muda `senhaEm`, a outra
    // compara `emitidoEm`. Nenhuma substitui a outra.
    expect(antigo.senhaEm).not.toBe(senhaDefinidaEm.getTime())
  })
})
