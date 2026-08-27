import { beforeEach, describe, expect, it } from 'vitest'

import { TENTATIVAS_ANTES_DE_TRAVAR, segundosDeBloqueio } from '../core/autenticacao'
import { conferirSenha, gerarHash, precisaRehash } from '../servidor/credenciais'
import { obterPrisma } from '../servidor/prisma'
import { atorDeTeste, limparTudo } from '../testes/apoio'
import {
  autenticar,
  definirAtivacao,
  definirSenhaProvisoria,
  destravarConta,
  trocarSenha,
} from './autenticacao'

/**
 * Testes da autenticação.
 *
 * A superfície que decide quem entra não pode ter só cobertura de tipo: um
 * `!confere` invertido, um contador que não zera ou uma senha guardada em
 * texto puro passariam pelo typecheck sem reclamação nenhuma.
 */

const banco = obterPrisma()

const SENHA_PROVISORIA = 'provisoria-sintetica-2026'
const SENHA_NOVA = 'frase-longa-escolhida-pela-pessoa'

async function semearPessoa(opcoes: { papel?: string; ativo?: boolean } = {}) {
  const gestor = await banco.colaborador.create({
    data: { nome: 'Gestora de Teste', email: 'gestora@teste.local', papel: 'gestor' },
  })
  const pessoa = await banco.colaborador.create({
    data: {
      nome: 'Pessoa de Teste',
      email: 'pessoa@teste.local',
      papel: opcoes.papel ?? 'colaborador',
      ativo: opcoes.ativo ?? true,
    },
  })
  return {
    gestor: atorDeTeste(gestor.id, 'gestor'),
    gestorId: gestor.id,
    pessoaId: pessoa.id,
    pessoaAtor: atorDeTeste(pessoa.id, (opcoes.papel ?? 'colaborador') as 'colaborador'),
  }
}

beforeEach(async () => {
  await limparTudo(banco)
})

describe('hash de senha', () => {
  it('nunca guarda a senha em texto e nunca repete o mesmo hash', async () => {
    const primeiro = await gerarHash(SENHA_NOVA)
    const segundo = await gerarHash(SENHA_NOVA)

    // Sal por senha: dois cadastros com a mesma senha têm hashes diferentes,
    // então vazar o banco não revela quem escolheu a mesma senha de quem.
    expect(primeiro).not.toBe(segundo)
    expect(primeiro).not.toContain(SENHA_NOVA)
    expect(primeiro.startsWith('scrypt$')).toBe(true)
  })

  it('confere a senha certa e recusa a errada', async () => {
    const hash = await gerarHash(SENHA_NOVA)
    expect(await conferirSenha(SENHA_NOVA, hash)).toBe(true)
    expect(await conferirSenha(`${SENHA_NOVA}x`, hash)).toBe(false)
  })

  it('hash corrompido devolve falso em vez de lançar', async () => {
    // Um registro quebrado no banco significa "não entra", nunca um 500 que
    // conta ao cliente que aquela conta existe.
    for (const invalido of ['', 'lixo', 'scrypt$1$1$1$a', 'outro$16384$8$1$YQ$Yg', 'scrypt$0$8$1$YQ$Yg']) {
      await expect(conferirSenha(SENHA_NOVA, invalido)).resolves.toBe(false)
    }
  })

  it('marca para rehash o que veio com custo mais fraco', async () => {
    expect(precisaRehash(await gerarHash(SENHA_NOVA))).toBe(false)
    expect(precisaRehash('scrypt$4096$8$1$YQ$Yg')).toBe(true)
    expect(precisaRehash('formato-antigo-qualquer')).toBe(true)
  })
})

describe('bloqueio progressivo', () => {
  it('não trava antes do limite e cresce com teto depois dele', () => {
    expect(segundosDeBloqueio(TENTATIVAS_ANTES_DE_TRAVAR - 1)).toBe(0)
    expect(segundosDeBloqueio(TENTATIVAS_ANTES_DE_TRAVAR)).toBeGreaterThan(0)

    const primeiro = segundosDeBloqueio(TENTATIVAS_ANTES_DE_TRAVAR)
    const segundo = segundosDeBloqueio(TENTATIVAS_ANTES_DE_TRAVAR + 1)
    expect(segundo).toBeGreaterThan(primeiro)

    // Sem teto, o dobro sucessivo vira bloqueio de horas — negação de serviço
    // contra o próprio usuário.
    expect(segundosDeBloqueio(TENTATIVAS_ANTES_DE_TRAVAR + 50)).toBeLessThanOrEqual(15 * 60)
  })
})

