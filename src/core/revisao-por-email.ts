import { CAMPO_DA_LIGA } from './conferencia-da-extracao'
import { MOTIVOS_DECIDIDOS_POR_EMAIL } from './esquemas'
import { chaveDaLiga } from './ligas'

/**
 * Esta revisão pode ser decidida no cartão do e-mail (`A69`, 1A)?
 *
 * ═══ POR QUE NÃO BASTA O MOTIVO ═══
 *
 * A ingestão grava UM motivo por revisão, e numa lista o motivo é sempre
 * `desdobramento` (`decidirRevisao`): o CPF que não fecha, o valor que não
 * está no texto e a conferência interrompida ficam só no `campoIncerto`
 * (revisão de segurança do #167). Decidir pelo motivo aprovaria em lote, com
 * dois toques, um CPF que o remetente pôs no e-mail para enganar a leitura.
 *
 * Então fica de fora do cartão, além do motivo de alerta e do e-mail suspeito:
 *
 * - campo apontado que TEM valor na sugestão — é o "confira: cpf" da tela, um
 *   valor que o código viu não bater com o e-mail;
 * - a liga citada apontada, ou liga citada que ficou de fora do item.
 *
 * Campo apontado SEM valor é o que faltou ("falta: crm"): esse cabe no
 * cartão, que o mostra na linha.
 *
 * Na dúvida, fora: sugestão ilegível não entra no cartão. Usada pela tela e,
 * de novo, pelo servidor — a tela sozinha não é trava.
 */
export function decidivelNoCartao(revisao: {
  motivo: string
  campoIncerto: string | null
  sugestaoIa: string
  semLiga: boolean
  emailSuspeito: boolean
}): boolean {
  if (revisao.emailSuspeito) return false
  if (!(MOTIVOS_DECIDIDOS_POR_EMAIL as readonly string[]).includes(revisao.motivo)) return false

  const sugestao = lerParaDecidir(revisao.sugestaoIa)
  if (sugestao === null) return false
  if (revisao.semLiga && chaveDaLiga(sugestao.ligaMencionada) !== null) return false
  if (revisao.campoIncerto === null) return true
  if (revisao.campoIncerto === CAMPO_DA_LIGA) return false
  const valor = Object.hasOwn(sugestao.campos, revisao.campoIncerto) ? sugestao.campos[revisao.campoIncerto] : undefined
  return typeof valor !== 'string' || valor.trim() === ''
}

function lerParaDecidir(texto: string): { campos: Record<string, unknown>; ligaMencionada: string | null } | null {
  let bruto: unknown
  try {
    bruto = JSON.parse(texto)
  } catch {
    return null
  }
  if (bruto === null || typeof bruto !== 'object') return null
  const { campos, ligaMencionada } = bruto as { campos?: unknown; ligaMencionada?: unknown }
  if (campos === null || typeof campos !== 'object' || Array.isArray(campos)) return null
  return {
    campos: campos as Record<string, unknown>,
    ligaMencionada: typeof ligaMencionada === 'string' ? ligaMencionada : null,
  }
}
