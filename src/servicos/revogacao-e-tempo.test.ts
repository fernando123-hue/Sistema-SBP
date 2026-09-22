import { createHmac } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PISO_DE_RESPOSTA_DE_ENTRADA_MS } from '../core/autenticacao'
import { obterPrisma } from '../servidor/prisma'
import { lerCookie, montarCookie, perfilAtual } from '../servidor/sessao'
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

/**
 * O duble de `next/headers` — o mesmo de `autorizacao-de-rotas.test.ts`.
 *
 * ═══ POR QUE ELE PRECISOU EXISTIR AQUI (achado N-15) ═══
 *
 * Os testes de revogação comparavam datas por conta própria: pegavam o
 * `emitidoEm` do cookie, pegavam o `sessoesInvalidasAntes` do banco e
 * afirmavam que um era menor que o outro. Isso prova aritmética, não
 * revogação — apagar a conferência inteira de `perfilAtual` deixava a suíte
 * verde, e a sessão de quem clicou em "sair" continuaria válida. Agora é
 * `perfilAtual` que responde, que é quem responde em produção.
 */
const cookieDaVez = { valor: '' }

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) => (cookieDaVez.valor ? { name: nome, value: cookieDaVez.valor } : undefined),
    set: () => {},
    delete: () => {},
  }),
}))

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

    // Cinco amostras alternadas de cada, comparadas pela MEDIANA. Eram três, e
    // três não bastaram: em 08/09/2026 este teste ficou vermelho com o servidor
    // de desenvolvimento e um navegador disputando a máquina, e verde de novo
    // com a máquina livre. Uma única pausa do sistema operacional desloca a
    // mediana de três; com cinco, ela precisa de duas pausas na mesma metade.
    //
    // O TETO NÃO FOI AFROUXADO de propósito: quem afrouxa o limite para calar um
    // vermelho intermitente apaga justamente o canal lateral que este teste
    // existe para medir. O que muda é o tamanho da amostra.
    const inexistentes: number[] = []
    const erradas: number[] = []
    for (let volta = 0; volta < 5; volta += 1) {
      inexistentes.push(await medir('nao-existe@teste.local'))
      erradas.push(await medir('pessoa@teste.local'))
    }

    const mediana = (amostras: number[]) => amostras.slice().sort((a, b) => a - b)[2]!
    const diferenca = Math.abs(mediana(erradas) - mediana(inexistentes))

    // Antes da correção a diferença era ~23 ms e crescia com o número de
    // escritas do ramo. O teto aqui é folgado de propósito — o que ele guarda
    // é que ninguém acrescente trabalho a um dos ramos capaz de furar o piso.
    expect(diferenca).toBeLessThan(60)
  })

  it('quem acerta a senha não paga o piso — atrasar quem acerta é custo sem defesa', async () => {
    await semearPessoa()

    // MEDIANA de três, e não uma amostra: uma pausa do sistema operacional no
    // meio da única medição fazia este teste ficar vermelho com a máquina
    // ocupada e verde com ela livre. O que ele afirma continua idêntico — o
    // caminho do acerto não espera o piso de propósito —, e o teto continua
    // sendo o piso, sem folga acrescentada.
    const amostras: number[] = []
    for (let volta = 0; volta < 3; volta += 1) {
      const inicio = Date.now()
      await autenticar(banco, { email: 'pessoa@teste.local', senha: SENHA })
      amostras.push(Date.now() - inicio)
    }

    const mediana = amostras.sort((a, b) => a - b)[1]!
    expect(mediana).toBeLessThan(PISO_DE_RESPOSTA_DE_ENTRADA_MS)
  })
})

describe('revogação de sessão ao sair', () => {
  it('cookie emitido antes do "sair" deixa de valer', async () => {
    const { pessoaId } = await semearPessoa()
    const entrada = await autenticar(banco, { email: 'pessoa@teste.local', senha: SENHA })

    const cookie = montarCookie(entrada.colaboradorId, entrada.papel, entrada.senhaDefinidaEm)
    expect(lerCookie(cookie)).not.toBeNull()

    // Com o cookie na mão, a sessão vale — e quem diz isso é `perfilAtual`.
    cookieDaVez.valor = cookie
    expect(await perfilAtual()).not.toBeNull()

    // É o que a rota DELETE faz.
    await banco.colaborador.update({
      where: { id: pessoaId },
      data: { sessoesInvalidasAntes: new Date(Date.now() + 1000) },
    })

    // O MESMO cookie agora é recusado. Comparar as datas aqui provaria
    // aritmética; isto prova revogação.
    expect(await perfilAtual()).toBeNull()
  })

  it('cookie emitido DEPOIS do "sair" continua valendo — reentrar tem de funcionar', async () => {
    const { pessoaId } = await semearPessoa()
    await banco.colaborador.update({
      where: { id: pessoaId },
      data: { sessoesInvalidasAntes: new Date(Date.now() - 5000) },
    })

    const entrada = await autenticar(banco, { email: 'pessoa@teste.local', senha: SENHA })
    cookieDaVez.valor = montarCookie(entrada.colaboradorId, entrada.papel, entrada.senhaDefinidaEm)

    // Sem isto, uma revogação escrita larga demais (por exemplo, recusar
    // qualquer cookie de quem já saiu uma vez) passaria: ninguém mais entrava.
    expect(await perfilAtual()).not.toBeNull()
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
