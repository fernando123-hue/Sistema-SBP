import { ErroDeNegocio } from '../core/erros'
import { Prisma } from '../generated/prisma/client'
import {
  CategoriaClassificavelSchema,
  PayloadDoItemSchema,
  ResolucaoRevisaoSchema,
  ResolucaoDoEmailSchema,
  type ResolucaoRevisao,
  SugestaoIaGravadaSchema,
  serializar,
} from '../core/esquemas'
import { decidivelNoCartao } from '../core/revisao-por-email'
import { camposAlterados, compararRevisao, type DecisaoHumana } from '../core/qualidade-ia'
import { exigirPapel, type Ator } from '../servidor/ator'
import { transacaoComNovaTentativa } from '../servidor/conflito'
import { chaveDeBusca } from '../servidor/cpf-protegido'
import { novaCorrelacao, registrarLog } from '../servidor/observabilidade'
import type { ItemEmRevisao } from '../core/tipos'
import { acharTrecho, textoParaExibir, valorProcurado, type EmailDaRevisao } from '../core/trecho-do-email'
import type { Banco, Transacao } from '../servidor/prisma'
import { auditar } from './auditoria'

/**
 * `Revisao.resolvidoPor` é chave estrangeira para `Colaborador` — quem resolve
 * uma exceção é uma pessoa identificada, não uma string livre. A verificação
 * aqui existe só para trocar o erro cru de FK por uma mensagem que diz o que
 * está errado.
 */
async function exigirColaborador(tx: Transacao, colaboradorId: string): Promise<void> {
  const existe = await tx.colaborador.findUnique({
    where: { id: colaboradorId },
    select: { id: true },
  })
  if (!existe) {
    throw new ErroDeNegocio(
      'Sua conta não foi encontrada no cadastro. Saia e entre de novo.',
    )
  }
}

/**
 * O payload do item, lido para ser MESCLADO e gravado de volta (achado N-35).
 *
 * Aqui não cabe valor padrão: a leitura é o ponto de partida de uma escrita.
 * `desserializar` devolvia `{ campos: {} }` para payload ilegível, e a mescla
 * gravava isso por cima — CPF, CRM, liga mencionada e observação da IA sumiam,
 * a chave de busca era refeita só com o que a pessoa digitou, e nada ficava
 * registrado. Ilegível falha alto: a transação aborta, o item continua em
 * revisão com o payload como estava, e a rota responde 500 com correlação.
 *
 * A mensagem leva o id do item, NUNCA o conteúdo: ela vai para o log, e o
 * payload tem nome e CPF de associado.
 */
function payloadGravado(itemId: string, texto: string) {
  let bruto: unknown
  try {
    bruto = JSON.parse(texto)
  } catch {
    bruto = undefined
  }
  const lido = PayloadDoItemSchema.safeParse(bruto)
  if (!lido.success) {
    throw new Error(
      `Item.payload ilegível no item "${itemId}". A revisão não foi gravada para não apagar o que a IA extraiu — corrija a linha, não o leitor.`,
    )
  }
  return lido.data
}

/**
 * O acerto da IA nesta revisão, pronto para gravar (`A23(c)`).
 *
 * Gravado na hora porque é a única hora em que dá para calcular: título e
 * campos, dos dois lados, saem no prazo do conteúdo do e-mail, e comparar vazio
 * com vazio dá "aceita sem correção". Sem isto, toda correção de campo viraria
 * acerto no dia do prazo — uma taxa que melhora sozinha, sem ninguém notar.
 *
 * Sugestão ilegível grava `null`, e o painel conta a revisão como ignorada, à
 * vista, em vez de inventar um rótulo. A revisão não é barrada: a decisão da
 * pessoa sobre o item vale mesmo quando a medida não pode ser feita. O aviso
 * no log diz QUAL revisão, na hora — o número agregado sozinho não diz.
 */
