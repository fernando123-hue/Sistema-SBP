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
 * até segunda. Confirmado pelo dono em 12/09/2026 (`A39`).
 */
export const DIAS_DE_ANTECEDENCIA_DO_AVISO = 3

export interface AusenciaParaAviso {
  /** Id do afastamento. Vira a chave do que a gestora já viu — nunca o nome. */
  id: string
  nome: string
  tipo: TipoDeAfastamentoGravado
  inicio: string
  fim: string | null
  canceladoNoDia: string | null
  temObservacao: boolean
  /** O prazo já passou e a limpeza já apagou o motivo. */
  motivoJaSaiu: boolean
}

/**
 * Quem mexeu por último numa ausência: cancelar vem depois de encerrar, que vem
 * depois de registrar. Serve para a bolinha não acender por mudança que a
 * própria gestora fez.
 */
export function quemMexeuPorUltimo(ausencia: {
  registradoPor: string
  encerradoPor: string | null
  canceladoPor: string | null
}): string {
  return ausencia.canceladoPor ?? ausencia.encerradoPor ?? ausencia.registradoPor
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
  /**
   * Uma chave por linha do aviso: `fora:<id>`, `volta:<id>`, `sai:<id>`, e
   * `limpeza:falhou`. É com elas que o sistema sabe o que a gestora já viu e o
   * que mudou depois — sem guardar nome nem motivo em lugar nenhum.
   */
  chaves: string[]
}

export type ListaDoAviso = 'fora' | 'volta' | 'sai' | 'limpeza'

const CHAVE_DA_LIMPEZA_QUE_FALHOU = 'limpeza:falhou'

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

  const fora = valendo
    .filter((ausencia) => ausencia.inicio <= hoje && (ausencia.fim === null || ausencia.fim >= hoje))
    .sort(porNome)

  const voltando = valendo
    .flatMap((ausencia): { ausencia: AusenciaParaAviso; quando: 'hoje' | 'amanha' }[] => {
      if (ausencia.fim === null) return []
      const diaDaVolta = deslocarDias(ausencia.fim, 1)
      if (diaDaVolta === hoje) return [{ ausencia, quando: 'hoje' }]
      if (diaDaVolta === amanha) return [{ ausencia, quando: 'amanha' }]
      return []
    })
    .sort((a, b) => porNome(a.ausencia, b.ausencia))

  const saindo = ausencias
    // Férias sem observação não têm motivo a perder: avisar seria ruído.
    .filter((ausencia) => !ausencia.motivoJaSaiu && (ausencia.tipo !== 'ferias' || ausencia.temObservacao))
    .flatMap((ausencia) => {
      const dia = diaEmQueOMotivoVence(
        { fim: ausencia.fim, canceladoNoDia: ausencia.canceladoNoDia },
        prazoEmDias,
      )
      if (dia === null || dia > ultimoDiaOlhado) return []
      return [{ ausencia, dia }]
    })
    .sort((a, b) => (a.dia === b.dia ? porNome(a.ausencia, b.ausencia) : a.dia < b.dia ? -1 : 1))

  const foraHoje = fora.map((ausencia) => ({
    nome: ausencia.nome,
    tipo: ausencia.tipo,
    volta: ausencia.fim === null ? null : deslocarDias(ausencia.fim, 1),
  }))
  const voltam = voltando.map(({ ausencia, quando }) => ({ nome: ausencia.nome, quando }))
  const motivosQueSaem = saindo.map(({ ausencia, dia }) => ({
    nome: ausencia.nome,
    tipo: ausencia.tipo,
    dia,
    atrasado: dia <= hoje,
    cancelada: ausencia.canceladoNoDia !== null,
  }))

  const chaves = [
    ...fora.map((ausencia) => `fora:${ausencia.id}`),
    ...voltando.map(({ ausencia }) => `volta:${ausencia.id}`),
    ...saindo.map(({ ausencia }) => `sai:${ausencia.id}`),
    ...(limpeza === 'falhou' ? [CHAVE_DA_LIMPEZA_QUE_FALHOU] : []),
  ]

  return {
    hoje,
    foraHoje,
    voltam,
    motivosQueSaem,
    limpeza,
    vazio:
      foraHoje.length === 0 && voltam.length === 0 && motivosQueSaem.length === 0 && limpeza !== 'falhou',
    chaves,
  }
}

// ─── O que mudou desde a última vez que a gestora olhou (`A39(e)`) ───────────

export interface MudancaNoAviso {
  lista: ListaDoAviso
  /** Vazio para a linha da limpeza, que não é de pessoa. */
  nome: string
}

