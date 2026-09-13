import type { TipoDeAfastamentoGravado } from './esquemas'
import { diaEmQueOMotivoVence } from './retencao'
import { deslocarDias } from './util/datas'

/**
 * O aviso que a gestora recebe ao entrar — `DECISOES.md § A17`.
 *
 * "Quem está fora hoje e por quê, quem volta hoje ou amanhã, e que motivos
 * expiram nos próximos dias." Montado AQUI, por regra, sem modelo de IA: mandar
 * "fulana está de atestado" a um fornecedor externo seria enviar dado de saúde
 * para fora da associação, e o assistente não recebe dado pessoal (invariante
 * 13). Por isso esta função mora ao lado do assistente e não dentro dele.
 *
 * Pura: a data de hoje entra como argumento. A fronteira de "quando o motivo
 * sai" é a mesma de `core/retencao.ts` — o aviso nunca promete um dia que a
 * limpeza não cumpre.
 */

/**
 * Quantos dias à frente o aviso olha para "motivos que expiram".
 *
 * Três dias cobrem um fim de semana: a gestora que entra na sexta vê o que sai
 * até segunda. Hipótese em `DECISOES.md § C` — `A17` diz "nos próximos dias".
 */
export const DIAS_DE_ANTECEDENCIA_DO_AVISO = 3

export interface AusenciaParaAviso {
  nome: string
  tipo: TipoDeAfastamentoGravado
  inicio: string
  fim: string | null
  canceladoNoDia: string | null
  temObservacao: boolean
  /** O prazo já passou e a limpeza já apagou o motivo. */
  motivoJaSaiu: boolean
}

export type SituacaoDaLimpezaDeHoje = 'concluida' | 'falhou' | 'pendente'

export interface AvisoDoGestor {
  hoje: string
  foraHoje: { nome: string; tipo: TipoDeAfastamentoGravado; volta: string | null }[]
  voltam: { nome: string; quando: 'hoje' | 'amanha' }[]
  motivosQueSaem: {
    nome: string
    tipo: TipoDeAfastamentoGravado
    dia: string
    /**
     * O dia já chegou e o motivo continua guardado. Só acontece se a limpeza
     * falhou ou ainda não rodou — e é exatamente o que a gestora precisa ver.
     */
    atrasado: boolean
    /**
     * A ausência foi cancelada — não aconteceu. O dono pediu destaque (12/09/2026):
     * sem ele, "motivo de atestado sai em 13/09" leria como um atestado que existiu.
     */
    cancelada: boolean
  }[]
  limpeza: SituacaoDaLimpezaDeHoje
  /** `true` quando não há nada a dizer — a tela não mostra aviso vazio. */
  vazio: boolean
}

const porNome = <T extends { nome: string }>(a: T, b: T): number => a.nome.localeCompare(b.nome, 'pt-BR')

export function montarAvisoDoGestor(entrada: {
  hoje: string
  prazoEmDias: number
  ausencias: readonly AusenciaParaAviso[]
  limpeza: SituacaoDaLimpezaDeHoje
}): AvisoDoGestor {
  const { hoje, prazoEmDias, ausencias, limpeza } = entrada
  const amanha = deslocarDias(hoje, 1)
  const ultimoDiaOlhado = deslocarDias(hoje, DIAS_DE_ANTECEDENCIA_DO_AVISO)

  // Cancelada não aconteceu: não está fora, não volta. Mas o motivo dela ainda
  // pode estar guardado — por isso ela só é filtrada das duas primeiras listas.
  const valendo = ausencias.filter((ausencia) => ausencia.canceladoNoDia === null)

  const foraHoje = valendo
    .filter((ausencia) => ausencia.inicio <= hoje && (ausencia.fim === null || ausencia.fim >= hoje))
    .map((ausencia) => ({
      nome: ausencia.nome,
      tipo: ausencia.tipo,
      volta: ausencia.fim === null ? null : deslocarDias(ausencia.fim, 1),
    }))
    .sort(porNome)

  const voltam = valendo
    .flatMap((ausencia): AvisoDoGestor['voltam'] => {
      if (ausencia.fim === null) return []
      const diaDaVolta = deslocarDias(ausencia.fim, 1)
      if (diaDaVolta === hoje) return [{ nome: ausencia.nome, quando: 'hoje' }]
      if (diaDaVolta === amanha) return [{ nome: ausencia.nome, quando: 'amanha' }]
      return []
    })
    .sort(porNome)

  const motivosQueSaem = ausencias
    // Férias sem observação não têm motivo a perder: avisar seria ruído.
    .filter((ausencia) => !ausencia.motivoJaSaiu && (ausencia.tipo !== 'ferias' || ausencia.temObservacao))
    .flatMap((ausencia) => {
      const dia = diaEmQueOMotivoVence(
        { fim: ausencia.fim, canceladoNoDia: ausencia.canceladoNoDia },
        prazoEmDias,
      )
      if (dia === null || dia > ultimoDiaOlhado) return []
      return [
        {
          nome: ausencia.nome,
          tipo: ausencia.tipo,
          dia,
          atrasado: dia <= hoje,
          cancelada: ausencia.canceladoNoDia !== null,
        },
      ]
    })
    .sort((a, b) => (a.dia === b.dia ? porNome(a, b) : a.dia < b.dia ? -1 : 1))

  return {
    hoje,
    foraHoje,
    voltam,
    motivosQueSaem,
    limpeza,
    vazio:
      foraHoje.length === 0 && voltam.length === 0 && motivosQueSaem.length === 0 && limpeza !== 'falhou',
  }
}