export function acertoDaRevisao(
  revisaoId: string,
  sugestaoIa: string,
  decisao: DecisaoHumana,
): { desfecho: string | null; correcoes: string | null } {
  let sugestao
  try {
    sugestao = SugestaoIaGravadaSchema.parse(JSON.parse(sugestaoIa))
  } catch {
    registrarLog('aviso', 'acerto da IA não gravado: a sugestão desta revisão está ilegível', {
      revisaoId,
    })
    return { desfecho: null, correcoes: null }
  }
  const { desfecho, correcoes, camposAlterados } = compararRevisao({ sugestao, decisao })
  return { desfecho, correcoes: serializar({ ...correcoes, camposAlterados }) }
}

/** Aprovar em massa é aceitar a sugestão inteira sem tocar em nada. */
const DECISAO_DA_APROVACAO_EM_MASSA: DecisaoHumana = {
  categoriaCodigo: null,
  titulo: null,
  campos: null,
  aprovado: true,
  itensExtras: 0,
}

/**
 * Fila de exceções da IA — e dataset de melhoria contínua.
 *
 * O operador não recomeça a análise do zero: ele parte da sugestão do modelo,
 * corrige o que estiver errado e aprova. A diferença entre `sugestaoIa` e
 * `valorFinal` é exatamente a medida de acerto do modelo, e é ela que autoriza
 * (ou não) afrouxar o limiar de confiança depois.
 */

/**
 * A fila de revisão, com o TOTAL ao lado.
 *
 * Devolver só o pedaço truncado deixava a tela dizer "200 itens" para
 * sempre enquanto a fila crescia atrás do corte. Como a ordenação é fixa
 * (`confianca asc, criadoEm asc`), o que fica além do limite fica lá
 * PERMANENTEMENTE: nunca sobe, nunca aparece, ninguém resolve. Fila que
 * esconde o próprio tamanho é indistinguível de fila sob controle.
 */
export type { ItemEmRevisao }

export interface FilaDeRevisao {
  itens: ItemEmRevisao[]
  /** Quantas revisões pendentes existem de verdade, ignorando o limite. */
  total: number
}

export async function listarPendentes(banco: Banco, limite = 100): Promise<FilaDeRevisao> {
  const total = await banco.revisao.count({ where: { resolvidoEm: null } })
  const registros = await banco.revisao.findMany({
    where: { resolvidoEm: null },
    orderBy: [{ confianca: 'asc' }, { criadoEm: 'asc' }],
    take: limite,
    include: {
      item: {
        include: {
          categoria: { select: { codigo: true, limiarConfianca: true } },
          // Só o que a lista mostra (achado N-34). `include` trazia o `corpo`
          // (LongText, até 200 mil caracteres) de cada pendente a cada
          // abertura — e quem enche a revisão é justamente e-mail suspeito.
          email: {
            select: { conteudoSuspeito: true, conteudo: { select: { remetente: true, assunto: true } } },
          },
        },
      },
    },
  })

  // Quantas revisões cada e-mail tem pendentes DE VERDADE, além do corte
  // (`A69`, 1A). A tela só junta um e-mail num cartão quando tem todas na mão:
  // "Aprovar os 3" de um e-mail com 5 pendentes decidiria sobre nomes que
  // ninguém viu — e o serviço recusaria, mas a tela não deve nem oferecer.
  const emailIds = [...new Set(registros.flatMap((registro) => (registro.item.emailId ? [registro.item.emailId] : [])))]
  const contagens =
    emailIds.length === 0
      ? []
      : await banco.$queryRaw<{ emailId: string; pendentes: bigint }[]>`
          SELECT i.emailId AS emailId, COUNT(*) AS pendentes
          FROM \`Revisao\` r JOIN \`Item\` i ON i.id = r.itemId
          WHERE r.resolvidoEm IS NULL AND i.emailId IN (${Prisma.join(emailIds)})
          GROUP BY i.emailId`
  const pendentesPorEmail = new Map(contagens.map((linha) => [linha.emailId, Number(linha.pendentes)]))

  const itens = registros.map((registro) => ({
    revisaoId: registro.id,
    itemId: registro.itemId,
    motivo: registro.motivo,
    confianca: registro.confianca,
    campoIncerto: registro.campoIncerto,
    titulo: registro.item.titulo,
    categoriaCodigo: registro.item.categoria.codigo,
    limiarConfianca: registro.item.categoria.limiarConfianca,
    remetente: registro.item.email?.conteudo?.remetente ?? null,
    assunto: registro.item.email?.conteudo?.assunto ?? null,
    sugestaoIa: registro.sugestaoIa,
    semLiga: registro.item.ligaId === null,
    emailId: registro.item.emailId,
    emailSuspeito: registro.item.email?.conteudoSuspeito ?? false,
    pendentesNoEmail: registro.item.emailId ? (pendentesPorEmail.get(registro.item.emailId) ?? 0) : 1,
  }))

  return { itens, total }
}