describe('entrada com senha', () => {
  it('gestor define a provisória e a pessoa entra obrigada a trocar', async () => {
    const base = await semearPessoa()

    await definirSenhaProvisoria(
      banco,
      { colaboradorId: base.pessoaId, senhaProvisoria: SENHA_PROVISORIA },
      base.gestor,
    )

    const entrada = await autenticar(banco, {
      email: 'pessoa@teste.local',
      senha: SENHA_PROVISORIA,
    })

    expect(entrada.colaboradorId).toBe(base.pessoaId)
    expect(entrada.precisaTrocarSenha).toBe(true)
  })

  it('e-mail inexistente e senha errada dão exatamente a mesma mensagem', async () => {
    const base = await semearPessoa()
    await definirSenhaProvisoria(
      banco,
      { colaboradorId: base.pessoaId, senhaProvisoria: SENHA_PROVISORIA },
      base.gestor,
    )

    const inexistente = await autenticar(banco, {
      email: 'ninguem@teste.local',
      senha: SENHA_PROVISORIA,
    }).catch((erro: Error) => erro.message)

    const senhaErrada = await autenticar(banco, {
      email: 'pessoa@teste.local',
      senha: 'senha-completamente-errada',
    }).catch((erro: Error) => erro.message)

    // Mensagens distintas entregariam a lista de quem tem acesso ao sistema.
    expect(inexistente).toBe(senhaErrada)
  })

  it('conta sem senha definida não entra', async () => {
    await semearPessoa()
    await expect(
      autenticar(banco, { email: 'pessoa@teste.local', senha: SENHA_PROVISORIA }),
    ).rejects.toThrow()
  })

  it('conta desativada não entra mesmo com a senha certa', async () => {
    const base = await semearPessoa()
    await definirSenhaProvisoria(
      banco,
      { colaboradorId: base.pessoaId, senhaProvisoria: SENHA_PROVISORIA },
      base.gestor,
    )
    await banco.colaborador.update({ where: { id: base.pessoaId }, data: { ativo: false } })

    await expect(
      autenticar(banco, { email: 'pessoa@teste.local', senha: SENHA_PROVISORIA }),
    ).rejects.toThrow()
  })

  it('trava a conta depois de erros seguidos e destrava sozinha', async () => {
    const base = await semearPessoa()
    await definirSenhaProvisoria(
      banco,
      { colaboradorId: base.pessoaId, senhaProvisoria: SENHA_PROVISORIA },
      base.gestor,
    )

    for (let tentativa = 0; tentativa < TENTATIVAS_ANTES_DE_TRAVAR; tentativa += 1) {
      await autenticar(banco, { email: 'pessoa@teste.local', senha: 'errada' }).catch(() => null)
    }

    // Senha CERTA agora: tem de bater na trava, senão o bloqueio não existe.
    await expect(
      autenticar(banco, { email: 'pessoa@teste.local', senha: SENHA_PROVISORIA }),
    ).rejects.toThrow(/tentativas/i)

    // Sem intervenção humana: o bloqueio é temporal e passa por si.
    await banco.colaborador.update({
      where: { id: base.pessoaId },
      data: { bloqueadoAte: new Date(Date.now() - 1000) },
    })

    const entrada = await autenticar(banco, {
      email: 'pessoa@teste.local',
      senha: SENHA_PROVISORIA,
    })
    expect(entrada.colaboradorId).toBe(base.pessoaId)
  })

  it('tentativas simultâneas contam todas — o bloqueio não se contorna com paralelismo', async () => {
    const base = await semearPessoa()
    await definirSenhaProvisoria(
      banco,
      { colaboradorId: base.pessoaId, senhaProvisoria: SENHA_PROVISORIA },
      base.gestor,
    )

    // Regressão: o contador era lido no início da função e gravado como valor
    // absoluto. Dez tentativas ao mesmo tempo liam `0` e gravavam `1` — o
    // bloqueio por conta nunca disparava, e ele é a única defesa contra o
    // atacante distribuído, que o limite por origem não alcança.
    await Promise.all(
      Array.from({ length: 10 }, () =>
        autenticar(banco, { email: 'pessoa@teste.local', senha: 'errada' }).catch(() => null),
      ),
    )

    const depois = await banco.colaborador.findUniqueOrThrow({ where: { id: base.pessoaId } })
    expect(depois.tentativasFalhas).toBe(10)
    expect(depois.bloqueadoAte).not.toBeNull()
  })

  it('entrada bem-sucedida zera o contador de falhas', async () => {
    const base = await semearPessoa()
    await definirSenhaProvisoria(
      banco,
      { colaboradorId: base.pessoaId, senhaProvisoria: SENHA_PROVISORIA },
      base.gestor,
    )

    await autenticar(banco, { email: 'pessoa@teste.local', senha: 'errada' }).catch(() => null)
    await autenticar(banco, { email: 'pessoa@teste.local', senha: SENHA_PROVISORIA })

    // Sem zerar, cinco erros espalhados por meses trancariam quem nunca errou
    // cinco vezes seguidas.
    const depois = await banco.colaborador.findUniqueOrThrow({ where: { id: base.pessoaId } })
    expect(depois.tentativasFalhas).toBe(0)
    expect(depois.bloqueadoAte).toBeNull()
  })

  it('registra na auditoria a entrada autorizada e a recusada, sem a senha', async () => {
    const base = await semearPessoa()
    await definirSenhaProvisoria(
      banco,
      { colaboradorId: base.pessoaId, senhaProvisoria: SENHA_PROVISORIA },
      base.gestor,
    )

    await autenticar(banco, { email: 'pessoa@teste.local', senha: 'errada' }).catch(() => null)
    await autenticar(banco, { email: 'pessoa@teste.local', senha: SENHA_PROVISORIA })

    const registros = await banco.logAuditoria.findMany({ where: { entidade: 'Colaborador' } })
    const acoes = registros.map((registro) => registro.acao)

    expect(acoes).toContain('entrada_recusada')
    expect(acoes).toContain('entrada_autorizada')
    for (const registro of registros) {
      const linha = `${registro.antes ?? ''}${registro.depois ?? ''}`
      expect(linha).not.toContain(SENHA_PROVISORIA)
    }
  })
})

