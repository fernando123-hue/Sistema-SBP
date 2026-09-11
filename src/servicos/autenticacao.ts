import { bloqueioRestanteEmSegundos, segundosDeBloqueio } from '../core/autenticacao'
import { ErroDeNegocio } from '../core/erros'
import {
  AtivacaoSchema,
  CredenciaisSchema,
  DefinicaoDeSenhaSchema,
  DestravamentoSchema,
  PapelSchema,
  TrocaDeSenhaSchema,
  type Papel,
} from '../core/esquemas'
import { exigirPapel, type Ator } from '../servidor/ator'
import {
  conferirSenha,
  esperarAtePisoDeEntrada,
  gastarTempoDeConferencia,
  gerarHash,
  precisaRehash,
  sortearSenhaProvisoria,
} from '../servidor/credenciais'
import { novaCorrelacao } from '../servidor/observabilidade'
import type { Banco } from '../servidor/prisma'
import { auditar } from './auditoria'

/**
 * Autenticação.
 *
 * Modelo atual (DECISOES.md § AT-08): o gestor cadastra a pessoa com uma senha
 * provisória e a entrega; o sistema obriga a troca antes de liberar qualquer
 * tela. Trocar isso depois — convite por link, provedor externo — mexe neste
 * arquivo e em `src/servidor/credenciais.ts`, não no resto do sistema.
 *
 * Duas regras que valem para todas as funções aqui:
 *
 * 1. **Uma mensagem só para qualquer falha de entrada.** "E-mail não existe",
 *    "senha errada" e "conta desativada" respondem exatamente igual. Distinguir
 *    seria entregar de graça a lista de quem tem acesso ao sistema.
 * 2. **Tempo de resposta constante.** Mesmo quando o e-mail não existe, a
 *    conferência é executada contra um hash de referência — senão o relógio
 *    responde o que a mensagem se recusa a dizer. E, porque igualar o hash não
 *    basta, toda recusa espera até um PISO comum antes de responder: os ramos
 *    fazem trabalho diferente depois do hash, e a diferença foi medida em
 *    23,5 ms. Ver `PISO_DE_RESPOSTA_DE_ENTRADA_MS`.
 */

const FALHA_DE_ENTRADA = 'E-mail ou senha incorretos.'

export interface EntradaAutorizada {
  colaboradorId: string
  nome: string
  papel: Papel
  precisaTrocarSenha: boolean
  /** Vai no cookie: é o que faz uma troca de senha revogar as sessões antigas. */
  senhaDefinidaEm: Date | null
}

