import { bloqueioRestanteEmSegundos, segundosDeBloqueio } from '../core/autenticacao'
import { CredencialIlegivelError, ErroDeNegocio } from '../core/erros'
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
import { transacaoComNovaTentativa } from '../servidor/conflito'
import { novaCorrelacao, registrarEvento, registrarLog } from '../servidor/observabilidade'
import type { Banco } from '../servidor/prisma'
import { auditar } from './auditoria'

/**
 * Uma linha de trilha por credencial ilegível a cada hora, por pessoa.
 *
 * A trilha é append-only e não tem expurgo (invariantes 11 e 14): o que entra
 * nela fica. O humano precisa saber que a credencial de alguém está ilegível —
 * não precisa saber mil vezes, e quem martelasse a conta escreveria uma linha
 * permanente por tentativa. Uma hora é curta o bastante para o aviso reaparecer
 * enquanto o defeito durar, e longa o bastante para o flood não valer a pena.
 */
const JANELA_DO_AVISO_DE_CREDENCIAL_MS = 60 * 60 * 1000

/**
 * Leva a credencial ilegível a um humano (achado N-36).
 *
 * Duas saídas de propósito: o log é para quem está olhando agora; o evento
 * fica no banco, é consultável depois e sobrevive ao reinício — que é o que
 * transforma "aconteceu com uma pessoa numa terça" em algo investigável. Nada
 * do hash entra em nenhum dos dois: só o id de quem não conseguiu entrar.
 *
 * O log sai sempre; só o EVENTO é limitado por janela. São coisas diferentes:
 * o log é volátil e barato, a trilha é permanente.
 */
async function avisarCredencialIlegivel(
  banco: Banco,
  colaboradorId: string,
  correlacaoId: string = novaCorrelacao(),
): Promise<void> {
  registrarLog('erro', 'credencial ilegível no banco — a pessoa não consegue entrar', {
    colaboradorId,
    correlacaoId,
  })

  const jaAvisado = await banco.eventoProcessamento.findFirst({
    where: {
      etapa: 'autenticacao',
      situacao: 'falha',
      referencia: colaboradorId,
      criadoEm: { gte: new Date(Date.now() - JANELA_DO_AVISO_DE_CREDENCIAL_MS) },
    },
    select: { id: true },
  })
  if (jaAvisado) return

  await registrarEvento(banco, {
    correlacaoId,
    etapa: 'autenticacao',
    situacao: 'falha',
    referencia: colaboradorId,
    mensagem:
      'A senha gravada para este colaborador não pode ser lida. Redefina a senha provisória: ' +
      'enquanto isso não for feito, a pessoa não entra, e não é culpa da senha que ela digita.',
  })
}

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

/**
 * Reserva a tentativa ANTES de conferir a senha (achado C-09).
 *
 * O bloqueio era decidido com o valor lido antes do scrypt (~90 ms) e só
 * gravado depois dele: toda tentativa que leu antes da quinta falha passava e
 * testava uma senha — cinco por janela viravam centenas. Agora a linha da
 * conta é travada, o bloqueio é conferido com o valor de agora, e a tentativa
 * já entra na conta; a que chega ao limite já trava a conta antes do hash.
 * Quem acerta a senha zera tudo depois (`zerarTentativas`).
 *
 * Devolve `restante > 0` quando a conta está bloqueada: nesse caso nada foi
 * contado e a senha não deve ser conferida.
 */
async function reservarTentativa(
  banco: Banco,
  colaboradorId: string,
): Promise<{ restante: number; tentativas: number; bloqueio: number }> {
  return transacaoComNovaTentativa(banco, async (tx) => {
    const [linha] = await tx.$queryRaw<{ tentativasFalhas: number | bigint; bloqueadoAte: Date | null }[]>`
      SELECT tentativasFalhas, bloqueadoAte FROM \`Colaborador\` WHERE id = ${colaboradorId} FOR UPDATE`
    const agora = new Date()
    const restante = bloqueioRestanteEmSegundos(linha?.bloqueadoAte ?? null, agora)
    if (restante > 0) return { restante, tentativas: Number(linha?.tentativasFalhas ?? 0), bloqueio: 0 }

    const tentativas = Number(linha?.tentativasFalhas ?? 0) + 1
    const bloqueio = segundosDeBloqueio(tentativas)
    await tx.colaborador.update({
      where: { id: colaboradorId },
      data: {
        tentativasFalhas: tentativas,
        ...(bloqueio > 0 ? { bloqueadoAte: new Date(agora.getTime() + bloqueio * 1000) } : {}),
      },
    })
    return { restante: 0, tentativas, bloqueio }
  })
}