export interface Novidades {
  entraram: MudancaNoAviso[]
  sairam: MudancaNoAviso[]
}

/** O aviso como chega à tela: o do dia, mais o que mudou desde a última olhada. */
export interface AvisoParaATela extends AvisoDoGestor {
  /** Ela ainda não viu o aviso hoje. É o que faz o quadro abrir sozinho. */
  primeiraVezHoje: boolean
  novidades: Novidades
}

export interface VistoPelaGestora {
  data: string
  chaves: readonly string[]
}

export function lerChaveDoAviso(chave: string): { lista: ListaDoAviso; afastamentoId: string | null } | null {
  if (chave === CHAVE_DA_LIMPEZA_QUE_FALHOU) return { lista: 'limpeza', afastamentoId: null }
  const [lista, afastamentoId, ...resto] = chave.split(':')
  if (resto.length > 0 || !afastamentoId) return null
  if (lista !== 'fora' && lista !== 'volta' && lista !== 'sai') return null
  return { lista, afastamentoId }
}

/**
 * As chaves que a gestora viu hoje e que não estão mais no aviso.
 *
 * Só compara dentro do MESMO dia. De um dia para o outro, todo o aviso muda
 * sozinho (quem voltou ontem não volta mais "hoje"), e anunciar isso como
 * "saiu" seria dizer, toda manhã, que metade da lista saiu.
 */
export function chavesQueSairam(atuais: readonly string[], visto: VistoPelaGestora | null, hoje: string): string[] {
  if (visto === null || visto.data !== hoje) return []
  const agora = new Set(atuais)
  return visto.chaves.filter((chave) => !agora.has(chave))
}

const ORDEM_DAS_LISTAS: Readonly<Record<ListaDoAviso, number>> = { limpeza: 0, fora: 1, volta: 2, sai: 3 }

function paraMudancas(chaves: readonly string[], nomePorAfastamento: ReadonlyMap<string, string>): MudancaNoAviso[] {
  return chaves
    .flatMap((chave) => {
      const lida = lerChaveDoAviso(chave)
      if (lida === null) return []
      const nome = lida.afastamentoId === null ? '' : (nomePorAfastamento.get(lida.afastamentoId) ?? '')
      return [{ lista: lida.lista, nome }]
    })
    .sort((a, b) => ORDEM_DAS_LISTAS[a.lista] - ORDEM_DAS_LISTAS[b.lista] || a.nome.localeCompare(b.nome, 'pt-BR'))
}

/**
 * Compara o aviso de agora com o que a gestora já viu.
 *
 * O dono pediu (12/09/2026) que uma TROCA não passe calada: se Bianca saiu da
 * lista e Elias entrou no mesmo dia, o aviso diz as duas coisas, com nome. Por
 * isso a comparação é por chave, e não por quantidade — contar "2 fora" antes e
 * "2 fora" depois não enxergaria a troca.
 */
export function compararComOVisto(entrada: {
  hoje: string
  chaves: readonly string[]
  visto: VistoPelaGestora | null
  nomePorAfastamento: ReadonlyMap<string, string>
  /** Id da gestora que está olhando. */
  quemOlha: string
  /** Quem mexeu por último em cada ausência — ver `quemMexeuPorUltimo`. */
  autorPorAfastamento: ReadonlyMap<string, string>
}): { primeiraVezHoje: boolean; novidades: Novidades } {
  const { hoje, chaves, visto, nomePorAfastamento, quemOlha, autorPorAfastamento } = entrada

  if (visto === null || visto.data !== hoje) {
    return { primeiraVezHoje: true, novidades: { entraram: [], sairam: [] } }
  }

  // A gestora é quem mais registra, encerra e cancela ausências. Sem este
  // filtro, cada ação dela acenderia a própria bolinha para contar o que ela
  // acabou de fazer — e a bolinha ficaria acesa quase o tempo todo, que é o
  // jeito de ela deixar de ser notada. O dono levantou isso em 12/09/2026.
  const outraPessoaFez = (chave: string): boolean => {
    const afastamentoId = lerChaveDoAviso(chave)?.afastamentoId
    return afastamentoId == null || autorPorAfastamento.get(afastamentoId) !== quemOlha
  }

  const vistas = new Set(visto.chaves)
  return {
    primeiraVezHoje: false,
    novidades: {
      entraram: paraMudancas(
        chaves.filter((chave) => !vistas.has(chave) && outraPessoaFez(chave)),
        nomePorAfastamento,
      ),
      sairam: paraMudancas(chavesQueSairam(chaves, visto, hoje).filter(outraPessoaFez), nomePorAfastamento),
    },
  }
}
