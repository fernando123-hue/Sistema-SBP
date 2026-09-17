import { hojeIso } from '../core/util/datas'
import type { Banco } from '../servidor/prisma'

/**
 * Quanto a IA foi usada — contagem, nunca conteúdo (`A54`, achado C-06).
 *
 * É o lado durável do controle de consumo: o teto diário precisa sobreviver a
 * um reinício do servidor e valer para dois processos ao mesmo tempo, então ele
 * é contado no banco. O disjuntor, que responde "o fornecedor está fora do ar
 * agora", vive na memória do processo — problemas de durações diferentes.
 *
 * Como em `contagem-de-buscas.ts`: **nenhuma tela lê isto**. Quem calibra o
 * teto olha a tabela direto. Um painel de uso de IA por dia viraria meta, e a
 * pergunta que ele responde ("dá para gastar menos?") não é da equipe.
 */

export type TarefaDeIa = 'interpretacao' | 'assistente'

export interface ChamadaRegistrada {
  fornecedor: string
  modelo: string
  tarefa: TarefaDeIa
  resultado: 'ok' | 'falha'
  duracaoMs: number
  dia?: string
}

function codigoDoPrisma(erro: unknown): unknown {
  return erro !== null && typeof erro === 'object' && 'code' in erro
    ? (erro as { code?: unknown }).code
    : undefined
}

/**
 * Soma uma chamada na linha (dia, fornecedor, modelo, tarefa).
 *
 * Mesmo caminho da contagem de buscas: `updateMany` primeiro, `create` se a
 * linha não existia, e `update` por `increment` se duas chamadas criaram a
 * mesma linha ao mesmo tempo. Ler-somar-gravar perderia contagem justamente
 * no caso que interessa — o lote de 200 e-mails.
 *
 * A FALHA TAMBÉM É CHAMADA. Ela foi paga (a maioria dos fornecedores cobra a
 * tentativa, e todas custam tempo), e contá-la só em `falhas` faria o teto
 * ignorar exatamente o cenário que ele existe para conter: o laço que fracassa
 * duzentas vezes seguidas.
 */
export async function registrarChamada(banco: Banco, chamada: ChamadaRegistrada): Promise<void> {
  const chave = {
    dia: chamada.dia ?? hojeIso(),
    fornecedor: chamada.fornecedor,
    modelo: chamada.modelo,
    tarefa: chamada.tarefa,
  }
  const falha = chamada.resultado === 'falha' ? 1 : 0
  const soma = {
    chamadas: { increment: 1 },
    falhas: { increment: falha },
    duracaoMsTotal: { increment: chamada.duracaoMs },
  }

  const { count } = await banco.usoDaIa.updateMany({ where: chave, data: soma })
  if (count === 1) return

  try {
    await banco.usoDaIa.create({
      data: { ...chave, chamadas: 1, falhas: falha, duracaoMsTotal: chamada.duracaoMs },
    })
  } catch (erro) {
    if (codigoDoPrisma(erro) !== 'P2002') throw erro
    await banco.usoDaIa.update({
      where: { dia_fornecedor_modelo_tarefa: chave },
      data: soma,
    })
  }
}

/**
 * Quantas chamadas este fornecedor já fez hoje, somando modelos e tarefas.
 *
 * Por FORNECEDOR porque é dele a conta a pagar, e somando o assistente porque
 * ele gasta da mesma conta — separar os tetos deixaria uma tela de ajuda
 * conversadeira consumir o orçamento da ingestão sem que o teto da ingestão
 * acusasse nada.
 */
export async function chamadasDoDia(banco: Banco, fornecedor: string, dia: string = hojeIso()): Promise<number> {
  const soma = await banco.usoDaIa.aggregate({
    where: { dia, fornecedor },
    _sum: { chamadas: true },
  })
  return soma._sum.chamadas ?? 0
}