export async function autenticar(banco: Banco, entrada: unknown): Promise<EntradaAutorizada> {
  const dados = CredenciaisSchema.parse(entrada)
  const correlacaoId = novaCorrelacao()
  // Marcado ANTES da consulta: o piso mede a requisição inteira, senão o tempo
  // da própria busca por e-mail (que acha ou não acha) voltaria a diferenciar.
  const inicio = Date.now()

  const colaborador = await banco.colaborador.findUnique({
    where: { email: dados.email },
    select: {
      id: true,
      nome: true,
      papel: true,
      ativo: true,
      senhaHash: true,
      precisaTrocarSenha: true,
      tentativasFalhas: true,
      bloqueadoAte: true,
      senhaDefinidaEm: true,
    },
  })

  if (!colaborador?.ativo || !colaborador.senhaHash) {
    await gastarTempoDeConferencia()
    await esperarAtePisoDeEntrada(inicio)
    throw new ErroDeNegocio(FALHA_DE_ENTRADA, 'FALHA_DE_ENTRADA')
  }

  const restante = bloqueioRestanteEmSegundos(colaborador.bloqueadoAte, new Date())
  if (restante > 0) {
    // Aqui a mensagem PRECISA ser específica, e isso é decisão consciente: a
    // pessoa legítima tem de saber que a conta destrava sozinha, senão liga
    // para o suporte. Só chega neste ponto quem já provou conhecer um e-mail
    // válido e errou a senha cinco vezes — o sigilo já custou caro ao atacante.
    throw new ErroDeNegocio(
      `Muitas tentativas. Esta conta volta a aceitar entrada em ${restante}s.`,
      'CONTA_BLOQUEADA',
    )
  }

  const confere = await conferirSenha(dados.senha, colaborador.senhaHash)

  if (!confere) {
    // INCREMENTO ATÔMICO, não "li 3, gravo 4".
    //
    // Ler o contador no início da função e gravar o valor absoluto aqui era
    // corrida clássica: dez tentativas disparadas ao mesmo tempo liam todas
    // `0` e gravavam todas `1`. O bloqueio por conta nunca disparava, e ele é
    // justamente a defesa contra o atacante distribuído — o que vem de muitos
    // IPs e não é contido pelo limite por origem. Bastava paralelizar.
    const { tentativasFalhas: tentativas } = await banco.colaborador.update({
      where: { id: colaborador.id },
      data: { tentativasFalhas: { increment: 1 } },
      select: { tentativasFalhas: true },
    })

    const bloqueio = segundosDeBloqueio(tentativas)
    if (bloqueio > 0) {
      await banco.colaborador.update({
        where: { id: colaborador.id },
        data: { bloqueadoAte: new Date(Date.now() + bloqueio * 1000) },
      })
    }

    await auditar(banco, {
      entidade: 'Colaborador',
      entidadeId: colaborador.id,
      acao: 'entrada_recusada',
      depois: { tentativasFalhas: tentativas, bloqueadoPorSegundos: bloqueio },
      usuario: colaborador.id,
      correlacaoId,
    })

    // Depois de TODAS as escritas deste ramo — são elas que o outro ramo não
    // faz, e é a soma delas que o piso precisa absorver.
    await esperarAtePisoDeEntrada(inicio)
    throw new ErroDeNegocio(FALHA_DE_ENTRADA, 'FALHA_DE_ENTRADA')
  }

  // Senha correta: o contador zera. Sem isso, cinco erros espalhados ao longo
  // de meses acabariam trancando alguém que nunca errou cinco vezes seguidas.
  await banco.colaborador.update({
    where: { id: colaborador.id },
    data: {
      tentativasFalhas: 0,
      bloqueadoAte: null,
      // Custo de hash endurecido no código só alcança as senhas existentes se
      // alguém as reescrever. O momento em que a senha em texto está
      // legitimamente na memória é este.
      ...(precisaRehash(colaborador.senhaHash)
        ? { senhaHash: await gerarHash(dados.senha) }
        : {}),
    },
  })

  await auditar(banco, {
    entidade: 'Colaborador',
    entidadeId: colaborador.id,
    acao: 'entrada_autorizada',
    usuario: colaborador.id,
    correlacaoId,
  })

  return {
    colaboradorId: colaborador.id,
    nome: colaborador.nome,
    papel: PapelSchema.parse(colaborador.papel),
    precisaTrocarSenha: colaborador.precisaTrocarSenha,
    // O rehash acima muda o hash, nunca `senhaDefinidaEm`: a senha continua
    // sendo a mesma, e mexer nesta data expulsaria a sessão recém-criada.
    senhaDefinidaEm: colaborador.senhaDefinidaEm,
  }
}

/**
 * Troca da própria senha.
 *
 * Exige a senha atual mesmo já havendo sessão: um cookie roubado não deve
 * bastar para trancar o dono legítimo para fora da própria conta.
 */