/**
 * O e-mail de UMA revisão, lido só quando a pessoa pede (`A69`, 2A).
 *
 * ═══ POR QUE SOB DEMANDA, E UMA DE CADA VEZ ═══
 *
 * A lista não traz o corpo de propósito (achado N-34): até 200 mil caracteres
 * por e-mail, e quem enche a Revisão é justamente e-mail suspeito. Aqui o corpo
 * sai por revisão, para quem clicou, e cada leitura fica na trilha — sem o
 * texto, só quem leu e qual e-mail —, porque o corpo tem nome e CPF de
 * associado e a pergunta "quem viu isto?" precisa de resposta.
 *
 * Só revisão PENDENTE: resolvida, a decisão já foi tomada, e esta rota não é
 * caminho lateral para ler e-mail antigo de quem quer que seja.
 *
 * ═══ O QUE VOLTA ═══
 *
 * Texto, nunca HTML, sem controles de direção (`textoParaExibir`). Expurgado
 * pela retenção diz que foi expurgado e quando (invariante 11); item manual
 * diz que não há e-mail. Sem conteúdo E sem carimbo de expurgo é dado
 * quebrado, e falha alto (invariante 7): fingir "expurgado" esconderia a
 * perda.
 */
export async function lerEmailDaRevisao(
  banco: Banco,
  revisaoId: string,
  ator: Ator,
): Promise<EmailDaRevisao> {
  exigirPapel(ator, 'ver o e-mail de uma revisão', 'operador', 'gestor')

  const revisao = await banco.revisao.findUnique({
    where: { id: revisaoId },
    select: {
      resolvidoEm: true,
      campoIncerto: true,
      sugestaoIa: true,
      item: {
        select: {
          email: {
            select: {
              id: true,
              recebidoEm: true,
              conteudoExpurgadoEm: true,
              conteudo: { select: { remetente: true, assunto: true, corpo: true } },
            },
          },
        },
      },
    },
  })
  if (!revisao) throw new ErroDeNegocio('Esta revisão não foi encontrada. Atualize a tela.')
  if (revisao.resolvidoEm) {
    throw new ErroDeNegocio('Esta revisão já foi resolvida. Atualize a tela para ver a próxima.')
  }

  const email = revisao.item.email
  if (!email) return { situacao: 'sem_email' }
  if (email.conteudoExpurgadoEm) {
    return { situacao: 'expurgado', expurgadoEm: email.conteudoExpurgadoEm.toISOString() }
  }
  if (!email.conteudo) {
    throw new Error(
      `Email "${email.id}" sem conteúdo e sem carimbo de expurgo. O conteúdo sumiu fora da retenção — investigue antes de mostrar qualquer coisa.`,
    )
  }

  // Escrita avulsa, fora de transação, e de propósito: ler não tem fato
  // transacional para acompanhar (invariante 14). Vem ANTES de devolver o
  // corpo: se a trilha não grava, a leitura falha e nada sai.
  await auditar(banco, {
    entidade: 'Email',
    entidadeId: email.id,
    acao: 'email_lido_na_revisao',
    depois: { revisaoId },
    usuario: ator.colaboradorId,
  })

  const corpo = email.conteudo.corpo
  const valor = valorProcurado(revisao.campoIncerto, sugestaoParaProcurar(revisao.sugestaoIa))
  return {
    situacao: 'disponivel',
    remetente: textoParaExibir(email.conteudo.remetente),
    assunto: textoParaExibir(email.conteudo.assunto),
    recebidoEm: email.recebidoEm.toISOString(),
    corpo: textoParaExibir(corpo),
    campo: revisao.campoIncerto,
    trecho: valor === null ? null : acharTrecho(corpo, valor),
  }
}

