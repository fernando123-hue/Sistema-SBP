import { z } from 'zod'

import { ErroDeNegocio } from '../core/erros'
import { DOMINIO_ATUAL, desserializar, type Dominio } from '../core/esquemas'
import { exigirPapel, type Ator } from '../servidor/ator'
import type { Banco } from '../servidor/prisma'

/**
 * Memória consultável.
 *
 * O sistema sempre teve memória e nunca teve como lê-la. `LogAuditoria` e
 * `EventoProcessamento` eram gravados em 25 pontos do código e não tinham UM
 * leitor em produção — nenhuma rota, nenhuma tela, nenhuma consulta. As únicas
 * leituras do repositório estavam em arquivos `.test.ts`. Para responder "o que
 * aconteceu com este item" era preciso `prisma studio` ou SQL na mão.
 *
 * O caso que obrigou este arquivo a existir: numa falha 500, `http.ts` entrega
 * ao usuário um identificador dizendo que ele "permite rastrear a falha". Esse
 * id não estava em tabela nenhuma e nenhuma rota o buscava. O sistema prometia
 * rastreabilidade na própria mensagem de erro e não entregava.
 *
 * ISTO NÃO É UM CÉREBRO, e a distinção importa. É a primeira função dele:
 * organizar e disponibilizar o contexto operacional que já existe. Não há
 * inferência, não há sugestão, não há padrão descoberto — só a memória que já
 * estava gravada, agora legível. O que vier depois cresce daqui.
 *
 * ─── O que este módulo NÃO faz, e por quê ───────────────────────────────
 *
 * **Não alimenta o prompt do modelo.** Nada aqui é montagem de contexto para
 * IA, e a ausência é deliberada. Duas razões, ambas estruturais:
 *
 * 1. Devolver ao modelo texto que veio de e-mail transformaria a injeção de
 *    prompt, hoje limitada a UMA mensagem, em ataque persistente: a carga
 *    sobreviveria ao e-mail e agiria sobre remetentes futuros. A defesa de
 *    `prepararConteudoExterno` roda na ingestão, sobre o texto cru — entre
 *    "ler memória" e "montar prompt" não existiria portão nenhum.
 * 2. Selecionar correções humanas parecidas e injetá-las no prompt é
 *    aprendizado em contexto: treinar com dado real da associação a cada
 *    requisição, sem decisão do dono do negócio. O invariante 9 diz que isso
 *    é decisão, nunca efeito colateral.
 *
 * **Não julga ninguém.** As linhas trazem `usuario` porque a trilha existe
 * para responder quem fez o quê. Nenhuma agregação por pessoa mora aqui —
 * invariante 10: métrica por pessoa é observabilidade, não avaliação.
 *
 * **Não vira número de painel.** Nenhuma função daqui é lida por
 * `servicos/painel.ts`. Métrica sai de `Item`, `Atribuicao` e `Execucao`, que
 * são fatos; memória é narrativa sobre fatos, e as duas coisas somadas dariam
 * dois jeitos de contar a mesma coisa.
 */

/**
 * Teto POR TABELA. `porCorrelacao` lê duas, então o teto real dela é o dobro.
 *
 * O corte é informado, nunca silencioso: ver `MemoriaConsultada.truncado`.
 */
const LIMITE_POR_TABELA = 200

/**
 * Entidades que esta consulta aceita.
 *
 * Era texto livre da query string, e isso foi um vazamento real: com
 * `?entidade=Colaborador&id=<id>` um `operador` recebia a trilha da conta de
 * uma colega — e-mail e papel (que `GET /api/colaboradores` gasta uma linha
 * para exigir `gestor`), mais o histórico que rota nenhuma expõe hoje: quantas
 * vezes ela errou a senha, por quanto tempo ficou trancada, quando o gestor
 * redefiniu o acesso. Os ids saem de graça de `GET /api/painel`.
 *
 * Escalonamento de privilégio por caminho lateral — auditoria que vira
 * vigilância, e o invariante 10 no lugar exato onde ele mais dói. `Colaborador`
 * fica de FORA: ninguém pediu essa consulta, e a alternativa (liberá-la só a
 * gestor) resolveria a permissão sem resolver o propósito.
 */