export async function trocarSenha(
  banco: Banco,
  entrada: unknown,
  ator: Ator,
): Promise<{ senhaDefinidaEm: Date }> {
  const dados = TrocaDeSenhaSchema.parse(entrada)
  const correlacaoId = novaCorrelacao()

  const colaborador = await banco.colaborador.findUnique({
    where: { id: ator.colaboradorId },
    select: { id: true, senhaHash: true, tentativasFalhas: true, bloqueadoAte: true },
  })
  if (!colaborador?.senhaHash) throw new ErroDeNegocio('Esta conta não tem senha definida.')

  // Esta rota confere a senha atual, então é um oráculo de senha igual à
  // entrada — e precisa da MESMA trava. Sem isto, quem roubasse um cookie
  // poderia adivinhar a senha aqui indefinidamente, contornando o bloqueio que
  // protege `/api/sessao`.
  const restante = bloqueioRestanteEmSegundos(colaborador.bloqueadoAte, new Date())
  if (restante > 0) {
    throw new ErroDeNegocio(
      `Muitas tentativas. Tente de novo em ${restante}s.`,
      'CONTA_BLOQUEADA',
    )
  }

  if (!(await conferirSenha(dados.senhaAtual, colaborador.senhaHash))) {
    const { tentativasFalhas: tentativas } = await banco.colaborador.update({
      where: { id: colaborador.id },
      data: { tentativasFalhas: { increment: 1 } },
      select: { tentativasFalhas: true },
    })

    const bloqueio = segundosDeBloqueio(tentativas)
    if (bloqueio > 0) {
      await banco.colaborador.update({
        where: { id: colaborador.id },
        data: { bloqueadoAte: new Date(Date.now() + bloqueio * 1000) },
      })
    }

    throw new ErroDeNegocio('A senha atual está incorreta.', 'FALHA_DE_ENTRADA')
  }

  if (await conferirSenha(dados.senhaNova, colaborador.senhaHash)) {
    throw new ErroDeNegocio('A senha nova precisa ser diferente da atual.')
  }

  const senhaDefinidaEm = new Date()

  await banco.colaborador.update({
    where: { id: colaborador.id },
    data: {
      senhaHash: await gerarHash(dados.senhaNova),
      senhaDefinidaEm,
      precisaTrocarSenha: false,
      tentativasFalhas: 0,
      bloqueadoAte: null,
    },
  })

  // A auditoria registra QUE a senha mudou e quando. Nunca o valor, nem o hash.
  await auditar(banco, {
    entidade: 'Colaborador',
    entidadeId: colaborador.id,
    acao: 'senha_trocada',
    usuario: ator.colaboradorId,
    correlacaoId,
  })

  // Quem chamou precisa disto para reemitir o cookie: a troca acabou de
  // invalidar TODAS as sessões desta pessoa, inclusive a que está trocando.
  return { senhaDefinidaEm }
}

/**
 * Gestor define a senha provisória de alguém.
 *
 * `precisaTrocarSenha` fica ligado: a janela em que outra pessoa conhece a
 * senha termina no primeiro acesso do dono. E como `senhaDefinidaEm` muda,
 * qualquer sessão aberta daquela pessoa morre na requisição seguinte — o que
 * torna esta a ferramenta para expulsar um acesso indevido.
 */
