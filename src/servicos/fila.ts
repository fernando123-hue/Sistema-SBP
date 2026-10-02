import { camposParaCopiar, type CampoParaCopiar } from '../core/dados-do-item'
import { ErroDeNegocio } from '../core/erros'
import { deslocarDias, inicioDoDia, paraDataIso } from '../core/util/datas'
import { LIMITE_ITENS_POR_EMAIL, PayloadDoItemSchema, type Operacao } from '../core/esquemas'
import { Prisma } from '../generated/prisma/client'
import { ehOProprio, exigirPapel, type Ator } from '../servidor/ator'
import { transacaoComNovaTentativa } from '../servidor/conflito'
import { novaCorrelacao, registrarLog } from '../servidor/observabilidade'
import type { Banco, Transacao } from '../servidor/prisma'
import { registrarNegacao, type Tentativa } from '../servidor/rastro-de-negacao'
import { auditar, auditarLote } from './auditoria'

/**
 * Fila individual e execução.
 *
 * Substitui o `Realizado` digitado por evento com carimbo. Ninguém declara
 * quantidade: o colaborador conclui itens reais, um a um, e o número do painel
 * é consequência.
 *
 * O defeito RN-09 da planilha — quem realiza mais do que recebeu tem o
 * excedente descartado — simplesmente não existe aqui: é impossível concluir um
 * item que não é seu. Ajudar um colega passa por `transferir`, que deixa rastro.
 */

/**
 * Concluir, devolver ou transferir um item que já saiu da mão de todo mundo —
 * quase sempre outra aba ou outra pessoa agiu antes. Sem o id (N-28): ele não
 * ajuda quem lê a fazer nada.
 */
const ITEM_SEM_RESPONSAVEL =
  'Este item não está mais com ninguém — talvez já tenha sido concluído ou devolvido. Atualize a tela.'

export interface ItemDaFila {
  itemId: string
  titulo: string
  categoriaCodigo: string
  categoriaRotulo: string
  status: string
  /**
   * O e-mail de origem, para a tela juntar os itens dele (`A69`, 3A). `null`
   * é item registrado à mão, que nunca entra em grupo.
   */
  emailId: string | null
  remetente: string | null
  assunto: string | null
  recebidoEm: Date | null
  atribuidoEm: Date
  /**
   * Quando o item ENTROU no sistema — não quando caiu nesta fila.
   *
   * É a idade que interessa (`A7`): item transferido ou devolvido preserva a
   * data original, então mudar de mão não rejuvenesce trabalho parado.
   */
  criadoEm: Date
  /** O "obrigado" de um associado (`A75`): a tela escreve o texto fixo. */
  agradecimento: boolean
}

/**
 * Fila de UMA pessoa.
 *
 * Cada um vê a própria fila. Operador e gestor veem a de qualquer um — é o que
 * permite acompanhar a operação e remanejar carga.
 */
