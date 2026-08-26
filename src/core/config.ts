import type { Categoria } from './tipos'

/**
 * Defaults do protótipo.
 *
 * Nada aqui é hardcoded no motor — estes valores vão para a tabela
 * `RegraDistribuicao` com vigência e viram editáveis pelo operador sem deploy.
 * Este arquivo é só a semente.
 */

/** Ver DECISOES.md § AT-01 e § C1 (o off-by-one corrigido). */
export const LIMIAR_INDIVISIVEL_PADRAO = 3

/** Ver DECISOES.md § AT-02. Campo modelado, valor pendente do cliente. */
export const PESO_PADRAO = 1

/** Abaixo disto, o item vai para a fila de Revisão humana. Por categoria. */
export const LIMIAR_CONFIANCA_PADRAO = 0.85

type DefinicaoCategoria = Pick<Categoria, 'codigo' | 'rotulo' | 'grupo'> &
  Partial<Pick<Categoria, 'divisivel' | 'peso' | 'limiarIndivisivel' | 'entraNoRateio'>>

/**
 * As 6 categorias da frente CADASTRO, na ordem fixa dos blocos da planilha.
 * Mapeamento com as colunas de entrada do arquivo original:
 *   B → DOC_CADASTRO      F → LIGA
 *   C → FICHA_CADASTRO    G → LIGANTE
 *   D → EMAIL_CADASTRO    H → EMAIL_LIGA
 *
 * `grupo` preserva a separação que `E=SUM(B:D)` e `I=SUM(F:H)` revelam.
 */
const DEFINICOES: readonly DefinicaoCategoria[] = [
  { codigo: 'DOC_CADASTRO', rotulo: 'Doc. Cadastro', grupo: 'ASSOCIADO' },
  { codigo: 'FICHA_CADASTRO', rotulo: 'Atualização Cadastro (Ficha)', grupo: 'ASSOCIADO' },
  { codigo: 'EMAIL_CADASTRO', rotulo: 'E-mail Cadastro', grupo: 'ASSOCIADO' },
  { codigo: 'LIGA', rotulo: 'Liga', grupo: 'LIGA' },
  { codigo: 'LIGANTE', rotulo: 'Ligante', grupo: 'LIGA' },
  { codigo: 'EMAIL_LIGA', rotulo: 'E-mail Liga', grupo: 'LIGA' },
  // Exceções: recebem valor, mas fora do rateio diário (RN-15, DECISOES.md § AT-03).
  { codigo: 'INADIMP', rotulo: 'Inadimplente', grupo: 'ASSOCIADO', entraNoRateio: false },
  { codigo: 'ISENTO', rotulo: 'Isento', grupo: 'ASSOCIADO', entraNoRateio: false },
]

export const CATEGORIAS_CADASTRO: readonly Categoria[] = DEFINICOES.map((definicao) => ({
  id: definicao.codigo,
  codigo: definicao.codigo,
  rotulo: definicao.rotulo,
  frente: 'CADASTRO',
  grupo: definicao.grupo,
  divisivel: definicao.divisivel ?? true,
  peso: definicao.peso ?? PESO_PADRAO,
  limiarIndivisivel: definicao.limiarIndivisivel ?? LIMIAR_INDIVISIVEL_PADRAO,
  entraNoRateio: definicao.entraNoRateio ?? true,
}))

export function categoriaPorCodigo(codigo: string): Categoria {
  const encontrada = CATEGORIAS_CADASTRO.find((categoria) => categoria.codigo === codigo)
  if (!encontrada) throw new Error(`Categoria desconhecida: ${codigo}`)
  return encontrada
}