export async function definirSenhaProvisoria(
  banco: Banco,
  entrada: unknown,
  ator: Ator,
  /**
   * Senha fixa, SÓ para teste e seed.
   *
   * É quarto parâmetro, e não campo do corpo, de propósito: a rota HTTP
   * passa só três argumentos, então não existe requisição capaz de alcançar
   * isto. Quando era campo do esquema, um gestor podia definir senha
   * conhecida para outra pessoa pela rede — e a regra de "sempre sorteada"
   * valia só enquanto a tela cooperasse.
   */
  senhaFixa?: string,
): Promise<{ colaboradorId: string; senhaProvisoria: string }> {
  exigirPapel(ator, 'definir senha de outro colaborador', 'gestor')
  const dados = DefinicaoDeSenhaSchema.parse(entrada)
  const correlacaoId = novaCorrelacao()

  const colaborador = await banco.colaborador.findUnique({
    where: { id: dados.colaboradorId },
    select: { id: true, ativo: true, senhaHash: true },
  })
  if (!colaborador) throw new ErroDeNegocio(`Colaborador "${dados.colaboradorId}" não existe.`)
  if (!colaborador.ativo) throw new ErroDeNegocio('Colaborador desativado não recebe senha.')

  const senhaProvisoria = senhaFixa ?? sortearSenhaProvisoria()

  await banco.colaborador.update({
    where: { id: colaborador.id },
    data: {
      senhaHash: await gerarHash(senhaProvisoria),
      senhaDefinidaEm: new Date(),
      precisaTrocarSenha: true,
      tentativasFalhas: 0,
      bloqueadoAte: null,
    },
  })

  await auditar(banco, {
    entidade: 'Colaborador',
    entidadeId: colaborador.id,
    acao: colaborador.senhaHash ? 'senha_redefinida_pelo_gestor' : 'senha_inicial_definida',
    depois: { precisaTrocarSenha: true },
    usuario: ator.colaboradorId,
    correlacaoId,
  })

  // Devolvida em texto UMA vez, para o gestor entregar. Não é gravada em lugar
  // nenhum além do hash, e o log redige campos com nome de senha.
  return { colaboradorId: colaborador.id, senhaProvisoria }
}

/**
 * Gestor tira alguém do bloqueio por tentativas.
 *
 * O bloqueio expira sozinho — esta função existe para o caso em que a pessoa
 * está com o cliente na linha e não pode esperar quinze minutos. Zerar o
 * contador junto é essencial: sem isso, o próximo erro de digitação recolocaria
 * a pessoa no bloqueio na hora, e destravar seria teatro.
 */
export async function destravarConta(
  banco: Banco,
  entrada: unknown,
  ator: Ator,
): Promise<{ colaboradorId: string }> {
  exigirPapel(ator, 'destravar conta', 'gestor')
  const dados = DestravamentoSchema.parse(entrada)
  const correlacaoId = novaCorrelacao()

  const colaborador = await banco.colaborador.findUnique({
    where: { id: dados.colaboradorId },
    select: { id: true },
  })
  if (!colaborador) throw new ErroDeNegocio(`Colaborador "${dados.colaboradorId}" não existe.`)

  await banco.colaborador.update({
    where: { id: colaborador.id },
    data: { tentativasFalhas: 0, bloqueadoAte: null },
  })

  await auditar(banco, {
    entidade: 'Colaborador',
    entidadeId: colaborador.id,
    acao: 'conta_destravada',
    usuario: ator.colaboradorId,
    correlacaoId,
  })

  return { colaboradorId: colaborador.id }
}

/**
 * Gestor liga ou desliga o acesso de alguém.
 *
 * Desligar tem efeito imediato: `perfilAtual` recusa quem está inativo, então a
 * sessão aberta morre na requisição seguinte. Ligar de volta NÃO exige nova
 * senha — desligar alguém de férias não pode custar um ritual de redefinição na
 * volta.
 *
 * Não apaga ninguém: `dataSaida` e o histórico de carga continuam de pé, porque
 * a auditoria precisa responder quem recebeu o quê no ano passado.
 */