async function zerarTentativas(banco: Banco, colaboradorId: string): Promise<void> {
  await banco.colaborador.update({
    where: { id: colaboradorId },
    data: { tentativasFalhas: 0, bloqueadoAte: null },
  })
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

  const reserva = await reservarTentativa(banco, colaborador.id)
  const restante = reserva.restante
  if (restante > 0) {
    // A mensagem é específica para a pessoa legítima saber que a conta destrava
    // sozinha, em vez de ligar para o suporte. O PREÇO disso, e o comentário
    // anterior dizia o contrário (achado C-18): quem sonda NÃO precisa saber
    // antes que o e-mail existe — seis tentativas bastam, porque só conta real
    // chega ao bloqueio. A mensagem, então, confirma que a conta existe e está
    // ativa. Trocar pela genérica é decisão do dono: `DECISOES.md § H.4`, 33.
    //
    // O piso de tempo vale aqui também: sem ele, o relógio entregava o mesmo
    // segredo em poucos milissegundos, e continuaria entregando mesmo com a
    // mensagem igualada.
    await esperarAtePisoDeEntrada(inicio)
    throw new ErroDeNegocio(
      `Muitas tentativas. Esta conta volta a aceitar entrada em ${restante}s.`,
      'CONTA_BLOQUEADA',
    )
  }

  const conferencia = await conferirSenha(dados.senha, colaborador.senhaHash)

  // ═══ DEFEITO NOSSO NÃO GASTA TENTATIVA DA PESSOA (achado N-36) ═══
  //
  // Hash ilegível era indistinguível de senha errada: cinco tentativas e a
  // conta travava, sem que nada dissesse a ninguém que o problema estava no
  // dado gravado — o suporte destravava, e travava de novo. Agora a tentativa
  // reservada é devolvida, o evento leva o caso a um humano, e a pessoa lê uma
  // mensagem que manda procurar quem resolve.
  //
  // O piso de resposta continua sendo pago: sem ele, o caminho do hash
  // corrompido responderia mais rápido que o da senha errada e viraria um
  // oráculo a mais na tela de entrada.
  if (conferencia === 'hash_ilegivel') {
    // Paga o mesmo custo de CPU do caminho normal. `conferirSenha` decide
    // "ilegível" pelo FORMATO, antes do scrypt — sem isto, a conta com hash
    // corrompido ficaria sem as duas defesas contra força bruta ao mesmo
    // tempo: sem o custo de derivação (que é o que satura a vazão) e sem a
    // trava por tentativas (que a linha seguinte devolve de propósito, porque
    // o defeito é nosso). Achado da revisão de segurança do PR #77.
    await gastarTempoDeConferencia()
    await zerarTentativas(banco, colaborador.id)
    await avisarCredencialIlegivel(banco, colaborador.id, correlacaoId)
    await esperarAtePisoDeEntrada(inicio)
    throw new CredencialIlegivelError(colaborador.id)
  }

  if (conferencia !== 'confere') {
    // A tentativa já foi contada — e o bloqueio já gravado, se era a que chega
    // ao limite — em `reservarTentativa`, antes do hash. Contar aqui, depois,
    // era a janela do C-09. (O incremento atômico que morava aqui continua lá:
    // dez tentativas simultâneas não podem gravar todas o mesmo valor.)
    const { tentativas, bloqueio } = reserva

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
  // Zera ANTES do rehash, em escrita própria (revisão do PR do C-09): uma falha
  // ao gerar o hash novo não pode deixar contada a tentativa de quem acertou.
  await zerarTentativas(banco, colaborador.id)

  // Custo de hash endurecido no código só alcança as senhas existentes se
  // alguém as reescrever. O momento em que a senha em texto está
  // legitimamente na memória é este.
  if (precisaRehash(colaborador.senhaHash)) {
    await banco.colaborador.update({
      where: { id: colaborador.id },
      data: { senhaHash: await gerarHash(dados.senha) },
    })
  }

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
  // Mesma reserva da entrada (achado C-09): o bloqueio decidido com o valor de
  // agora, e a tentativa contada antes do hash.
  const { restante } = await reservarTentativa(banco, colaborador.id)
  if (restante > 0) {
    throw new ErroDeNegocio(
      `Muitas tentativas. Tente de novo em ${restante}s.`,
      'CONTA_BLOQUEADA',
    )
  }

  const conferenciaDaAtual = await conferirSenha(dados.senhaAtual, colaborador.senhaHash)
  // Hash ilegível aqui é o mesmo defeito do login (N-36) e, pelo mesmo motivo,
  // não pode virar só "sua senha está errada": a pessoa ficaria tentando
  // trocar uma senha que o sistema não consegue conferir.
  if (conferenciaDaAtual === 'hash_ilegivel') {
    // Mesmo custo de CPU do caminho normal, pelo mesmo motivo do login: esta
    // rota confere a senha atual, então também é superfície de adivinhação.
    await gastarTempoDeConferencia()
    // Devolve a tentativa que `reservarTentativa` já contou: sem isto, cinco
    // tentativas de trocar a senha contra um hash corrompido trancam a conta
    // pelo mesmo defeito que o N-36 existe para eliminar — só que por esta
    // rota em vez da de entrada.
    await zerarTentativas(banco, colaborador.id)
    await avisarCredencialIlegivel(banco, colaborador.id, correlacaoId)
    throw new CredencialIlegivelError(colaborador.id)
  }
  if (conferenciaDaAtual !== 'confere') {
    throw new ErroDeNegocio('A senha atual está incorreta.', 'FALHA_DE_ENTRADA')
  }

  // A senha atual confere: a tentativa reservada não foi falha. Zera já, e não
  // só no fim — a checagem abaixo pode recusar a senha nova.
  await zerarTentativas(banco, colaborador.id)

  if ((await conferirSenha(dados.senhaNova, colaborador.senhaHash)) === 'confere') {
    throw new ErroDeNegocio('A senha nova precisa ser diferente da atual.')
  }

  const senhaDefinidaEm = new Date()
  // O hash é derivado FORA da transação: scrypt custa centenas de milissegundos
  // de CPU de propósito, e segurar linha travada durante isso é convidar
  // impasse num horário de pico.
  const senhaHash = await gerarHash(dados.senhaNova)

  // ═══ O FATO E A TRILHA ENTRAM JUNTOS (achado N-08) ═══
  //
  // Eram duas escritas soltas. Uma queda entre elas deixava a senha de alguém
  // trocada sem nenhum registro de quem trocou e quando — e o que falta numa
  // trilha não faz barulho: ninguém descobre depois. A auditoria registra QUE
  // a senha mudou e quando; nunca o valor, nunca o hash.
  await transacaoComNovaTentativa(banco, async (tx) => {
    await tx.colaborador.update({
      where: { id: colaborador.id },
      data: {
        senhaHash,
        senhaDefinidaEm,
        precisaTrocarSenha: false,
        tentativasFalhas: 0,
        bloqueadoAte: null,
      },
    })

    await auditar(tx, {
      entidade: 'Colaborador',
      entidadeId: colaborador.id,
      acao: 'senha_trocada',
      usuario: ator.colaboradorId,
      correlacaoId,
    })
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

  // A PRÓPRIA senha só se troca por `trocarSenha`, que exige a senha atual
  // (achado C-08). Por aqui, uma sessão de gestor roubada ou esquecida aberta
  // trocava a senha do dono sem saber a atual e o trancava para fora.
  // Compara o id GRAVADO, não o enviado: a colação hoje é NO PAD, mas a
  // conferência não deve depender de como o banco compara texto.
  if (colaborador.id === ator.colaboradorId) {
    throw new ErroDeNegocio('A própria senha se troca na tela "Trocar senha", informando a senha atual.')
  }

  const senhaProvisoria = senhaFixa ?? sortearSenhaProvisoria()

  // Hash fora da transação, trilha dentro dela, pelos mesmos motivos de
  // `trocarSenha` (achado N-08).
  const senhaHash = await gerarHash(senhaProvisoria)

  await transacaoComNovaTentativa(banco, async (tx) => {
    await tx.colaborador.update({
      where: { id: colaborador.id },
      data: {
        senhaHash,
        senhaDefinidaEm: new Date(),
        precisaTrocarSenha: true,
        tentativasFalhas: 0,
        bloqueadoAte: null,
      },
    })

    await auditar(tx, {
      entidade: 'Colaborador',
      entidadeId: colaborador.id,
      acao: colaborador.senhaHash ? 'senha_redefinida_pelo_gestor' : 'senha_inicial_definida',
      depois: { precisaTrocarSenha: true },
      usuario: ator.colaboradorId,
      correlacaoId,
    })
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

  // Destravar sem registro é pior que os outros dois casos: é exatamente a
  // ação que alguém investigaria depois ("quem tirou o bloqueio desta conta,
  // e quando?"). As duas escritas entram juntas (achado N-08).
  await transacaoComNovaTentativa(banco, async (tx) => {
    await tx.colaborador.update({
      where: { id: colaborador.id },
      data: { tentativasFalhas: 0, bloqueadoAte: null },
    })

    await auditar(tx, {
      entidade: 'Colaborador',
      entidadeId: colaborador.id,
      acao: 'conta_destravada',
      usuario: ator.colaboradorId,
      correlacaoId,
    })
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
  const devolvidos = await transacaoComNovaTentativa(banco, async (tx) => {
    // OS ITENS ABERTOS DA PESSOA SÃO LIDOS E TRAVADOS PRIMEIRO, antes de
    // qualquer outra leitura ou escrita (revisão do PR que corrigiu o C-10).
    //
    // - Primeiro: `concluir` segura o item e precisa ler a linha da pessoa para
    //   gravar a execução; se esta transação atualizasse a pessoa antes, as duas
    //   se esperariam — impasse.
    // - Leitura TRAVADA (`FOR UPDATE`), não `findMany`: no REPEATABLE READ a
    //   leitura comum usa a fotografia do começo da transação, e o item que
    //   outra pessoa acabou de concluir ainda aparecia aberto — era devolvido ao
    //   grupo com a execução já gravada. A leitura travada espera e devolve o
    //   estado de agora.
    const abertos = dados.ativo
      ? []
      : await tx.$queryRaw<{ id: string; itemId: string }[]>`
          SELECT a.id, a.itemId FROM \`Atribuicao\` a
          JOIN \`Item\` i ON i.id = a.itemId
          WHERE a.colaboradorId = ${colaborador.id}
            AND a.ativa = 1
            AND i.status IN ('distribuido', 'em_andamento')
          ORDER BY i.id
          FOR UPDATE`

    // NUNCA deixar a associação sem gestor ativo — conferido DENTRO da
    // transação que desativa.
    //
    // Desativar o último é uma porta que tranca por fora: só gestor cadastra
    // senha, destrava conta e reativa acesso — inclusive o acesso que acabou de
    // ser desligado. A recuperação seria mexer no banco na mão.
    //
    // A contagem morava FORA da transação: dois gestores desativando um ao outro
    // ao mesmo tempo contavam, cada um, o outro ainda ativo, e passavam os dois.
    // Dentro dela, e com as linhas de gestor travadas (abaixo) — o que o SQLite
    // dava de graça, com um escritor por vez, o MySQL só dá com a trava.
    // Revisão do PR #35; trava desde o achado N-07.
    if (colaborador.ativo && !dados.ativo && colaborador.papel === 'gestor') {
      // No MySQL (REPEATABLE READ) a contagem comum não bastava (achado N-07):
      // as duas transações contavam a outra ainda ativa. Travar as linhas dos
      // gestores ativos, em ordem, faz a segunda esperar e contar de novo — e a
      // leitura travada devolve o estado de agora, não a fotografia antiga.
      const gestoresAtivos = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM \`Colaborador\`
        WHERE papel = 'gestor' AND ativo = 1
        ORDER BY id
        FOR UPDATE`
      const outrosGestores = gestoresAtivos.filter((gestor) => gestor.id !== colaborador.id).length
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

    for (const atribuicao of abertos) {
      await tx.atribuicao.update({
        where: { id: atribuicao.id },
        data: {
          ativa: null,
          encerradoEm: new Date(),
          motivo: 'devolucao',
          justificativas: {
            create: {
              motivo: 'devolucao',
              texto: 'Acesso da pessoa desativado; item devolvido ao grupo.',
            },
          },
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
