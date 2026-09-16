import { ErroDeNegocio } from '../core/erros'
import { ehOProprio, exigirPapel, type Ator } from '../servidor/ator'
import { novaCorrelacao } from '../servidor/observabilidade'
import type { Banco } from '../servidor/prisma'
import { auditar } from './auditoria'

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

export interface ItemDaFila {
  itemId: string
  titulo: string
  categoriaCodigo: string
  categoriaRotulo: string
  status: string
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
    remetente: atribuicao.item.email?.conteudo?.remetente ?? null,
    assunto: atribuicao.item.email?.conteudo?.assunto ?? null,
    recebidoEm: atribuicao.item.email?.recebidoEm ?? null,
    atribuidoEm: atribuicao.atribuidoEm,
    criadoEm: atribuicao.item.criadoEm,
  }))
}

/**
 * Concluir é ato pessoal: quem conclui é sempre o `Ator` autenticado.
 *
 * Antes, `colaboradorId` vinha por parâmetro — o que deixava a autorização e a
 * auditoria à mercê de quem chamasse. Agora não há como declarar ter concluído
 * o trabalho de outra pessoa.
 */
export async function concluir(
  banco: Banco,
  entrada: { itemId: string; observacao?: string },
  ator: Ator,
): Promise<void> {
  const correlacaoId = novaCorrelacao()

  await banco.$transaction(async (tx) => {
    const atribuicao = await tx.atribuicao.findFirst({
      where: { itemId: entrada.itemId, ativa: true },
      include: { item: true },
    })

    if (!atribuicao) throw new ErroDeNegocio(`Item "${entrada.itemId}" não tem responsável ativo.`)
    if (!ehOProprio(ator, atribuicao.colaboradorId)) {
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

  await banco.$transaction(async (tx) => {
    const atual = await tx.atribuicao.findFirst({
      where: { itemId: entrada.itemId, ativa: true },
      include: { item: { select: { status: true } } },
    })
    if (!atual) throw new ErroDeNegocio(`Item "${entrada.itemId}" não tem responsável ativo.`)

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

    if (atual.colaboradorId === entrada.paraColaboradorId) return

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
      throw new ErroDeNegocio(`Colaborador "${entrada.paraColaboradorId}" não existe.`)
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

  await banco.$transaction(async (tx) => {
    const atual = await tx.atribuicao.findFirst({
      where: { itemId: entrada.itemId, ativa: true },
      include: { item: { select: { status: true } } },
    })
    if (!atual) throw new ErroDeNegocio(`Item "${entrada.itemId}" não tem responsável ativo.`)

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
