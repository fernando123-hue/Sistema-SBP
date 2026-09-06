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

/** Base do esforço. Categoria sem peso próprio vale isto. Ver DECISOES.md § A11. */
export const PESO_PADRAO = 1

/**
 * Limiar de confiança base: abaixo disto o item vai para a fila de Revisão.
 *
 * Espelha o `@default(0.85)` de `Categoria.limiarConfianca` no schema, que
 * continua sendo de onde o limiar sai em tempo de execução (`ingestao.ts` lê
 * `categoria.limiarConfianca` do banco). Aqui é **semente**, não fonte da
 * verdade — é o valor com que a linha nasce, e o operador pode mudá-lo depois
 * sem deploy.
 */
export const LIMIAR_CONFIANCA_PADRAO = 0.85

/**
 * `limiarConfianca` de propósito NÃO faz parte do tipo `Categoria` do domínio:
 * ele é o corte **antes** do motor (a fila de revisão), e o motor não tem por
 * que conhecê-lo. Ele vive aqui só como semente, e em `Categoria` no banco.
 */
type DefinicaoCategoria = Pick<Categoria, 'codigo' | 'rotulo' | 'grupo'> &
  Partial<
    Pick<
      Categoria,
      'divisivel' | 'peso' | 'limiarIndivisivel' | 'entraNoRateio' | 'agrupaPorLiga'
    >
  > & {
    limiarConfianca?: number
  }

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
  // DOC e FICHA carregam peso e limiar próprios — decisões A11 e A12 (26/08/2026).
  //
  // A frase do cliente foi uma só: "documento e ficha demandam mais atenção".
  // Ela tem dois lados, e cada um mexe num lugar diferente:
  //
  //   peso            → equilíbrio ENTRE categorias. Quem passa o dia em
  //                     documento pesado não recebe também um monte de
  //                     trabalho leve por cima. Dentro da categoria nada muda:
  //                     documento sempre foi comparado só com documento.
  //   limiarConfianca → quanto a IA precisa estar segura para aprovar sozinha.
  //                     Mais alto = MAIS itens caem na revisão humana.
  //
  // Os dois são configuráveis sem deploy (`RegraDistribuicao` / a própria
  // linha de `Categoria`); estes valores são só a semente.
  { codigo: 'DOC_CADASTRO', rotulo: 'Doc. Cadastro', grupo: 'ASSOCIADO', peso: 4, limiarConfianca: 0.95 },
  {
    codigo: 'FICHA_CADASTRO',
    rotulo: 'Atualização Cadastro (Ficha)',
    grupo: 'ASSOCIADO',
    peso: 1.75,
    limiarConfianca: 0.9,
  },
  { codigo: 'EMAIL_CADASTRO', rotulo: 'E-mail Cadastro', grupo: 'ASSOCIADO' },
  { codigo: 'LIGA', rotulo: 'Liga', grupo: 'LIGA' },
  // A liga e a unidade que nao se separa nestas duas (A4).
  { codigo: 'LIGANTE', rotulo: 'Ligante', grupo: 'LIGA', agrupaPorLiga: true },
  { codigo: 'EMAIL_LIGA', rotulo: 'E-mail Liga', grupo: 'LIGA', agrupaPorLiga: true },
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
  agrupaPorLiga: definicao.agrupaPorLiga ?? false,
}))

const LIMIARES_DE_CONFIANCA = new Map(
  DEFINICOES.map((definicao) => [
    definicao.codigo,
    definicao.limiarConfianca ?? LIMIAR_CONFIANCA_PADRAO,
  ]),
)

/**
 * Limiar de confiança com que uma categoria NASCE.
 *
 * Vive separado de `CATEGORIAS_CADASTRO` porque não é campo de domínio — o
 * motor não conhece limiar de confiança, e o tipo `Categoria` do núcleo não
 * deve carregar campo que ele não usa. Quem chama isto é só quem semeia linha
 * de `Categoria` (o seed e o apoio de teste); em execução o valor sai do banco,
 * onde o operador pode tê-lo ajustado.
 *
 * É função, e não mapa exposto, para que o retorno seja sempre `number`:
 * categoria sem valor próprio nasce no padrão, e não há caminho que devolva
 * `undefined` para dentro de um `create`.
 */
export function limiarConfiancaSemente(codigo: string): number {
  return LIMIARES_DE_CONFIANCA.get(codigo) ?? LIMIAR_CONFIANCA_PADRAO
}