export async function minhaFila(
  banco: Banco,
  colaboradorId: string,
  ator: Ator,
): Promise<ItemDaFila[]> {
  if (!ehOProprio(ator, colaboradorId)) {
    exigirPapel(ator, 'ver a fila de outra pessoa', 'operador', 'gestor')
  }

  const atribuicoes = await banco.atribuicao.findMany({
    where: {
      colaboradorId,
      ativa: true,
      item: { status: { in: ['distribuido', 'em_andamento'] } },
    },
    // MAIS ANTIGO NO TOPO, pela idade do ITEM (`A7`).
    //
    // Era `atribuidoEm asc`, que é a idade da ATRIBUIÇÃO — e as duas divergem
    // exatamente no caso que importa: um item de três semanas devolvido ao pool
    // e redistribuído hoje aparecia no fim da fila, como se fosse novo. O
    // backlog envelhecia escondido atrás da ordem da tela.
    //
    // `criadoEm` é a MESMA definição de idade que `planejarCategoria` usa para
    // escolher quais itens entram na rodada. Duas definições de "mais antigo"
    // no mesmo sistema seria a divergência silenciosa de sempre.
    //
    // `id` desempata: sem ele, itens criados no mesmo instante (um e-mail que
    // vira N itens) sairiam em ordem instável entre duas leituras da tela.
    orderBy: [{ item: { criadoEm: 'asc' } }, { itemId: 'asc' }],
    // `select` explícito, nunca `include: { conteudo: true }`.
    //
    // O `include` trazia `EmailConteudo.corpo` — texto livre, sem teto — de cada
    // item da fila, para a tela usar só remetente e assunto. Numa fila de 40
    // itens de ~3 KB, ~120 KB lidos e jogados fora a cada carregamento, na tela
    // que a equipe abre no celular. Os dados sintéticos têm 148 caracteres de
    // corpo, o que escondia isso em teste. `listarCaixa` já fazia assim.
    select: {
      itemId: true,
      atribuidoEm: true,
      item: {
        select: {
          titulo: true,
          status: true,
          criadoEm: true,
          emailId: true,
          agradecimento: true,
          categoria: { select: { codigo: true, rotulo: true } },
          email: {
            select: {
              recebidoEm: true,
              conteudo: { select: { remetente: true, assunto: true } },
            },
          },
        },
      },
    },
  })

  return atribuicoes.map((atribuicao) => ({
    itemId: atribuicao.itemId,
    titulo: atribuicao.item.titulo,
    categoriaCodigo: atribuicao.item.categoria.codigo,
    categoriaRotulo: atribuicao.item.categoria.rotulo,
    status: atribuicao.item.status,
    emailId: atribuicao.item.emailId,
    remetente: atribuicao.item.email?.conteudo?.remetente ?? null,
    assunto: atribuicao.item.email?.conteudo?.assunto ?? null,
    recebidoEm: atribuicao.item.email?.recebidoEm ?? null,
    atribuidoEm: atribuicao.atribuidoEm,
    criadoEm: atribuicao.item.criadoEm,
    agradecimento: atribuicao.item.agradecimento,
  }))
}

/**
 * Quantos itens o `Ator` concluiu hoje (`A69`, 5A).
 *
 * Palavras do dono: "apenas o funcionário da conta específica verá quantos ele
 * fez no dia e sempre será resetado no fim do dia". E o `A71`: número de
 * trabalho por pessoa na mão de outro vira pressão.
 *
 * ═══ SÓ DE QUEM PERGUNTA ═══
 *
 * Não há parâmetro de pessoa, de propósito — diferente de `minhaFila`, que
 * deixa operador e gestor verem a fila de outro para remanejar carga. Este
 * número não serve para remanejar nada; serve para a própria pessoa ver o dia
 * andar. Um `colaboradorId` opcional aqui seria o primeiro passo para "ver o
 * de fulano", que é decisão separada do dono (invariante 10).
 *
 * ═══ NADA GUARDADO, NADA A ZERAR ═══
 *
 * Contado das `Execucao` do dia de São Paulo a cada leitura. "Recomeçar no fim
 * do dia" é o dia mudar: não existe contador para alguém esquecer de zerar,
 * nem coluna nova para alguém consultar por pessoa depois.
 *
 * `agora` existe para o teste fixar a virada do dia; a rota não o passa.
 */
export async function concluidosHoje(
  banco: Banco,
  ator: Ator,
  agora: Date = new Date(),
): Promise<{ data: string; concluidos: number }> {
  const data = paraDataIso(agora)
  const concluidos = await banco.execucao.count({
    where: {
      colaboradorId: ator.colaboradorId,
      // Devolver e cancelar também gravam `Execucao`, e não são trabalho feito.
      resultado: 'concluido',
      // Dia de São Paulo (`core/util/datas.ts`): em UTC, a partir das 21h o
      // número já seria o de amanhã.
      concluidoEm: { gte: inicioDoDia(data), lt: inicioDoDia(deslocarDias(data, 1)) },
    },
  })
  return { data, concluidos }
}

/**
 * Concluir é ato pessoal: quem conclui é sempre o `Ator` autenticado.
 *
 * Antes, `colaboradorId` vinha por parâmetro — o que deixava a autorização e a
 * auditoria à mercê de quem chamasse. Agora não há como declarar ter concluído
 * o trabalho de outra pessoa.
 */