describe('troca de senha', () => {
  async function comProvisoria() {
    const base = await semearPessoa()
    await definirSenhaProvisoria(
      banco,
      { colaboradorId: base.pessoaId, senhaProvisoria: SENHA_PROVISORIA },
      base.gestor,
    )
    return base
  }

  it('troca com a senha atual correta e libera o sistema', async () => {
    const base = await comProvisoria()

    await trocarSenha(
      banco,
      { senhaAtual: SENHA_PROVISORIA, senhaNova: SENHA_NOVA },
      base.pessoaAtor,
    )

    const entrada = await autenticar(banco, { email: 'pessoa@teste.local', senha: SENHA_NOVA })
    expect(entrada.precisaTrocarSenha).toBe(false)

    // A provisória — que o gestor conhece — deixa de valer no mesmo instante.
    await expect(
      autenticar(banco, { email: 'pessoa@teste.local', senha: SENHA_PROVISORIA }),
    ).rejects.toThrow()
  })

  it('recusa a troca sem a senha atual correta', async () => {
    const base = await comProvisoria()
    // Só o cookie não basta: um cookie roubado não deve trancar o dono para fora.
    await expect(
      trocarSenha(banco, { senhaAtual: 'chute', senhaNova: SENHA_NOVA }, base.pessoaAtor),
    ).rejects.toThrow(/atual/i)
  })

  it('a troca também trava por tentativas — não é oráculo de senha sem limite', async () => {
    const base = await comProvisoria()

    // Esta rota confere a senha atual, então serve para adivinhá-la. Sem a
    // mesma trava da entrada, quem roubasse um cookie chutaria aqui à vontade
    // e contornaria o bloqueio que protege `/api/sessao`.
    for (let tentativa = 0; tentativa < TENTATIVAS_ANTES_DE_TRAVAR; tentativa += 1) {
      await trocarSenha(
        banco,
        { senhaAtual: 'chute', senhaNova: SENHA_NOVA },
        base.pessoaAtor,
      ).catch(() => null)
    }

    await expect(
      trocarSenha(
        banco,
        { senhaAtual: SENHA_PROVISORIA, senhaNova: SENHA_NOVA },
        base.pessoaAtor,
      ),
    ).rejects.toThrow(/tentativas/i)
  })

  it('trocar a senha avança `senhaDefinidaEm`, que é o que revoga as sessões antigas', async () => {
    const base = await comProvisoria()
    const antes = await banco.colaborador.findUniqueOrThrow({ where: { id: base.pessoaId } })

    const resultado = await trocarSenha(
      banco,
      { senhaAtual: SENHA_PROVISORIA, senhaNova: SENHA_NOVA },
      base.pessoaAtor,
    )

    // `perfilAtual` compara esta data com a gravada no cookie: qualquer sessão
    // emitida antes da troca morre na requisição seguinte.
    expect(resultado.senhaDefinidaEm.getTime()).toBeGreaterThan(antes.senhaDefinidaEm!.getTime())
  })

  it('recusa repetir a senha atual como nova', async () => {
    const base = await comProvisoria()
    await expect(
      trocarSenha(
        banco,
        { senhaAtual: SENHA_PROVISORIA, senhaNova: SENHA_PROVISORIA },
        base.pessoaAtor,
      ),
    ).rejects.toThrow(/diferente/i)
  })

  it('recusa senha curta demais', async () => {
    const base = await comProvisoria()
    await expect(
      trocarSenha(banco, { senhaAtual: SENHA_PROVISORIA, senhaNova: 'curta' }, base.pessoaAtor),
    ).rejects.toThrow()
  })
})

