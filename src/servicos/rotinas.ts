import { serializar, type Rotina } from '../core/esquemas'
import { hojeIso } from '../core/util/datas'
import {
  mensagemDoErro,
  mensagemPersistivel,
  novaCorrelacao,
  registrarEvento,
  registrarLog,
} from '../servidor/observabilidade'
import type { Banco } from '../servidor/prisma'
import { expurgarMotivosDeAfastamento, type ResultadoDoExpurgoDeMotivos } from './expurgo-lgpd'
import { prazoEmVigor } from './retencao'

/**
 * Rotinas que o sistema roda sozinho — `A17`: "a limpeza roda sozinha, uma vez
 * por dia".
 *
 * ═══ UMA VEZ POR DIA, MESMO COM VÁRIOS GATILHOS ═══
 *
 * O servidor tenta de tempos em tempos (`src/instrumentation.ts`), o
 * `npm run db:expurgar` pode rodar junto, e o modo de desenvolvimento recarrega
 * o módulo a cada edição. Quem decide quem roda é a linha `(rotina, data)`
 * única em `ExecucaoDeRotina`: só uma chamada consegue criá-la.
 *
 * ═══ FALHA NÃO SOME ═══
 *
 * Falhou, a linha fica `falha` com a mensagem, o evento vai para
 * `EventoProcessamento` e a próxima tentativa do dia roda de novo — até
 * `TENTATIVAS_POR_DIA`. Parar de tentar é deliberado: uma linha corrompida que
 * derruba a limpeza a cada quinze minutos encheria a memória operacional de
 * eventos iguais, e o que precisa acontecer é alguém olhar.
 */

/** Uma execução `em_curso` há mais que isto é de um processo que morreu no meio. */
export const MINUTOS_PARA_DAR_COMO_ABANDONADA = 30
export const TENTATIVAS_POR_DIA = 3

export interface ResumoDaLimpeza {
  motivosDeAfastamento: ResultadoDoExpurgoDeMotivos & { prazoEmDias: number }
}

export type ResultadoDaRotina =
  | { executou: true; situacao: 'sucesso'; correlacaoId: string; resumo: ResumoDaLimpeza }
  | { executou: true; situacao: 'falha'; correlacaoId: string; mensagem: string }
  | { executou: false; motivo: 'ja_concluida' | 'em_curso' | 'tentativas_esgotadas' }

type Vez = { id: string } | { motivo: 'ja_concluida' | 'em_curso' | 'tentativas_esgotadas' }

/** `P2002` é o código do Prisma para violação de constraint única. Ver `ingestao.ts`. */
function violouUnica(erro: unknown): boolean {
  return (
    erro !== null &&
    typeof erro === 'object' &&
    'code' in erro &&
    (erro as { code?: unknown }).code === 'P2002'
  )
}

async function reivindicar(
  banco: Banco,
  rotina: Rotina,
  data: string,
  correlacaoId: string,
  agora: Date,
): Promise<Vez> {
  try {
    return await banco.execucaoDeRotina.create({
      data: { rotina, data, situacao: 'em_curso', correlacaoId, iniciadaEm: agora },
      select: { id: true },
    })
  } catch (erro) {
    if (!violouUnica(erro)) throw erro
  }

  const linha = await banco.execucaoDeRotina.findUniqueOrThrow({ where: { rotina_data: { rotina, data } } })

  if (linha.situacao === 'sucesso') return { motivo: 'ja_concluida' }

  const abandonada =
    linha.situacao === 'em_curso' &&
    agora.getTime() - linha.iniciadaEm.getTime() >= MINUTOS_PARA_DAR_COMO_ABANDONADA * 60_000
  if (linha.situacao === 'em_curso' && !abandonada) return { motivo: 'em_curso' }

  if (linha.tentativas >= TENTATIVAS_POR_DIA) return { motivo: 'tentativas_esgotadas' }

  // Condicionado ao estado que ACABOU de ser lido: se outra chamada reivindicou
  // entre a leitura e esta escrita, a contagem é zero e esta desiste.
  const { count } = await banco.execucaoDeRotina.updateMany({
    where: { id: linha.id, situacao: linha.situacao, tentativas: linha.tentativas },
    data: {
      situacao: 'em_curso',
      tentativas: linha.tentativas + 1,
      iniciadaEm: agora,
      concluidaEm: null,
      mensagem: null,
      resumo: null,
      correlacaoId,
    },
  })

  return count === 1 ? { id: linha.id } : { motivo: 'em_curso' }
}

export async function rodarLimpezaDiaria(
  banco: Banco,
  opcoes: { hoje?: string; agora?: Date } = {},
): Promise<ResultadoDaRotina> {
  const rotina: Rotina = 'limpeza_diaria'
  const hoje = opcoes.hoje ?? hojeIso()
  const agora = opcoes.agora ?? new Date()
  const correlacaoId = novaCorrelacao()

  const vez = await reivindicar(banco, rotina, hoje, correlacaoId, agora)
  if ('motivo' in vez) return { executou: false, motivo: vez.motivo }

  try {
    const prazoEmDias = await prazoEmVigor(banco, 'motivo_de_afastamento')
    const motivos = await expurgarMotivosDeAfastamento(banco, {
      diasDeRetencao: prazoEmDias,
      hoje,
      correlacaoId,
    })
    const resumo: ResumoDaLimpeza = { motivosDeAfastamento: { ...motivos, prazoEmDias } }

    await banco.execucaoDeRotina.update({
      where: { id: vez.id },
      data: { situacao: 'sucesso', concluidaEm: new Date(), resumo: serializar(resumo) },
    })
    await registrarEvento(banco, {
      correlacaoId,
      etapa: rotina,
      situacao: 'sucesso',
      referencia: hoje,
      detalhe: resumo,
    })

    return { executou: true, situacao: 'sucesso', correlacaoId, resumo }
  } catch (erro) {
    const mensagem = mensagemPersistivel(erro)
    registrarLog('erro', 'limpeza diária falhou', { correlacaoId, data: hoje, erro: mensagemDoErro(erro) })

    await banco.execucaoDeRotina.update({
      where: { id: vez.id },
      data: { situacao: 'falha', concluidaEm: new Date(), mensagem },
    })
    await registrarEvento(banco, {
      correlacaoId,
      etapa: rotina,
      situacao: 'falha',
      referencia: hoje,
      mensagem,
    })

    return { executou: true, situacao: 'falha', correlacaoId, mensagem }
  }
}