/**
 * Trava a linha do item até o fim da transação (achado C-10).
 *
 * `concluir`, `devolver` e `transferir` liam atribuição e status sem trava e
 * decidiam em cima da leitura. No InnoDB (REPEATABLE READ), duas transações
 * simultâneas passavam na mesma conferência — execução de A com a atribuição
 * dizendo que o dono é B, item devolvido com trabalho já feito. Travando o
 * item PRIMEIRO, a segunda espera a primeira terminar, e as leituras que vêm
 * depois já enxergam o que ela gravou.
 */
async function travarItem(tx: Transacao, itemId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM \`Item\` WHERE id = ${itemId} FOR UPDATE`
}

/**
 * Permissão conferida ANTES de travar o item (revisão de segurança do PR #66).
 *
 * A trava vinha primeiro, e quem não tinha nada com o item conseguia segurá-lo
 * até ser recusado — o dono esperava atrás de pedidos sem permissão. Esta
 * leitura não trava nada; a conferência dentro da transação continua sendo a
 * que vale, com o estado já travado.
 *
 * `operacao` nula: só o dono pode (concluir). Com nome: o dono, ou quem
 * coordena a operação.
 */
async function conferirPermissaoAntesDeTravar(
  banco: Banco,
  itemId: string,
  ator: Ator,
  operacao: Operacao | null,
): Promise<void> {
  const atual = await banco.atribuicao.findFirst({
    where: { itemId, ativa: true },
    select: { colaboradorId: true },
  })
  // Sem responsável, a transação dá a mensagem certa.
  if (!atual || ehOProprio(ator, atual.colaboradorId)) return
  if (operacao === null) {
    await rastrearTentativaHorizontal(banco, itemId, ator, 'concluir item de outra pessoa')
    throw new ErroDeNegocio('Só o responsável ativo pode concluir o item. Use transferência.')
  }
  exigirPapel(ator, operacao, 'operador', 'gestor')
}

/**
 * Sondagem HORIZONTAL (pendência 8): a recusa era calada — quem varresse ids
 * para mexer no que não é dele não deixava linha nenhuma. A resposta continua
 * a mesma, e a frase explica bem o caso legítimo: a tela estava aberta quando
 * o item foi remanejado. Esse caso NÃO vira evento — quem já foi responsável
 * pelo item está com a tela desatualizada, não sondando, e uma linha de
 * "negação" com o nome dela, numa trilha que nunca é apagada, seria lida como
 * acusação (invariante 10; revisões do #130). Fica no log.
 */
async function rastrearTentativaHorizontal(
  banco: Banco,
  itemId: string,
  ator: Ator,
  tentativa: Tentativa,
): Promise<void> {
  const jaFoiResponsavel = await banco.atribuicao.findFirst({
    // Encerrada é `ativa: null` (libera o índice único `(itemId, ativa)`).
    where: { itemId, colaboradorId: ator.colaboradorId, ativa: null },
    select: { id: true },
  })
  if (jaFoiResponsavel) {
    // Com `tipo`: quem conta tentativas horizontais no log acha esta também.
    registrarLog('info', `${tentativa}: recusado, o item mudou de responsável`, {
      colaboradorId: ator.colaboradorId,
      tipo: 'horizontal',
      motivo: 'tela desatualizada',
    })
  } else {
    await registrarNegacao(banco, ator, tentativa)
  }
}