/**
 * A sugestão gravada, só com o que a procura usa. Ilegível vira vazia: aqui
 * é leitura para os olhos, e a falta do trecho marcado já é dita na tela.
 */
function sugestaoParaProcurar(texto: string): {
  campos: Record<string, unknown>
  ligaMencionada: string | null
} {
  try {
    const bruto: unknown = JSON.parse(texto)
    if (bruto === null || typeof bruto !== 'object') return { campos: {}, ligaMencionada: null }
    const { campos, ligaMencionada } = bruto as { campos?: unknown; ligaMencionada?: unknown }
    return {
      campos: campos !== null && typeof campos === 'object' ? (campos as Record<string, unknown>) : {},
      ligaMencionada: typeof ligaMencionada === 'string' ? ligaMencionada : null,
    }
  } catch {
    return { campos: {}, ligaMencionada: null }
  }
}

export async function resolver(
  banco: Banco,
  entrada: unknown,
  ator: Ator,
): Promise<{ itemId: string; itensExtrasCriados: string[] }> {
  exigirPapel(ator, 'resolver revisão', 'operador', 'gestor')
  const dados = ResolucaoRevisaoSchema.parse(entrada)
  const correlacaoId = novaCorrelacao()

  // Impasse com outra transação é repetido (`servidor/conflito.ts`).
  return transacaoComNovaTentativa(banco, async (tx) => {
    // TRAVA A REVISÃO ANTES DE LER (achado C-22). A conferência de
    // `resolvidoEm` era uma leitura sem trava: duas pessoas passavam por ela ao
    // mesmo tempo, a segunda sobrescrevia item, desfecho e autor da primeira, e
    // a trilha ficava com "aprovada" e "recusada" para o mesmo item. Travada, a
    // segunda espera e lê a revisão já resolvida.
    await tx.$queryRaw`SELECT id FROM \`Revisao\` WHERE id = ${dados.revisaoId} FOR UPDATE`
    return resolverTravada(tx, dados, ator, correlacaoId)
  })
}

/**
 * O miolo de `resolver`, com a revisão JÁ TRAVADA por quem chama.
 *
 * Separado para o cartão do e-mail (`resolverEmailDaRevisao`) decidir N
 * revisões com exatamente a mesma escrita, a mesma trilha e a mesma medida de
 * acerto da IA que a decisão avulsa — duas cópias desta função divergiriam no
 * primeiro conserto feito só numa delas.
 */
