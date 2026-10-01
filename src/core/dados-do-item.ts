import { textoParaExibir } from './trecho-do-email'

/**
 * Os dados que a IA leu de um item, prontos para a Minha fila copiar (`A69`, 3B).
 *
 * Hoje quem executa volta ao Outlook para copiar CPF e matrícula que o sistema
 * já leu. Aqui eles saem como texto, um por linha, com um rótulo da casa para
 * os campos conhecidos.
 *
 * ═══ POR QUE `textoParaExibir` TAMBÉM NO QUE VAI SER COPIADO ═══
 *
 * O valor vai para a área de transferência e dali para o sistema da
 * associação. Um controle de direção ou um espaço de largura zero colado num
 * CPF viraria, lá, um CPF diferente do que a pessoa viu na tela. Trocado por
 * "�", o defeito fica à vista dos dois lados (mesma regra do #163).
 */

export interface CampoParaCopiar {
  /** O nome do campo como a IA o gravou (vem de fora: é dado, não rótulo). */
  readonly campo: string
  /** O nome que a tela mostra: o da casa, quando o campo é conhecido. */
  readonly rotulo: string
  readonly valor: string
}

/** Os campos que as categorias esperam, na ordem em que se trabalha com eles. */
const CONHECIDOS: readonly (readonly [string, string])[] = [
  ['nome', 'Nome'],
  ['cpf', 'CPF'],
  ['matricula', 'Matrícula'],
  ['crm', 'CRM'],
  ['email', 'E-mail'],
  ['telefone', 'Telefone'],
  ['instituicao', 'Instituição'],
]

const POSICAO = new Map(CONHECIDOS.map(([campo], posicao) => [campo, posicao]))
const ROTULO = new Map(CONHECIDOS)

/**
 * Só chaves PRÓPRIAS com valor texto não vazio: o nome do campo vem da IA, e
 * "toString" num objeto comum acharia a função herdada (2ª rodada do #150).
 */
export function camposParaCopiar(campos: Readonly<Record<string, unknown>>): CampoParaCopiar[] {
  const lidos: CampoParaCopiar[] = []
  for (const campo of Object.keys(campos)) {
    const bruto = campos[campo]
    if (typeof bruto !== 'string') continue
    const valor = bruto.trim()
    if (valor === '') continue
    const conhecido = ROTULO.get(campo.toLowerCase())
    lidos.push({ campo, rotulo: conhecido ?? textoParaExibir(campo), valor: textoParaExibir(valor) })
  }

  // Conhecidos na ordem da casa; o resto depois, em ordem alfabética, para a
  // mesma pessoa achar o mesmo campo no mesmo lugar de um item para outro.
  const ordem = (campo: string) => POSICAO.get(campo.toLowerCase()) ?? CONHECIDOS.length
  return lidos.sort((a, b) => ordem(a.campo) - ordem(b.campo) || a.campo.localeCompare(b.campo, 'pt-BR'))
}