const ENTIDADES_CONSULTAVEIS = new Set([
  'Item',
  'Email',
  'Atribuicao',
  'RodadaDistribuicao',
  'Escala',
])

/**
 * Uma lembrança, já normalizada.
 *
 * As duas tabelas de origem respondem perguntas diferentes — `LogAuditoria`
 * responde "quem mudou o quê, de que valor para qual"; `EventoProcessamento`
 * responde "o que falhou, em que etapa, dá para reprocessar" — e continuam
 * separadas no banco, como manda o invariante 11. Aqui elas viram uma linha só
 * porque quem investiga um caso quer a história em ordem, não duas listas para
 * intercalar de cabeça. `tipo` preserva de onde cada uma veio.
 */
export interface LembrancaOperacional {
  tipo: 'auditoria' | 'processamento'
  instante: Date
  /** `acao` da auditoria, ou `etapa/situacao` do evento. Vocabulário fechado no primeiro caso. */
  oQue: string
  entidade: string | null
  entidadeId: string | null
  /**
   * Referência externa do evento — hoje o `messageId` do e-mail.
   *
   * Campo próprio, e não `entidadeId`: `messageId` é cabeçalho escrito por
   * quem enviou, não id de linha nenhuma. Colapsar os dois faria qualquer
   * consumidor futuro tentar casá-lo com uma tabela e não achar nada — ou,
   * pior, achar a coisa errada.
   */
  referencia: string | null
  /** Sempre o `Ator` que agiu. Nulo em evento de processamento, que não tem autor. */
  usuario: string | null
  correlacaoId: string | null
  mensagem: string | null
  antes: unknown
  depois: unknown
}

/**
 * Resultado da consulta, com o corte declarado.
 *
 * `truncado` existe porque cortar auditoria em silêncio seria o defeito mais
 * fora de lugar possível nesta ferramenta. Uma sincronização usa UM
 * `correlacaoId` para o lote inteiro: num dia de 250 e-mails, devolver as 200
 * primeiras e calar sobre as 50 finais — justamente onde o lote quebrou —
 * faria quem investiga concluir que não houve mais nada.
 */
export interface MemoriaConsultada {
  linhas: LembrancaOperacional[]
  truncado: boolean
}

const JsonGravado = z.unknown()

function daAuditoria(linha: {
  timestamp: Date
  acao: string
  entidade: string
  entidadeId: string
  usuario: string
  correlacaoId: string | null
  antes: string | null
  depois: string | null
}): LembrancaOperacional {
  return {
    tipo: 'auditoria',
    instante: linha.timestamp,
    oQue: linha.acao,
    entidade: linha.entidade,
    entidadeId: linha.entidadeId,
    referencia: null,
    usuario: linha.usuario,
    correlacaoId: linha.correlacaoId,
    mensagem: null,
    // `desserializar` devolve o padrão em vez de estourar: uma linha antiga
    // com JSON ilegível desfalca a história, mas não pode derrubar a consulta
    // inteira — investigar uma falha é justamente quando isso mais importa.
    antes: linha.antes === null ? null : desserializar(linha.antes, JsonGravado, null),
    depois: linha.depois === null ? null : desserializar(linha.depois, JsonGravado, null),
  }
}

function doProcessamento(linha: {
  criadoEm: Date
  etapa: string
  situacao: string
  referencia: string | null
  correlacaoId: string
  mensagem: string | null
  detalhe: string | null
}): LembrancaOperacional {
  return {
    tipo: 'processamento',
    instante: linha.criadoEm,
    oQue: `${linha.etapa}/${linha.situacao}`,
    entidade: null,
    entidadeId: null,
    referencia: linha.referencia,
    usuario: null,
    correlacaoId: linha.correlacaoId,
    mensagem: linha.mensagem,
    antes: null,
    depois: linha.detalhe === null ? null : desserializar(linha.detalhe, JsonGravado, null),
  }
}