async function resolverTravada(
  tx: Transacao,
  dados: ResolucaoRevisao,
  ator: Ator,
  correlacaoId: string,
): Promise<{ itemId: string; itensExtrasCriados: string[] }> {
  const revisao = await tx.revisao.findUnique({
    where: { id: dados.revisaoId },
    include: { item: true },
  })

  if (!revisao) throw new ErroDeNegocio('Esta revisão não foi encontrada. Atualize a tela.')
  if (revisao.resolvidoEm) throw new ErroDeNegocio('Esta revisão já foi resolvida. Atualize a tela para ver a próxima.')

  await exigirColaborador(tx, ator.colaboradorId)

  const categoria = await tx.categoria.findUnique({
    where: { codigo: dados.categoriaCodigo },
    select: { id: true, ativa: true },
  })
  if (!categoria) throw new ErroDeNegocio(`Categoria "${dados.categoriaCodigo}" não existe.`)
  // Categoria desativada não entra em rodada nem no painel (achado C-23): o
  // item aprovado ali sumiria da operação sem erro. Mesma recusa do registro
  // manual (`conferirDestino`).
  if (!categoria.ativa) {
    throw new ErroDeNegocio(`A categoria "${dados.categoriaCodigo}" está desativada. Escolha outra.`)
  }

  // Sem título: o que a IA extraiu pode ter nome de associado, e a trilha
  // não tem prazo (`A23(d)`).
  const antes = {
    categoriaId: revisao.item.categoriaId,
    status: revisao.item.status,
  }

  // MESCLA, não sobrescreve.
  //
  // Gravar `{ campos: dados.campos }` apagava tudo que a IA extraiu — nome,
  // CPF, CRM, campos ausentes, liga mencionada. Como a tela envia os campos
  // vazios quando o operador não mexe neles, aprovar uma revisão deixava o
  // item com MENOS informação do que antes de ser revisado, e o dataset de
  // melhoria nascia vazio justamente na dimensão que mais importa.
  const payloadAnterior = payloadGravado(revisao.item.id, revisao.item.payload)
  const payloadFinal = {
    ...payloadAnterior,
    campos: { ...payloadAnterior.campos, ...dados.campos },
    revisadoPorHumano: true,
  }

  const item = await tx.item.update({
    where: { id: revisao.itemId },
    data: {
      categoriaId: categoria.id,
      titulo: dados.titulo,
      payload: serializar(payloadFinal),
      // A chave vem dos campos FINAIS: a pessoa pode ter corrigido ou trocado
      // o CPF, e a chave antiga não pode sobreviver a isso (`A23(b)`).
      ...chaveDeBusca(payloadFinal.campos),
      // Aprovado por humano entra na próxima rodada. Recusado sai da fila
      // sem sumir do banco — cancelado é estado, não exclusão.
      status: dados.aprovar ? 'aprovado' : 'cancelado',
      // Carimba QUANDO saiu. Sem isto, um cancelamento feito hoje mudaria
      // retroativamente a pendência do mês passado no painel: o número
      // mudaria sozinho entre duas consultas, e a comparação com a planilha
      // deixaria de significar coisa alguma.
      canceladoEm: dados.aprovar ? null : new Date(),
    },
  })

  await tx.revisao.update({
    where: { id: dados.revisaoId },
    data: {
      valorFinal: serializar({
        categoriaCodigo: dados.categoriaCodigo,
        titulo: dados.titulo,
        campos: dados.campos,
        aprovado: dados.aprovar,
        itensExtras: dados.itensExtras.length,
      }),
      ...acertoDaRevisao(revisao.id, revisao.sugestaoIa, {
        categoriaCodigo: dados.categoriaCodigo,
        titulo: dados.titulo,
        campos: dados.campos,
        aprovado: dados.aprovar,
        itensExtras: dados.itensExtras.length,
      }),
      resolvidoPor: ator.colaboradorId,
      resolvidoEm: new Date(),
    },
  })

  await auditar(tx, {
    entidade: 'Item',
    entidadeId: item.id,
    acao: dados.aprovar ? 'revisao_aprovada' : 'revisao_recusada',
    antes,
    // QUAIS campos mudaram e SE o título mudou — nunca o que está escrito.
    depois: {
      categoriaId: categoria.id,
      status: item.status,
      tituloEditado: dados.titulo.trim() !== revisao.item.titulo.trim(),
      camposAlterados: camposAlterados(payloadAnterior.campos, payloadFinal.campos),
    },
    usuario: ator.colaboradorId,
    correlacaoId,
  })

  // O N que a IA propôs é só uma sugestão (AT-06). Quando o operador percebe
  // que um item de lista ainda escondia mais gente — ex.: "e mais 2 ligantes"
  // no rodapé —, ele registra a carga real aqui em vez de o sistema ficar
  // pequeno pra sempre. Cada item extra nasce já `aprovado`: um humano acabou
  // de olhar para ele, não faz sentido mandar pra fila de novo.
  const itensExtrasCriados: string[] = []
  if (dados.aprovar && dados.itensExtras.length > 0) {
    // `(emailId, sequencia)` é único no banco. `revisao.item.sequencia + 1`
    // colide na hora — é exatamente a posição do PRÓXIMO irmão que a IA já
    // criou no mesmo desdobramento. A sequência real precisa vir do maior
    // valor já usado pelo e-mail, não da posição do item sendo revisado.
    //
    // Só que isso vale para item VINDO DE E-MAIL. Com `emailId` nulo — que
    // significa "origem manual" no resto do sistema — a mesma consulta
    // varreria todos os itens manuais já criados, que não têm parentesco
    // nenhum entre si, e devolveria uma sequência sem sentido. Pior: em SQL,
    // `NULL` é distinto de `NULL` num índice único, então a constraint não
    // apanharia a colisão e o erro passaria calado. Para esses, a sequência
    // se conta a partir do próprio item de origem.
    let proximaSequencia = revisao.item.sequencia + 1

    if (revisao.item.emailId) {
      const maiorSequencia = await tx.item.aggregate({
        where: { emailId: revisao.item.emailId },
        _max: { sequencia: true },
      })
      proximaSequencia = (maiorSequencia._max.sequencia ?? revisao.item.sequencia) + 1
    }

    for (const extra of dados.itensExtras) {
      const criado = await tx.item.create({
        data: {
          emailId: revisao.item.emailId,
          categoriaId: categoria.id,
          // HERDA A LIGA DO ITEM DE ORIGEM.
          //
          // Sem isto, o desdobramento — que é EXATAMENTE o caso do `A4`,
          // "um e-mail lista trinta ligantes" — criava trinta itens com
          // `ligaId` nulo. Cada um virava um lote de um só (é o que
          // `agruparPorLiga` faz com item sem liga), a liga era espalhada
          // entre a equipe inteira, e o agrupamento que o operador acabara
          // de justificar na tela deixava de valer justamente para os itens
          // que ele criou.
          //
          // O item extra é o mesmo trabalho da mesma liga: a única resposta
          // correta é a liga do item de origem.
          ligaId: revisao.item.ligaId,
          ...chaveDeBusca(extra.campos),
          sequencia: proximaSequencia,
          titulo: extra.titulo,
          payload: serializar({
            campos: extra.campos,
            camposAusentes: [],
            ligaMencionada: payloadAnterior.ligaMencionada,
            observacao: null,
            revisadoPorHumano: true,
          }),
          confianca: 1,
          status: 'aprovado',
        },
      })
      itensExtrasCriados.push(criado.id)
      proximaSequencia += 1

      await auditar(tx, {
        entidade: 'Item',
        entidadeId: criado.id,
        acao: 'item_criado_por_divisao_de_revisao',
        depois: { categoriaId: categoria.id, origemRevisaoId: dados.revisaoId },
        usuario: ator.colaboradorId,
        correlacaoId,
      })
    }
  }

  return { itemId: item.id, itensExtrasCriados }
}