describe('definição de senha pelo gestor', () => {
  it('só gestor define senha de outra pessoa', async () => {
    const base = await semearPessoa()

    await expect(
      definirSenhaProvisoria(
        banco,
        { colaboradorId: base.pessoaId, senhaProvisoria: SENHA_PROVISORIA },
        atorDeTeste(base.pessoaId, 'operador'),
      ),
    ).rejects.toThrow(/operador/)
  })

  it('redefinir senha derruba o bloqueio e volta a exigir troca', async () => {
    const base = await semearPessoa()
    await definirSenhaProvisoria(
      banco,
      { colaboradorId: base.pessoaId, senhaProvisoria: SENHA_PROVISORIA },
      base.gestor,
    )
    await trocarSenha(banco, { senhaAtual: SENHA_PROVISORIA, senhaNova: SENHA_NOVA }, base.pessoaAtor)

    await definirSenhaProvisoria(
      banco,
      { colaboradorId: base.pessoaId, senhaProvisoria: 'outra-provisoria-do-gestor' },
      base.gestor,
    )

    const entrada = await autenticar(banco, {
      email: 'pessoa@teste.local',
      senha: 'outra-provisoria-do-gestor',
    })
    expect(entrada.precisaTrocarSenha).toBe(true)
  })

  it('sem senha informada, o servidor sorteia uma forte e a devolve uma vez', async () => {
    const base = await semearPessoa()

    const primeira = await definirSenhaProvisoria(banco, { colaboradorId: base.pessoaId }, base.gestor)
    const segunda = await definirSenhaProvisoria(banco, { colaboradorId: base.pessoaId }, base.gestor)

    // Pedir ao gestor que invente a senha de alguém termina em `Sbp2026!` para
    // a equipe inteira. Sorteada, é forte por construção e descartável por
    // natureza.
    expect(primeira.senhaProvisoria).toBeDefined()
    expect(primeira.senhaProvisoria!.length).toBeGreaterThanOrEqual(10)
    expect(primeira.senhaProvisoria).not.toBe(segunda.senhaProvisoria)

    const entrada = await autenticar(banco, {
      email: 'pessoa@teste.local',
      senha: segunda.senhaProvisoria!,
    })
    expect(entrada.precisaTrocarSenha).toBe(true)
  })
})