/**
 * Peso de desempate quando duas lembranças caem no mesmo milissegundo.
 *
 * Numa transação SQLite local isso é comum, não raro. Ordenar só por instante
 * deixava a estabilidade do `sort` decidir — e como a auditoria era
 * concatenada antes dos eventos, a história exibia o e-mail sendo "ingerido"
 * ANTES de a ingestão começar. Uma sequência de causa e efeito que mente na
 * ordem é pior do que nenhuma.
 */
function pesoNoEmpate(lembranca: LembrancaOperacional): number {
  if (lembranca.tipo !== 'processamento') return 1
  return lembranca.oQue.endsWith('/iniciado') ? 0 : 2
}

function emOrdem(linhas: LembrancaOperacional[]): LembrancaOperacional[] {
  return linhas.sort((a, b) => {
    const porInstante = a.instante.getTime() - b.instante.getTime()
    return porInstante !== 0 ? porInstante : pesoNoEmpate(a) - pesoNoEmpate(b)
  })
}

/**
 * Tudo que aconteceu sob uma correlação, em ordem.
 *
 * `correlacaoId` atravessa ingestão, interpretação, revisão e distribuição do
 * mesmo ciclo — é o fio que costura a história. Esta é a função que responde
 * ao identificador que uma falha 500 entrega ao usuário.
 *
 * Ordem CRESCENTE, ao contrário do resto do sistema: aqui se lê uma sequência
 * de causa e efeito, e ela só faz sentido do começo para o fim.
 */
export async function porCorrelacao(
  banco: Banco,
  correlacaoId: string,
  ator: Ator,
  dominio: Dominio = DOMINIO_ATUAL,
): Promise<MemoriaConsultada> {
  exigirPapel(ator, 'consultar memória operacional', 'operador', 'gestor')

  // Pede UM a mais que o teto em cada tabela: se vier, houve corte. É a forma
  // mais barata de saber, e sem ela o corte seria invisível.
  const [auditoria, eventos] = await Promise.all([
    banco.logAuditoria.findMany({
      where: { correlacaoId, dominio },
      orderBy: { timestamp: 'asc' },
      take: LIMITE_POR_TABELA + 1,
    }),
    banco.eventoProcessamento.findMany({
      where: { correlacaoId, dominio },
      orderBy: { criadoEm: 'asc' },
      take: LIMITE_POR_TABELA + 1,
    }),
  ])

  const truncado = auditoria.length > LIMITE_POR_TABELA || eventos.length > LIMITE_POR_TABELA

  return {
    linhas: emOrdem([
      ...auditoria.slice(0, LIMITE_POR_TABELA).map(daAuditoria),
      ...eventos.slice(0, LIMITE_POR_TABELA).map(doProcessamento),
    ]),
    truncado,
  }
}

/**
 * A história de UM registro — item, colaborador, rodada, e-mail.
 *
 * Responde "por que este item está assim?" sem ninguém abrir o banco. Só a
 * trilha de auditoria entra: `EventoProcessamento` não aponta para entidade,
 * e forçá-lo a apontar seria inventar um vínculo que o dado não tem.
 */
export async function porEntidade(
  banco: Banco,
  entidade: string,
  entidadeId: string,
  ator: Ator,
  dominio: Dominio = DOMINIO_ATUAL,
): Promise<MemoriaConsultada> {
  exigirPapel(ator, 'consultar memória operacional', 'operador', 'gestor')

  if (!ENTIDADES_CONSULTAVEIS.has(entidade)) {
    throw new ErroDeNegocio(
      `A memória não é consultável por "${entidade}". Aceitas: ` +
        `${[...ENTIDADES_CONSULTAVEIS].join(', ')}. A lista é fechada de propósito — ` +
        `a trilha de uma pessoa carrega histórico de acesso e não é material de consulta ` +
        `operacional.`,
    )
  }

  const linhas = await banco.logAuditoria.findMany({
    where: { entidade, entidadeId, dominio },
    orderBy: { timestamp: 'asc' },
    take: LIMITE_POR_TABELA + 1,
  })

  return {
    linhas: linhas.slice(0, LIMITE_POR_TABELA).map(daAuditoria),
    truncado: linhas.length > LIMITE_POR_TABELA,
  }
}
