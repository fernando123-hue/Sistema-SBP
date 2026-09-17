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

/**
 * Um `Banco` cuja gravação da TRILHA falha, e só ela (achado N-08).
 *
 * A falha precisa nascer dentro da transação, no `tx` que o serviço usa: um
 * espião no cliente de fora nunca é chamado, e o teste passaria verde
 * acreditando ter derrubado algo.
 */
function bancoQueDerrubaATrilha(real: typeof banco): typeof banco {
  return new Proxy(real, {
    get(alvo, chave) {
      if (chave !== '$transaction') return Reflect.get(alvo, chave)
      return (executar: (tx: unknown) => Promise<unknown>, opcoes?: unknown) =>
        alvo.$transaction(
          (tx) =>
            executar(
              new Proxy(tx, {
                get(txAlvo, txChave) {
                  if (txChave !== 'logAuditoria') return Reflect.get(txAlvo, txChave)
                  return {
                    create: () => Promise.reject(new Error('banco caiu ao gravar a trilha')),
                  }
                },
              }),
            ) as Promise<never>,
          opcoes as never,
        )
    },
  })
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
    expect(await conferirSenha(SENHA_NOVA, hash)).toBe('confere')
    expect(await conferirSenha(`${SENHA_NOVA}x`, hash)).toBe('nao_confere')
  })

  it('hash corrompido é DITO ilegível, e não confundido com senha errada', async () => {
    // Continua sem lançar — um registro quebrado no banco não pode virar 500
    // que conta ao cliente que aquela conta existe. Mas também não pode se
    // disfarçar de senha errada: quem chama precisa saber a diferença para não
    // gastar a tentativa da pessoa nem trancar a conta dela (achado N-36).
    for (const invalido of ['', 'lixo', 'scrypt$1$1$1$a', 'outro$16384$8$1$YQ$Yg', 'scrypt$0$8$1$YQ$Yg']) {
      await expect(conferirSenha(SENHA_NOVA, invalido)).resolves.toBe('hash_ilegivel')
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
      { colaboradorId: base.pessoaId },
      base.gestor,
      SENHA_PROVISORIA,
    )

    const entrada = await autenticar(banco, {
      email: 'pessoa@teste.local',
      senha: SENHA_PROVISORIA,
    })

    expect(entrada.colaboradorId).toBe(base.pessoaId)
    expect(entrada.precisaTrocarSenha).toBe(true)
  })

  it('hash ilegível no banco falha alto e NÃO gasta tentativa da pessoa', async () => {
    // ═══ O QUE ESTE TESTE IMPEDE (achado N-36) ═══
    //
    // Hash corrompido (migração malfeita, coluna truncada, edição manual) era
    // tratado como "senha errada": a pessoa tentava cinco vezes, a conta
    // travava, e nada em lugar nenhum dizia que o problema era do SISTEMA e
    // não dela. A pessoa liga para o suporte e o suporte destrava — e trava
    // de novo, para sempre, porque a causa continua lá. Erro silencioso que
    // custa o acesso de alguém, que é a doença que o invariante 7 existe para
    // curar.
    const base = await semearPessoa()
    await definirSenhaProvisoria(
      banco,
      { colaboradorId: base.pessoaId },
      base.gestor,
      SENHA_PROVISORIA,
    )
    await banco.colaborador.update({
      where: { id: base.pessoaId },
      data: { senhaHash: 'isto-nao-e-um-hash' },
    })

    await expect(
      autenticar(banco, { email: 'pessoa@teste.local', senha: SENHA_PROVISORIA }),
    ).rejects.toMatchObject({ codigo: 'CREDENCIAL_ILEGIVEL' })

    // A pessoa não errou nada: o contador dela não pode andar, senão o defeito
    // do sistema acaba trancando a conta.
    const depois = await banco.colaborador.findUniqueOrThrow({
      where: { id: base.pessoaId },
      select: { tentativasFalhas: true },
    })
    expect(depois.tentativasFalhas).toBe(0)

    // E alguém fica sabendo: o evento é o que faz isso chegar a um humano.
    const evento = await banco.eventoProcessamento.findFirst({
      where: { etapa: 'autenticacao', situacao: 'falha' },
    })
    expect(evento?.referencia).toBe(base.pessoaId)
  })

  it('senha trocada e trilha entram JUNTAS: falha no meio não deixa mudança sem registro', async () => {
    // ═══ O QUE ESTE TESTE IMPEDE (achado N-08) ═══
    //
    // O fato e a trilha eram duas escritas soltas: trocar a senha e gravar o
    // registro. Uma queda entre elas — processo reiniciado, conexão perdida —
    // deixava a senha de alguém trocada sem NENHUM registro de quem trocou e
    // quando. É a memória de que fala o invariante 14, com um buraco que
    // ninguém veria depois, porque o que falta numa trilha não faz barulho.
    const base = await semearPessoa()
    await definirSenhaProvisoria(
      banco,
      { colaboradorId: base.pessoaId },
      base.gestor,
      SENHA_PROVISORIA,
    )
    const antes = await banco.colaborador.findUniqueOrThrow({
      where: { id: base.pessoaId },
      select: { senhaHash: true },
    })

    // A trilha falha DEPOIS de a senha já ter sido gravada. Sem transação, a
    // senha nova fica; com transação, as duas voltam atrás. O dublê precisa
    // derrubar a escrita DE DENTRO da transação — espionar o cliente de fora
    // não alcança o `tx`, que é outro objeto.
    await expect(
      trocarSenha(
        bancoQueDerrubaATrilha(banco),
        { senhaAtual: SENHA_PROVISORIA, senhaNova: SENHA_NOVA },
        base.pessoaAtor,
      ),
    ).rejects.toThrow(/banco caiu/)

    const depois = await banco.colaborador.findUniqueOrThrow({
      where: { id: base.pessoaId },
      select: { senhaHash: true, senhaDefinidaEm: true },
    })
    expect(depois.senhaHash).toBe(antes.senhaHash)
    expect(await banco.logAuditoria.count({ where: { acao: 'senha_trocada' } })).toBe(0)
  })

  it('e-mail inexistente e senha errada dão exatamente a mesma mensagem', async () => {
    const base = await semearPessoa()
    await definirSenhaProvisoria(
      banco,
      { colaboradorId: base.pessoaId },
      base.gestor,
      SENHA_PROVISORIA,
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
      { colaboradorId: base.pessoaId },
      base.gestor,
      SENHA_PROVISORIA,
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
      { colaboradorId: base.pessoaId },
      base.gestor,
      SENHA_PROVISORIA,
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
      { colaboradorId: base.pessoaId },
      base.gestor,
      SENHA_PROVISORIA,
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

    // Desde o C-09 a tentativa é reservada ANTES do hash: a quinta já trava a
    // conta, e as outras cinco são recusadas sem nem conferir a senha.
    const depois = await banco.colaborador.findUniqueOrThrow({ where: { id: base.pessoaId } })
    expect(depois.tentativasFalhas).toBe(5)
    expect(depois.bloqueadoAte).not.toBeNull()
    expect(await banco.logAuditoria.count({ where: { acao: 'entrada_recusada' } })).toBe(5)
  })

  it('C-09: com a conta a uma falha do bloqueio, vinte tentativas simultâneas conferem UMA senha', async () => {
    const base = await semearPessoa()
    await definirSenhaProvisoria(banco, { colaboradorId: base.pessoaId }, base.gestor, SENHA_PROVISORIA)
    await banco.colaborador.update({ where: { id: base.pessoaId }, data: { tentativasFalhas: 4 } })

    // O bloqueio era conferido com o valor lido antes do scrypt (~90 ms) e só
    // gravado depois dele: toda tentativa que leu antes passava e testava uma
    // senha. Cinco tentativas por janela viravam centenas.
    const resultados = await Promise.allSettled(
      Array.from({ length: 20 }, () => autenticar(banco, { email: 'pessoa@teste.local', senha: 'errada' })),
    )

    expect(await banco.logAuditoria.count({ where: { acao: 'entrada_recusada' } })).toBe(1)
    const bloqueadas = resultados.filter(
      (resultado) => resultado.status === 'rejected' && /Muitas tentativas/.test(String(resultado.reason)),
    )
    expect(bloqueadas).toHaveLength(19)
  })

  it('C-09: acertar a senha na tentativa que chegaria ao limite entra e zera o contador', async () => {
    const base = await semearPessoa()
    await definirSenhaProvisoria(banco, { colaboradorId: base.pessoaId }, base.gestor, SENHA_PROVISORIA)
    await banco.colaborador.update({ where: { id: base.pessoaId }, data: { tentativasFalhas: 4 } })

    await autenticar(banco, { email: 'pessoa@teste.local', senha: SENHA_PROVISORIA })

    const depois = await banco.colaborador.findUniqueOrThrow({ where: { id: base.pessoaId } })
    expect(depois.tentativasFalhas).toBe(0)
    expect(depois.bloqueadoAte).toBeNull()
  })

  it('C-09: troca de senha também confere uma senha só, em paralelo', async () => {
    const base = await semearPessoa()
    await definirSenhaProvisoria(banco, { colaboradorId: base.pessoaId }, base.gestor, SENHA_PROVISORIA)
    await banco.colaborador.update({ where: { id: base.pessoaId }, data: { tentativasFalhas: 4 } })

    const resultados = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        trocarSenha(banco, { senhaAtual: 'errada-errada', senhaNova: SENHA_NOVA }, base.pessoaAtor),
      ),
    )

    const erradas = resultados.filter(
      (resultado) => resultado.status === 'rejected' && /senha atual está incorreta/.test(String(resultado.reason)),
    )
    expect(erradas).toHaveLength(1)
  })

  it('N-07: dois gestores desativando um ao outro ao mesmo tempo — um deles continua ativo', async () => {
    for (let rodada = 0; rodada < 10; rodada += 1) {
      await limparTudo(banco)
      const base = await semearPessoa()
      const segunda = await banco.colaborador.create({
        data: { nome: 'Segunda Gestora', email: 'segunda.gestora@teste.local', papel: 'gestor' },
      })
      const segundaAtor = atorDeTeste(segunda.id, 'gestor')

      // A contagem do último gestor era leitura comum: no InnoDB, as duas
      // transações contavam a outra ainda ativa e passavam as duas.
      await Promise.allSettled([
        definirAtivacao(banco, { colaboradorId: segunda.id, ativo: false }, base.gestor),
        definirAtivacao(banco, { colaboradorId: base.gestorId, ativo: false }, segundaAtor),
      ])

      const ativos = await banco.colaborador.count({ where: { papel: 'gestor', ativo: true } })
      expect(ativos).toBe(1)
    }
  })

  it('C-08: gestor não redefine a PRÓPRIA senha por aqui', async () => {
    const base = await semearPessoa()
    await definirSenhaProvisoria(banco, { colaboradorId: base.gestorId }, atorDeTeste(base.pessoaId, 'gestor'), SENHA_PROVISORIA)
    const antes = await banco.colaborador.findUniqueOrThrow({ where: { id: base.gestorId } })

    await expect(
      definirSenhaProvisoria(banco, { colaboradorId: base.gestorId }, base.gestor),
    ).rejects.toThrow(/própria senha/)
    // Guarda (revisão de segurança do PR #67): o id com espaço no fim também é
    // recusado. Hoje a colação é NO PAD e ele nem acha a linha; a conferência
    // pelo id gravado não depende disso.
    await expect(
      definirSenhaProvisoria(banco, { colaboradorId: `${base.gestorId} ` }, base.gestor),
    ).rejects.toThrow()

    const depois = await banco.colaborador.findUniqueOrThrow({ where: { id: base.gestorId } })
    expect(depois.senhaHash).toBe(antes.senhaHash)
    expect(depois.senhaDefinidaEm).toEqual(antes.senhaDefinidaEm)
  })

  it('entrada bem-sucedida zera o contador de falhas', async () => {
    const base = await semearPessoa()
    await definirSenhaProvisoria(
      banco,
      { colaboradorId: base.pessoaId },
      base.gestor,
      SENHA_PROVISORIA,
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
      { colaboradorId: base.pessoaId },
      base.gestor,
      SENHA_PROVISORIA,
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
      { colaboradorId: base.pessoaId },
      base.gestor,
      SENHA_PROVISORIA,
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
      { colaboradorId: base.pessoaId },
      base.gestor,
      SENHA_PROVISORIA,
    )
    await trocarSenha(banco, { senhaAtual: SENHA_PROVISORIA, senhaNova: SENHA_NOVA }, base.pessoaAtor)

    await definirSenhaProvisoria(
      banco,
      { colaboradorId: base.pessoaId },
      base.gestor,
      'outra-provisoria-do-gestor',
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
      { colaboradorId: base.pessoaId },
      base.gestor,
      SENHA_PROVISORIA,
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
  it('desligar o acesso devolve ao grupo os itens que estavam na fila da pessoa', async () => {
    // Antes disto, os itens ficavam `distribuido` com atribuição ativa para
    // sempre: a pessoa não abre sessão, então não conclui; o motor só recolhe
    // `aprovado` e `devolvido`, então a rodada não os pega; e nenhuma tela abre
    // a fila de outra pessoa. Continuavam contando em `pendente` e envelhecendo
    // no indicador de atraso, mas sumiam de "Por pessoa" no painel — trabalho
    // real, invisível para quem decide, sem erro nenhum.
    const base = await semearPessoa()
    const categoria = await banco.categoria.create({
      data: {
        codigo: 'DOC_CADASTRO',
        rotulo: 'Documento',
        frente: 'CADASTRO',
        grupo: 'ASSOCIADO',
        divisivel: true,
        limiarIndivisivel: 1,
      },
    })

    const item = await banco.item.create({
      data: { categoriaId: categoria.id, titulo: 'Na fila de quem saiu', status: 'distribuido', payload: '{}' },
    })
    await banco.atribuicao.create({
      data: {
        itemId: item.id,
        colaboradorId: base.pessoaId,
        motivo: 'algoritmo',
        atribuidoPor: base.gestorId,
        ativa: true,
      },
    })

    const resultado = await definirAtivacao(
      banco,
      { colaboradorId: base.pessoaId, ativo: false },
      base.gestor,
    )

    expect(resultado.itensDevolvidos).toBe(1)

    // O item volta ao estado que a próxima rodada recolhe, e a atribuição sai
    // de ativa — o índice único fica livre para quem receber depois.
    const depois = await banco.item.findUniqueOrThrow({ where: { id: item.id } })
    expect(depois.status).toBe('devolvido')
    expect(await banco.atribuicao.count({ where: { itemId: item.id, ativa: true } })).toBe(0)

    // E a trilha responde por quê, sem `UPDATE` em linha nenhuma de auditoria.
    const trilha = await banco.logAuditoria.findFirst({
      where: { entidadeId: item.id, acao: 'devolvido' },
    })
    expect(trilha?.depois).toContain('acesso_desativado')
  })

  it('reativar não mexe em item nenhum', async () => {
    const base = await semearPessoa({ ativo: false })

    const resultado = await definirAtivacao(
      banco,
      { colaboradorId: base.pessoaId, ativo: true },
      base.gestor,
    )

    expect(resultado.itensDevolvidos).toBe(0)
  })

  it('desativar impede a entrada mesmo com a senha correta', async () => {
    const base = await semearPessoa()
    await definirSenhaProvisoria(
      banco,
      { colaboradorId: base.pessoaId },
      base.gestor,
      SENHA_PROVISORIA,
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

describe('o gestor não escolhe a senha de ninguém', () => {
  it('campo de senha vindo pela rede é IGNORADO', async () => {
    const base = await semearPessoa()

    // Corpo com o campo que a rota HTTP costumava aceitar. O esquema não o
    // conhece mais, então ele é descartado e o servidor sorteia.
    const resultado = await definirSenhaProvisoria(
      banco,
      { colaboradorId: base.pessoaId, senhaProvisoria: 'SenhaEscolhida1' },
      base.gestor,
    )

    // Enquanto o campo era aceito, a regra de "sempre sorteada" valia só
    // enquanto a tela cooperasse: um gestor podia fixar senha conhecida para
    // outra pessoa pela rede e depois entrar como ela — e toda ação seguinte
    // ficaria gravada em `LogAuditoria.usuario` com o id da VÍTIMA.
    expect(resultado.senhaProvisoria).not.toBe('SenhaEscolhida1')

    const gravado = await banco.colaborador.findUniqueOrThrow({
      where: { id: base.pessoaId },
      select: { senhaHash: true },
    })
    expect(await conferirSenha('SenhaEscolhida1', gravado.senhaHash!)).toBe('nao_confere')
    expect(await conferirSenha(resultado.senhaProvisoria, gravado.senhaHash!)).toBe('confere')
  })
})