describe('destravar conta', () => {
  it('gestor libera antes de o tempo passar, e o contador zera', async () => {
    const base = await semearPessoa()
    await definirSenhaProvisoria(
      banco,
      { colaboradorId: base.pessoaId, senhaProvisoria: SENHA_PROVISORIA },
      base.gestor,
    )

    for (let tentativa = 0; tentativa < TENTATIVAS_ANTES_DE_TRAVAR; tentativa += 1) {
      await autenticar(banco, { email: 'pessoa@teste.local', senha: 'errada' }).catch(() => null)
    }
    await expect(
      autenticar(banco, { email: 'pessoa@teste.local', senha: SENHA_PROVISORIA }),
    ).rejects.toThrow(/tentativas/i)

    await destravarConta(banco, { colaboradorId: base.pessoaId }, base.gestor)

    // Sem zerar o contador junto, o próximo erro recolocaria a pessoa no
    // bloqueio imediatamente — destravar seria teatro.
    const entrada = await autenticar(banco, {
      email: 'pessoa@teste.local',
      senha: SENHA_PROVISORIA,
    })
    expect(entrada.colaboradorId).toBe(base.pessoaId)
  })

  it('só gestor destrava', async () => {
    const base = await semearPessoa()
    await expect(
      destravarConta(
        banco,
        { colaboradorId: base.pessoaId },
        atorDeTeste(base.pessoaId, 'operador'),
      ),
    ).rejects.toThrow(/operador/)
  })
})

describe('ativar e desativar acesso', () => {
  it('desativar impede a entrada mesmo com a senha correta', async () => {
    const base = await semearPessoa()
    await definirSenhaProvisoria(
      banco,
      { colaboradorId: base.pessoaId, senhaProvisoria: SENHA_PROVISORIA },
      base.gestor,
    )

    await definirAtivacao(banco, { colaboradorId: base.pessoaId, ativo: false }, base.gestor)

    await expect(
      autenticar(banco, { email: 'pessoa@teste.local', senha: SENHA_PROVISORIA }),
    ).rejects.toThrow()

    // Reativar devolve o acesso sem exigir nova senha: desligar alguém de
    // férias não pode custar um ritual de redefinição na volta.
    await definirAtivacao(banco, { colaboradorId: base.pessoaId, ativo: true }, base.gestor)
    const entrada = await autenticar(banco, {
      email: 'pessoa@teste.local',
      senha: SENHA_PROVISORIA,
    })
    expect(entrada.colaboradorId).toBe(base.pessoaId)
  })

  it('o sistema nunca fica sem nenhum gestor ativo', async () => {
    const base = await semearPessoa()

    // A gestora do cenário é a única. Desativá-la deixaria a associação sem
    // ninguém capaz de cadastrar senha, destravar conta ou reativar acesso —
    // e sem ninguém capaz de desfazer isso, porque desfazer exige ser gestor.
    await expect(
      definirAtivacao(banco, { colaboradorId: base.gestorId, ativo: false }, base.gestor),
    ).rejects.toThrow(/gestor/i)

    // Com outra gestora ativa, a saída passa a ser permitida.
    const segunda = await banco.colaborador.create({
      data: { nome: 'Segunda Gestora', email: 'gestora2@teste.local', papel: 'gestor' },
    })
    await definirAtivacao(banco, { colaboradorId: base.gestorId, ativo: false }, base.gestor)

    const desativada = await banco.colaborador.findUniqueOrThrow({ where: { id: base.gestorId } })
    expect(desativada.ativo).toBe(false)
    expect(segunda.ativo).toBe(true)
  })

  it('só gestor ativa ou desativa', async () => {
    const base = await semearPessoa()
    await expect(
      definirAtivacao(
        banco,
        { colaboradorId: base.pessoaId, ativo: false },
        atorDeTeste(base.pessoaId, 'operador'),
      ),
    ).rejects.toThrow(/operador/)
  })
})