export async function concluir(
  banco: Banco,
  entrada: { itemId: string; observacao?: string },
  ator: Ator,
): Promise<void> {
  const correlacaoId = novaCorrelacao()
  await conferirPermissaoAntesDeTravar(banco, entrada.itemId, ator, null)

  // Impasse com outra transação é repetido (`servidor/conflito.ts`).
  await transacaoComNovaTentativa(banco, async (tx) => {
    await travarItem(tx, entrada.itemId)
    const atribuicao = await tx.atribuicao.findFirst({
      where: { itemId: entrada.itemId, ativa: true },
      include: { item: true },
    })

    if (!atribuicao) throw new ErroDeNegocio(ITEM_SEM_RESPONSAVEL)
    if (!ehOProprio(ator, atribuicao.colaboradorId)) {
      // Sem rastro, de propósito: chegar aqui é a corrida (o item mudou de mão
      // entre a pré-conferência e a trava), não sondagem — e gravar dentro de
      // uma transação que vai abortar deixaria a trilha afirmando o que não
      // ficou (invariante 14).
      throw new ErroDeNegocio('Só o responsável ativo pode concluir o item. Use transferência.')
    }
    if (atribuicao.item.status === 'concluido') return

    await tx.execucao.create({
      data: {
        itemId: entrada.itemId,
        colaboradorId: ator.colaboradorId,
        concluidoEm: new Date(),
        resultado: 'concluido',
        observacao: entrada.observacao ?? null,
      },
    })

    await tx.item.update({ where: { id: entrada.itemId }, data: { status: 'concluido' } })

    await auditar(tx, {
      entidade: 'Item',
      entidadeId: entrada.itemId,
      acao: 'concluido',
      antes: { status: atribuicao.item.status },
      depois: { status: 'concluido', por: ator.colaboradorId },
      usuario: ator.colaboradorId,
      correlacaoId,
    })
  })
}

/**
 * O grupo de "Concluir os N" que não fecha mais como a tela o viu. Diz que
 * nada foi feito: concluir os outros calado deixaria a pessoa achando que
 * fechou o e-mail, com um item dele ainda andando por aí.
 */
const GRUPO_MUDOU =
  'Algum item deste e-mail não está mais com você — talvez tenha sido transferido, devolvido ou ' +
  'concluído em outra tela. Nada foi concluído. Atualize a tela e tente de novo.'

/**
 * Conclui juntos os itens de UM e-mail (`A69`, 3A).
 *
 * Uma lista de 34 ligantes é um pedido só: o trabalho é feito de uma vez no
 * sistema da associação, e depois a pessoa clicava 68 vezes aqui. Agora são
 * dois toques — mas no banco continua sendo item a item: uma `Execucao` e uma
 * linha de trilha por item, com a mesma correlação. O Painel conta os N, como
 * contava antes.
 *
 * ═══ AS MESMAS REGRAS DE `concluir`, PARA CADA ITEM ═══
 *
 * Só o responsável ativo; item já concluído fica de fora sem nova execução; a
 * permissão é conferida antes de travar (revisão de segurança do #66), e de
 * novo com tudo travado.
 *
 * ═══ TUDO OU NADA ═══
 *
 * Uma transação só. Se um item do grupo mudou de mão desde que a tela abriu,
 * nenhum é concluído e a mensagem diz isso: o "Concluir os N" que a pessoa
 * confirmou não é mais o que está no banco.
 *
 * ═══ SÓ ITENS DO MESMO E-MAIL ═══
 *
 * Não é um "concluir tudo" disfarçado. Item à mão (sem e-mail) não entra, e
 * itens de e-mails diferentes não se juntam: o dono escolheu agrupar por
 * e-mail porque é o e-mail que é o pedido (`A69`).
 */
const PRAZO_DA_CONCLUSAO_EM_LOTE_MS = 20_000

