import { z } from 'zod'

import { DOMINIO_ATUAL, desserializar, type Dominio } from '../core/esquemas'
import { exigirPapel, type Ator } from '../servidor/ator'
import type { Banco } from '../servidor/prisma'

/**
 * Memória consultável.
 *
 * O sistema sempre teve memória e nunca teve como lê-la. `LogAuditoria` e
 * `EventoProcessamento` eram gravados em 27 pontos do código e não tinham UM
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

/** Teto por consulta. Memória é para investigar um caso, não para varrer a base. */
const LIMITE_MAXIMO = 200

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
  o_que: string
  entidade: string | null
  entidadeId: string | null
  /** Sempre o `Ator` que agiu. Nulo em evento de processamento, que não tem autor. */
  usuario: string | null
  correlacaoId: string | null
  mensagem: string | null
  antes: unknown
  depois: unknown
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
    o_que: linha.acao,
    entidade: linha.entidade,
    entidadeId: linha.entidadeId,
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
    o_que: `${linha.etapa}/${linha.situacao}`,
    entidade: null,
    entidadeId: linha.referencia,
    usuario: null,
    correlacaoId: linha.correlacaoId,
    mensagem: linha.mensagem,
    antes: null,
    depois: linha.detalhe === null ? null : desserializar(linha.detalhe, JsonGravado, null),
  }
}

function emOrdem(linhas: LembrancaOperacional[]): LembrancaOperacional[] {
  return linhas.sort((a, b) => a.instante.getTime() - b.instante.getTime())
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
): Promise<LembrancaOperacional[]> {
  exigirPapel(ator, 'consultar memória operacional', 'operador', 'gestor')

  const [auditoria, eventos] = await Promise.all([
    banco.logAuditoria.findMany({
      where: { correlacaoId, dominio },
      orderBy: { timestamp: 'asc' },
      take: LIMITE_MAXIMO,
    }),
    banco.eventoProcessamento.findMany({
      where: { correlacaoId, dominio },
      orderBy: { criadoEm: 'asc' },
      take: LIMITE_MAXIMO,
    }),
  ])

  return emOrdem([...auditoria.map(daAuditoria), ...eventos.map(doProcessamento)])
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
): Promise<LembrancaOperacional[]> {
  exigirPapel(ator, 'consultar memória operacional', 'operador', 'gestor')

  const linhas = await banco.logAuditoria.findMany({
    where: { entidade, entidadeId, dominio },
    orderBy: { timestamp: 'asc' },
    take: LIMITE_MAXIMO,
  })

  return linhas.map(daAuditoria)
}