/**
 * O cartão do e-mail na Revisão: N decisões, tomadas de uma vez (`A69`, 1A).
 *
 * ═══ POR QUE EXISTE ═══
 *
 * Uma lista de ligantes vira N itens, e cada um ia para a Revisão com o
 * formulário inteiro. A decisão real é uma só — "estes N nomes são os que o
 * e-mail pede?" —, e agora ela é tomada assim: tirar quem não é, corrigir o
 * nome, acrescentar quem a IA não separou, e aprovar. No banco continua sendo
 * revisão a revisão, por `resolverTravada`: mesma escrita, mesma trilha, mesma
 * medida de acerto da IA. A diferença é só a correlação, que é uma para o
 * e-mail inteiro.
 *
 * ═══ TUDO OU NADA ═══
 *
 * As revisões pendentes do e-mail são travadas pela chave, numa consulta, em
 * ordem de id; nada além delas é travado antes de `resolverTravada` escrever.
 * O conjunto pedido tem de ser IGUAL ao conjunto pendente: faltou
 * uma, sobrou uma de outro e-mail, alguém resolveu uma enquanto a tela estava
 * aberta — nada é decidido e a pessoa atualiza. Decidir "os outros dois" de um
 * cartão que mostrava três seria decidir sobre uma lista que ninguém viu.
 *
 * ═══ O QUE CONTINUA ITEM A ITEM ═══
 *
 * Tudo que `decidivelNoCartao` deixa de fora: e-mail suspeito, motivo de
 * alerta, e — mesmo com motivo `desdobramento` — campo apontado com valor
 * para conferir ou liga citada que ficou de fora (revisão de segurança do
 * #167). A tela nem oferece o cartão nesses casos; a recusa aqui é para quem
 * chamar a rota sem a tela.
 */