export async function concluirDoMesmoEmail(
  banco: Banco,
  entrada: { itemIds: readonly string[] },
  ator: Ator,
): Promise<{ concluidos: number }> {
  // Ordenados: duas conclusões em lote que se cruzam travam na mesma ordem e
  // não se esperam em círculo.
  const ids = [...new Set(entrada.itemIds)].sort()
  if (ids.length === 0) throw new ErroDeNegocio('Nenhum item para concluir.')
  if (ids.length > LIMITE_ITENS_POR_EMAIL) {
    throw new ErroDeNegocio(`Um e-mail tem no máximo ${LIMITE_ITENS_POR_EMAIL} itens; a lista enviada tem ${ids.length}.`)
  }

  const correlacaoId = novaCorrelacao()

  // Antes de travar, como em `concluir`: quem não tem nada com os itens não os
  // segura enquanto espera a recusa.
  const atuais = await banco.atribuicao.findMany({
    where: { itemId: { in: ids }, ativa: true },
    select: { itemId: true, colaboradorId: true },
  })
  const alheio = atuais.find((atual) => !ehOProprio(ator, atual.colaboradorId))
  if (alheio) {
    await rastrearTentativaHorizontal(banco, alheio.itemId, ator, 'concluir item de outra pessoa')
    throw new ErroDeNegocio(GRUPO_MUDOU)
  }
  // Id inexistente ou item sem dono também recusa ANTES de travar (revisão de
  // segurança do #165): 500 ids inventados chegavam à transação, travavam o
  // que podiam e só então abortavam — no InnoDB, segurando a criação de itens.
  if (atuais.length !== ids.length) throw new ErroDeNegocio(GRUPO_MUDOU)

  const concluidos = await transacaoComNovaTentativa(
    banco,
    async (tx) => {
      // UMA consulta, na ordem dos ids (revisão técnica do #165): 500 idas ao
      // banco, uma por item, gastavam o prazo da transação esperando uma trava.
      await tx.$queryRaw`SELECT id FROM \`Item\` WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`

      const atribuicoes = await tx.atribuicao.findMany({
        where: { itemId: { in: ids }, ativa: true },
        select: { itemId: true, colaboradorId: true, item: { select: { status: true, emailId: true } } },
      })
      // Sem trilha de negação aqui dentro, como em `concluir`: chegar aqui é a
      // corrida, e gravar numa transação que vai abortar afirmaria o que não
      // ficou (invariante 14).
      if (atribuicoes.length !== ids.length) throw new ErroDeNegocio(GRUPO_MUDOU)
      if (atribuicoes.some((atribuicao) => !ehOProprio(ator, atribuicao.colaboradorId))) {
        throw new ErroDeNegocio(GRUPO_MUDOU)
      }
      const emails = new Set(atribuicoes.map((atribuicao) => atribuicao.item.emailId))
      if (emails.size !== 1 || emails.has(null)) {
        throw new ErroDeNegocio('Concluir junto só vale para itens do mesmo e-mail. Conclua os outros um por um.')
      }

      const pendentes = atribuicoes.filter((atribuicao) => atribuicao.item.status !== 'concluido')
      if (pendentes.length === 0) return 0

      const agora = new Date()
      await tx.execucao.createMany({
        data: pendentes.map((atribuicao) => ({
          itemId: atribuicao.itemId,
          colaboradorId: ator.colaboradorId,
          concluidoEm: agora,
          resultado: 'concluido',
          observacao: null,
        })),
      })
      await tx.item.updateMany({
        where: { id: { in: pendentes.map((atribuicao) => atribuicao.itemId) } },
        data: { status: 'concluido' },
      })
      await auditarLote(
        tx,
        pendentes.map((atribuicao) => ({
          entidade: 'Item',
          entidadeId: atribuicao.itemId,
          acao: 'concluido' as const,
          antes: { status: atribuicao.item.status },
          // `junto`: quantos foram concluídos no mesmo toque. Com a correlação,
          // a trilha responde "foi um por um ou o e-mail de uma vez?".
          depois: { status: 'concluido', por: ator.colaboradorId, junto: pendentes.length },
          usuario: ator.colaboradorId,
          correlacaoId,
        })),
      )
      return pendentes.length
    },
    // Folga para um e-mail de 500 itens esperar a trava de outra aba ou da
    // limpeza diária; os 5 s padrão do Prisma acabavam num 500 genérico.
    PRAZO_DA_CONCLUSAO_EM_LOTE_MS,
  )

  return { concluidos }
}

export type DadosDoItem =
  | { situacao: 'disponivel'; campos: CampoParaCopiar[] }
  | { situacao: 'expurgado'; expurgadoEm: string }

/**
 * A mesma frase para "não existe", "não é seu" e "já saiu da fila": a recusa
 * não diz se o item existe nem de quem ele é.
 */
const ITEM_FORA_DA_FILA = 'Este item não está mais na sua fila. Atualize a tela.'