export async function definirAtivacao(
  banco: Banco,
  entrada: unknown,
  ator: Ator,
): Promise<{ colaboradorId: string; ativo: boolean; itensDevolvidos: number }> {
  exigirPapel(ator, 'ativar ou desativar colaborador', 'gestor')
  const dados = AtivacaoSchema.parse(entrada)
  const correlacaoId = novaCorrelacao()

  const colaborador = await banco.colaborador.findUnique({
    where: { id: dados.colaboradorId },
    select: { id: true, ativo: true, papel: true },
  })
  if (!colaborador) throw new ErroDeNegocio(`Colaborador "${dados.colaboradorId}" não existe.`)

  // ═══ DESLIGAR O ACESSO NÃO PODE ABANDONAR O TRABALHO ═══
  //
  // Os itens da fila de quem foi desligado ficavam `distribuido`, com atribuição
  // ativa, PARA SEMPRE: a pessoa não abre sessão (`perfilAtual` recusa inativo),
  // então não conclui; `planejarCategoria` só recolhe `aprovado` e `devolvido`,
  // então a rodada não os pega; e nenhuma tela abre a fila de outra pessoa.
  //
  // O efeito medido era pior que "some": eles continuavam contando em
  // `pendente` e envelhecendo no indicador de atraso, mas sumiam de "Por
  // pessoa" no painel (que filtra `ativo: true`) — trabalho real, invisível
  // para quem decide, sem erro nenhum. A doença que este sistema existe para
  // curar, reconstruída dentro dele.
  //
  // Devolver ao pool na MESMA transação é a saída que não depende de uma tela
  // que não existe: o item volta a não ter dono, a próxima rodada o recolhe com
  // o crédito atualizado, e a trilha registra por quê.
  const devolvidos = await banco.$transaction(async (tx) => {
    // NUNCA deixar a associação sem gestor ativo — conferido DENTRO da
    // transação que desativa.
    //
    // Desativar o último é uma porta que tranca por fora: só gestor cadastra
    // senha, destrava conta e reativa acesso — inclusive o acesso que acabou de
    // ser desligado. A recuperação seria mexer no banco na mão.
    //
    // A contagem morava FORA da transação: dois gestores desativando um ao outro
    // ao mesmo tempo contavam, cada um, o outro ainda ativo, e passavam os dois.
    // Dentro dela, a leitura e a escrita ficam sob a mesma transação, e o SQLite
    // admite um escritor por vez. Em PostgreSQL com READ COMMITTED isto sozinho
    // não basta — seria preciso bloquear as linhas de gestor —, e fica
    // registrado para a migração. Revisão do PR #35.
    if (colaborador.ativo && !dados.ativo && colaborador.papel === 'gestor') {
      const outrosGestores = await tx.colaborador.count({
        where: { papel: 'gestor', ativo: true, id: { not: colaborador.id } },
      })
      if (outrosGestores === 0) {
        throw new ErroDeNegocio(
          'Este é o último gestor ativo. Promova ou ative outro gestor antes de desativar este — ' +
            'sem nenhum, ninguém consegue cadastrar senha, destravar conta ou reativar acesso.',
        )
      }
    }

    await tx.colaborador.update({
      where: { id: colaborador.id },
      data: { ativo: dados.ativo },
    })

    await auditar(tx, {
      entidade: 'Colaborador',
      entidadeId: colaborador.id,
      acao: dados.ativo ? 'acesso_reativado' : 'acesso_desativado',
      antes: { ativo: colaborador.ativo },
      depois: { ativo: dados.ativo },
      usuario: ator.colaboradorId,
      correlacaoId,
    })

    if (dados.ativo) return 0

    const abertos = await tx.atribuicao.findMany({
      where: {
        colaboradorId: colaborador.id,
        ativa: true,
        item: { status: { in: ['distribuido', 'em_andamento'] } },
      },
      select: { id: true, itemId: true },
    })

    for (const atribuicao of abertos) {
      await tx.atribuicao.update({
        where: { id: atribuicao.id },
        data: {
          ativa: null,
          encerradoEm: new Date(),
          motivo: 'devolucao',
          justificativa: 'Acesso da pessoa desativado; item devolvido ao grupo.',
        },
      })
      await tx.item.update({ where: { id: atribuicao.itemId }, data: { status: 'devolvido' } })

      await auditar(tx, {
        entidade: 'Item',
        entidadeId: atribuicao.itemId,
        acao: 'devolvido',
        antes: { colaboradorId: colaborador.id },
        depois: { status: 'devolvido', motivo: 'acesso_desativado' },
        usuario: ator.colaboradorId,
        correlacaoId,
      })
    }

    return abertos.length
  })

  return { colaboradorId: colaborador.id, ativo: dados.ativo, itensDevolvidos: devolvidos }
}