const LISTA_MUDOU =
  'A lista deste e-mail mudou desde que você abriu a tela. Nada foi decidido: atualize e confira de novo.'

export async function resolverEmailDaRevisao(
  banco: Banco,
  entrada: unknown,
  ator: Ator,
): Promise<{ aprovados: number; descartados: number; criados: number }> {
  exigirPapel(ator, 'resolver revisão', 'operador', 'gestor')
  const dados = ResolucaoDoEmailSchema.parse(entrada)
  const aprovados = dados.revisoes.filter((linha) => linha.aprovar).length
  if (dados.novos.length > 0 && aprovados === 0) {
    throw new ErroDeNegocio('Para acrescentar alguém, aprove pelo menos um item do e-mail.')
  }
  const correlacaoId = novaCorrelacao()

  // O prazo padrão do Prisma (5 s) não cabe numa lista longa: cada revisão é
  // um punhado de escritas. Mesmo prazo de `concluirDoMesmoEmail`.
  return transacaoComNovaTentativa(
    banco,
    async (tx) => {
      // Dois passos, e a trava SÓ em `Revisao` (revisões técnica e de
      // segurança do #167). Um `JOIN … FOR UPDATE` travava também os `Item` do
      // e-mail (inclusive os já em execução), a linha `Email` e lacunas de
      // índice, por até 20 s, e na ordem do plano de leitura — não na do
      // `ORDER BY`. Aqui: primeiro quais revisões o e-mail tem pendentes
      // (leitura comum), depois a trava delas pela chave, em ordem de id. A
      // leitura com trava enxerga o valor mais novo, então quem resolveu uma
      // delas no meio aparece como resolvida e a decisão inteira é recusada.
      const pendentes = await tx.$queryRaw<{ id: string }[]>`
        SELECT r.id AS id
        FROM \`Revisao\` r JOIN \`Item\` i ON i.id = r.itemId
        WHERE i.emailId = ${dados.emailId} AND r.resolvidoEm IS NULL`

      const pedidas = new Set(dados.revisoes.map((linha) => linha.revisaoId))
      const conjuntoBate =
        pendentes.length === pedidas.size && pendentes.every((pendente) => pedidas.has(pendente.id))
      if (!conjuntoBate) throw new ErroDeNegocio(LISTA_MUDOU)

      const ids = [...pedidas].sort()
      const travadas = await tx.$queryRaw<
        { id: string; resolvidoEm: Date | null; motivo: string; campoIncerto: string | null; sugestaoIa: string }[]
      >`
        SELECT id, resolvidoEm, motivo, campoIncerto, sugestaoIa
        FROM \`Revisao\` WHERE id IN (${Prisma.join(ids)})
        ORDER BY id
        FOR UPDATE`
      if (travadas.length !== ids.length || travadas.some((travada) => travada.resolvidoEm !== null)) {
        throw new ErroDeNegocio(LISTA_MUDOU)
      }

      const itens = await tx.revisao.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          item: {
            select: {
              emailId: true,
              ligaId: true,
              categoria: { select: { codigo: true } },
              email: { select: { conteudoSuspeito: true } },
            },
          },
        },
      })
      const doItem = new Map(itens.map((linha) => [linha.id, linha.item]))

      // A mesma regra da tela, de novo aqui: a tela sozinha não é trava.
      const foraDoCartao = travadas.some((travada) => {
        const item = doItem.get(travada.id)
        return (
          item === undefined ||
          item.emailId !== dados.emailId ||
          !decidivelNoCartao({
            motivo: travada.motivo,
            campoIncerto: travada.campoIncerto,
            sugestaoIa: travada.sugestaoIa,
            semLiga: item.ligaId === null,
            emailSuspeito: item.email?.conteudoSuspeito ?? true,
          })
        )
      })
      if (foraDoCartao) throw new ErroDeNegocio('Este e-mail precisa ser decidido item a item. Nada foi decidido.')
      const categoriaDe = new Map(itens.map((linha) => [linha.id, linha.item.categoria.codigo]))

      // Os acrescentados vão como "itens extras" da PRIMEIRA aprovada: herdam
      // dela categoria e liga, exatamente como na divisão de uma revisão avulsa.
      const primeiraAprovada = dados.revisoes.find((linha) => linha.aprovar)?.revisaoId
      let criados = 0
      for (const linha of [...dados.revisoes].sort((a, b) => (a.revisaoId < b.revisaoId ? -1 : 1))) {
        const categoria = CategoriaClassificavelSchema.safeParse(categoriaDe.get(linha.revisaoId))
        if (!categoria.success) {
          throw new ErroDeNegocio('Este e-mail precisa ser decidido item a item. Nada foi decidido.')
        }
        const feito = await resolverTravada(
          tx,
          {
            revisaoId: linha.revisaoId,
            categoriaCodigo: categoria.data,
            titulo: linha.titulo,
            campos: linha.campos,
            aprovar: linha.aprovar,
            itensExtras: linha.revisaoId === primeiraAprovada ? dados.novos : [],
          },
          ator,
          correlacaoId,
        )
        criados += feito.itensExtrasCriados.length
      }

      return { aprovados, descartados: dados.revisoes.length - aprovados, criados }
    },
    20_000,
  )
}