/**
 * Os dados que a IA leu de UM item da própria fila (`A69`, 3B).
 *
 * Hoje quem executa volta ao Outlook para copiar CPF e matrícula que o
 * sistema já leu. Aqui eles saem sob demanda, como texto, um item por vez.
 *
 * ═══ SÓ QUEM ESTÁ COM O ITEM ═══
 *
 * Vale estar com o item, e não o papel: operador e gestor leem os dados do
 * item que está na fila DELES, e não leem os da fila dos outros — coordenar
 * não é executar, e eles já leem o e-mail inteiro na Revisão, onde ele é
 * conferido. Dado pessoal na tela de quem executa é a exposição nova que o
 * `A69` aceitou — e só ela. Item de outra pessoa é sondagem horizontal e
 * deixa rastro, como concluir item alheio.
 *
 * ═══ SÓ ITEM ABERTO ═══
 *
 * Concluído, devolvido ou cancelado saiu da fila: esta rota não é caminho
 * lateral para ler dado antigo.
 *
 * ═══ CADA LEITURA NA TRILHA, SEM OS VALORES ═══
 *
 * "Quem viu o CPF deste associado?" é a pergunta que o encarregado de dados
 * vai fazer. A linha diz quem e qual item, e quantos campos — nunca quais
 * valores (`A23(d)`). Vem ANTES de devolver: se a trilha não grava, nada sai.
 *
 * Expurgado diz que saiu, e quando (invariante 11). Payload ilegível falha
 * alto (invariante 7): "nenhum dado" esconderia um dado quebrado.
 */
export async function lerDadosDoItem(banco: Banco, itemId: string, ator: Ator): Promise<DadosDoItem> {
  const item = await banco.item.findUnique({
    where: { id: itemId },
    select: {
      status: true,
      payload: true,
      dadosExtraidosExpurgadosEm: true,
      atribuicoes: { where: { ativa: true }, select: { colaboradorId: true } },
    },
  })
  const responsavel = item?.atribuicoes[0]?.colaboradorId ?? null
  if (!item || responsavel === null) throw new ErroDeNegocio(ITEM_FORA_DA_FILA)
  if (!ehOProprio(ator, responsavel)) {
    await rastrearTentativaHorizontal(banco, itemId, ator, 'ver os dados de item de outra pessoa')
    throw new ErroDeNegocio(ITEM_FORA_DA_FILA)
  }
  // Os mesmos status que `minhaFila` lista.
  if (item.status !== 'distribuido' && item.status !== 'em_andamento') {
    throw new ErroDeNegocio(ITEM_FORA_DA_FILA)
  }

  if (item.dadosExtraidosExpurgadosEm) {
    return { situacao: 'expurgado', expurgadoEm: item.dadosExtraidosExpurgadosEm.toISOString() }
  }

  let bruto: unknown
  try {
    bruto = JSON.parse(item.payload)
  } catch {
    throw new Error(`Item "${itemId}" com payload que não é JSON. Investigue antes de mostrar qualquer coisa.`)
  }
  const lido = PayloadDoItemSchema.safeParse(bruto)
  if (!lido.success) {
    throw new Error(`Item "${itemId}" com payload fora do esquema. Investigue antes de mostrar qualquer coisa.`)
  }
  const campos = camposParaCopiar(lido.data.campos)

  // Escrita avulsa, fora de transação, e de propósito: ler não tem fato
  // transacional para acompanhar (invariante 14), como em `lerEmailDaRevisao`.
  await auditar(banco, {
    entidade: 'Item',
    entidadeId: itemId,
    acao: 'dados_do_item_lidos',
    depois: { quantosCampos: campos.length },
    usuario: ator.colaboradorId,
  })

  return { situacao: 'disponivel', campos }
}

/**
 * Transferência manual.
 *
 * NÃO altera a rodada original — o histórico é imutável. Encerra a atribuição
 * vigente e cria uma nova com motivo e justificativa. É o que separa as três
 * intenções que hoje moram numa coluna `Mov. Extra` só (RN-06).
 *
 * O crédito NÃO é estornado: quem recebeu na rodada continua tendo recebido.
 * Ver DECISOES.md § AT-07.
 */