/**
 * Aprovação em massa das exceções ROTINEIRAS.
 *
 * Cobre só `baixa_confianca` e `campo_ausente`. Conteúdo suspeito, anexo
 * rejeitado e desdobramento continuam fora daqui — são justamente os casos em
 * que a revisão humana existe para alguma coisa. O desdobramento limpo tem o
 * cartão do e-mail (`resolverEmailDaRevisao`), onde a pessoa vê a lista
 * inteira antes de aprovar; esta função não vê nada.
 */
export async function aprovarTodosPendentes(
  banco: Banco,
  ator: Ator,
): Promise<{ aprovados: number }> {
  exigirPapel(ator, 'aprovar revisões em massa', 'operador', 'gestor')
  const usuario = ator.colaboradorId
  const correlacaoId = novaCorrelacao()

  return banco.$transaction(async (tx) => {
    await exigirColaborador(tx, usuario)

    // NUNCA aprova em massa o que a segurança sinalizou. A docstring dizia
    // "itens que a IA já classificou com confiança suficiente", mas o filtro
    // era `resolvidoEm: null` — sem restrição nenhuma. Isso aprovava, de uma
    // vez, e-mails com tentativa de prompt injection e anexos rejeitados.
    const pendentes = await tx.revisao.findMany({
      where: {
        resolvidoEm: null,
        motivo: { in: ['baixa_confianca', 'campo_ausente'] },
      },
      select: { id: true, itemId: true, sugestaoIa: true },
    })

    for (const pendente of pendentes) {
      await tx.item.update({ where: { id: pendente.itemId }, data: { status: 'aprovado' } })
      await tx.revisao.update({
        where: { id: pendente.id },
        data: {
          valorFinal: serializar({ aprovado: true, origem: 'aprovacao_em_massa' }),
          ...acertoDaRevisao(pendente.id, pendente.sugestaoIa, DECISAO_DA_APROVACAO_EM_MASSA),
          resolvidoPor: usuario,
          resolvidoEm: new Date(),
        },
      })
      await auditar(tx, {
        entidade: 'Item',
        entidadeId: pendente.itemId,
        acao: 'revisao_aprovada_em_massa',
        depois: { status: 'aprovado' },
        usuario,
        correlacaoId,
      })
    }

    return { aprovados: pendentes.length }
  })
}