export async function transferir(
  banco: Banco,
  entrada: {
    itemId: string
    paraColaboradorId: string
    justificativa: string
  },
  ator: Ator,
): Promise<void> {
  if (entrada.justificativa.trim().length < 5) {
    throw new ErroDeNegocio('Transferência exige justificativa.')
  }

  const correlacaoId = novaCorrelacao()
  await conferirPermissaoAntesDeTravar(banco, entrada.itemId, ator, 'transferir item de outra pessoa')

  // Impasse com outra transação é repetido (`servidor/conflito.ts`).
  await transacaoComNovaTentativa(banco, async (tx) => {
    await travarItem(tx, entrada.itemId)
    const atual = await tx.atribuicao.findFirst({
      where: { itemId: entrada.itemId, ativa: true },
      include: { item: { select: { status: true } } },
    })
    if (!atual) throw new ErroDeNegocio(ITEM_SEM_RESPONSAVEL)

    // Ou você é o dono atual (devolvendo/pedindo ajuda), ou você coordena a
    // operação. Um colaborador não puxa para si o item de um colega.
    if (!ehOProprio(ator, atual.colaboradorId)) {
      exigirPapel(ator, 'transferir item de outra pessoa', 'operador', 'gestor')
    }

    // ITEM CONCLUÍDO NÃO TROCA DE DONO.
    //
    // `concluir` grava a `Execucao` e deixa a atribuição ativa, então este
    // caminho aceitava de bom grado transferir trabalho já feito. O resultado
    // não aparecia em fila nenhuma (`minhaFila` só lista `distribuido` e
    // `em_andamento`) e estragava duas coisas de uma vez: quem fez perdia 1 em
    // "Atribuídos" no painel, e quem recebeu ganhava uma linha em que
    // atribuídos, concluídos e pendentes deixam de fechar. A `Atribuicao`
    // vigente passava a dizer que o dono é quem não executou, contradizendo a
    // `Execucao` — duas tabelas afirmando coisas diferentes sobre o mesmo fato.
    //
    // `devolver` já tinha esta trava; `transferir`, não.
    if (atual.item.status === 'concluido') {
      throw new ErroDeNegocio('Item já concluído não pode ser transferido.')
    }

    // Transferir para quem já é o dono era um `return` — sucesso sem efeito. A
    // tela lê sucesso como "saiu de mim" e tira o item da lista, e ele fica
    // parado na fila de quem acha que o passou adiante (N-05).
    if (atual.colaboradorId === entrada.paraColaboradorId) {
      throw new ErroDeNegocio(
        'O item já está com essa pessoa. Para passá-lo adiante, escolha outra.',
      )
    }

    // O DESTINO PRECISA PODER ABRIR A FILA DELE.
    //
    // Nada conferia isto. A chave estrangeira recusa um id inventado, mas
    // aceita de bom grado o id de alguém DESATIVADO — e `perfilAtual` recusa a
    // sessão de quem está inativo, então o item ia parar numa fila que a pessoa
    // não consegue mais abrir. Ninguém recebe erro, ninguém recebe aviso, e o
    // item some do mundo por um caminho que o sistema oferece na tela.
    //
    // É a doença que este sistema existe para curar, reconstruída dentro dele.
    //
    // Só a ATIVAÇÃO é conferida aqui. Transferir para quem está afastado é
    // outra conversa — pode ser deliberado ("ela volta amanhã e é o caso dela")
    // e a resposta é do dono do processo, não do código. Ver `DECISOES.md § C`.
    const destino = await tx.colaborador.findUnique({
      where: { id: entrada.paraColaboradorId },
      select: { id: true, nome: true, ativo: true },
    })
    if (!destino) {
      throw new ErroDeNegocio('A pessoa escolhida não está mais no cadastro. Atualize a tela e escolha de novo.')
    }
    if (!destino.ativo) {
      throw new ErroDeNegocio(
        `${destino.nome} está com o acesso desativado e não consegue abrir a própria fila. ` +
          'Escolha outra pessoa, ou peça ao gestor para reativar o acesso antes de transferir.',
      )
    }

    // `ativa: null` libera o índice único `(itemId, ativa)` para a nova
    // atribuição — a garantia de responsável único é do banco, não do código.
    await tx.atribuicao.update({
      where: { id: atual.id },
      data: { ativa: null, encerradoEm: new Date() },
    })

    await tx.atribuicao.create({
      data: {
        itemId: entrada.itemId,
        colaboradorId: entrada.paraColaboradorId,
        rodadaId: atual.rodadaId,
        motivo: 'transferencia',
        // O texto mora à parte: sai no prazo, e a atribuição não (`A40`,
        // resposta 25). A equipe escreve nome de associado aqui.
        justificativas: { create: { motivo: 'transferencia', texto: entrada.justificativa } },
        atribuidoPor: ator.colaboradorId,
        ativa: true,
      },
    })

    await auditar(tx, {
      entidade: 'Atribuicao',
      entidadeId: entrada.itemId,
      acao: 'transferencia',
      antes: { colaboradorId: atual.colaboradorId },
      // Que houve justificativa, nunca o texto: a trilha não tem prazo.
      depois: { colaboradorId: entrada.paraColaboradorId, temJustificativa: true },
      usuario: ator.colaboradorId,
      correlacaoId,
    })
  })
}

/**
 * Devolve um item ao pool (AT-07).
 *
 * Diferente de `transferir`: aqui o item não vai para uma pessoa escolhida a
 * dedo — ele volta a não ter dono e entra na PRÓXIMA rodada da categoria, onde
 * o motor decide de novo com o crédito atualizado. É o caminho para "não é
 * comigo" e "preciso de ajuda" sem que ninguém escolha quem vai pagar a conta.
 *
 * O crédito NÃO é estornado: quem recebeu na rodada continua tendo recebido.
 * Sem isso, devolver viraria ferramenta de manipular a própria carga.
 */
export async function devolver(
  banco: Banco,
  entrada: { itemId: string; justificativa: string },
  ator: Ator,
): Promise<void> {
  if (entrada.justificativa.trim().length < 5) {
    throw new ErroDeNegocio('Devolução exige justificativa.')
  }

  const correlacaoId = novaCorrelacao()
  await conferirPermissaoAntesDeTravar(banco, entrada.itemId, ator, 'devolver item de outra pessoa')

  // Impasse com outra transação é repetido (`servidor/conflito.ts`).
  await transacaoComNovaTentativa(banco, async (tx) => {
    await travarItem(tx, entrada.itemId)
    const atual = await tx.atribuicao.findFirst({
      where: { itemId: entrada.itemId, ativa: true },
      include: { item: { select: { status: true } } },
    })
    if (!atual) throw new ErroDeNegocio(ITEM_SEM_RESPONSAVEL)

    if (!ehOProprio(ator, atual.colaboradorId)) {
      exigirPapel(ator, 'devolver item de outra pessoa', 'operador', 'gestor')
    }
    if (atual.item.status === 'concluido') {
      throw new ErroDeNegocio('Item já concluído não pode ser devolvido.')
    }

    // Encerra a atribuição registrando o motivo e a justificativa. `ativa: null`
    // libera o índice único e deixa o item sem dono — que é o estado correto de
    // quem está esperando redistribuição.
    await tx.atribuicao.update({
      where: { id: atual.id },
      data: {
        ativa: null,
        encerradoEm: new Date(),
        motivo: 'devolucao',
        // `create`, não substituição: se esta atribuição nasceu de uma
        // transferência, a justificativa dela continua ao lado desta.
        justificativas: { create: { motivo: 'devolucao', texto: entrada.justificativa } },
      },
    })

    await tx.item.update({ where: { id: entrada.itemId }, data: { status: 'devolvido' } })

    await auditar(tx, {
      entidade: 'Item',
      entidadeId: entrada.itemId,
      acao: 'devolvido',
      antes: { status: atual.item.status, colaboradorId: atual.colaboradorId },
      depois: { status: 'devolvido', temJustificativa: true },
      usuario: ator.colaboradorId,
      correlacaoId,
    })
  })
}
