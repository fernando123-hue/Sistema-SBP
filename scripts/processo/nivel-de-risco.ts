/**
 * Nível de risco de uma mudança e a evidência que ela precisa apresentar.
 *
 * É a parte determinística do processo descrito em `docs/PROCESSO.md`: quem
 * decide a profundidade da verificação é esta tabela, não a opinião de quem
 * escreveu o código. O agente que implementa não escolhe o próprio nível.
 *
 * O que isto NÃO prova: que a revisão linkada foi feita por outro agente, nem
 * que o texto de cada seção é verdadeiro. Prova que a evidência foi declarada,
 * no lugar certo, com link para o que foi publicado — o resto é a revisão.
 */

export type Nivel = 0 | 1 | 2 | 3

export const NOME_DO_NIVEL: Record<Nivel, string> = {
  0: 'documentação',
  1: 'tela',
  2: 'regra de negócio',
  3: 'sensível',
}

interface Regra {
  readonly nivel: Nivel
  readonly padrao: RegExp
  readonly motivo: string
}

// Ordem importa: a primeira que casar vence, então as sensíveis vêm antes das
// genéricas (`src/core/seguranca/` antes de `src/core/`).
const REGRAS: readonly Regra[] = [
  { nivel: 3, padrao: /^\.github\//, motivo: 'CI, permissões e revisores' },
  { nivel: 3, padrao: /^\.claude\//, motivo: 'comandos que os agentes executam' },
  { nivel: 3, padrao: /^CLAUDE\.md$/, motivo: 'regras que governam os agentes' },
  { nivel: 3, padrao: /^package(-lock)?\.json$/, motivo: 'dependências' },
  { nivel: 3, padrao: /^prisma\//, motivo: 'banco de dados' },
  { nivel: 3, padrao: /^scripts\//, motivo: 'scripts com acesso ao banco, aos anexos ou ao próprio processo' },
  { nivel: 3, padrao: /^(\.env\.example|\.gitignore)$/, motivo: 'segredos e o que entra no Git' },
  { nivel: 3, padrao: /^(next|vitest|prisma|postcss)\.config\.[a-z]+$|^tsconfig\.json$/, motivo: 'configuração que pode desligar proteção ou teste' },
  { nivel: 3, padrao: /^src\/middleware\.ts$/, motivo: 'cabeçalhos e sessão' },
  { nivel: 3, padrao: /^src\/servidor\//, motivo: 'sessão, ambiente, limites e acesso' },
  { nivel: 3, padrao: /^src\/app\/api\//, motivo: 'rota que recebe requisição de fora' },
  { nivel: 3, padrao: /^src\/adapters\//, motivo: 'IA, e-mail, arquivos e banco' },
  { nivel: 3, padrao: /^src\/ports\//, motivo: 'contrato com IA e integrações' },
  { nivel: 3, padrao: /^src\/core\/seguranca\//, motivo: 'defesas contra conteúdo externo' },
  { nivel: 3, padrao: /^src\/core\/assistente\//, motivo: 'o que o assistente pode dizer a cada papel' },
  { nivel: 3, padrao: /^src\/core\/esquemas\.ts$/, motivo: 'validação da entrada' },
  { nivel: 2, padrao: /^src\/core\//, motivo: 'regra de negócio' },
  { nivel: 2, padrao: /^src\/servicos\//, motivo: 'regra de negócio com banco' },
  { nivel: 1, padrao: /^src\/app\//, motivo: 'tela' },
  { nivel: 1, padrao: /^src\/components\//, motivo: 'componente de tela' },
  { nivel: 1, padrao: /^public\//, motivo: 'arquivo estático' },
  { nivel: 0, padrao: /^docs\//, motivo: 'documentação' },
  { nivel: 0, padrao: /\.md$/, motivo: 'documentação' },
]

export function nivelDoArquivo(caminho: string): { nivel: Nivel; motivo: string } {
  const normalizado = caminho.replace(/\\/g, '/')
  const regra = REGRAS.find((r) => r.padrao.test(normalizado))
  if (regra) return { nivel: regra.nivel, motivo: regra.motivo }
  // Falhar fechado: pasta nova sem classificação recebe a verificação mais
  // funda até alguém classificá-la aqui.
  return { nivel: 3, motivo: 'caminho desconhecido — classifique em scripts/processo/nivel-de-risco.ts' }
}

export function nivelDaMudanca(arquivos: readonly string[]): {
  nivel: Nivel
  porArquivo: { arquivo: string; nivel: Nivel; motivo: string }[]
} {
  if (arquivos.length === 0) {
    throw new Error('nenhum arquivo na mudança — a lista de arquivos alterados veio vazia')
  }
  const porArquivo = arquivos.map((arquivo) => ({ arquivo, ...nivelDoArquivo(arquivo) }))
  const nivel = Math.max(...porArquivo.map((a) => a.nivel)) as Nivel
  return { nivel, porArquivo }
}

interface Evidencia {
  readonly titulo: string
  readonly aPartirDe: Nivel
  readonly exigeLinkDeRevisao?: true
}

// Os títulos são os de `.github/pull_request_template.md`.
export const EVIDENCIAS: readonly Evidencia[] = [
  { titulo: 'Especificação', aPartirDe: 0 },
  { titulo: 'Visto rodando', aPartirDe: 1 },
  { titulo: 'Verificação comportamental', aPartirDe: 2 },
  { titulo: 'Teste visto vermelho', aPartirDe: 2 },
  { titulo: 'Revisão técnica', aPartirDe: 2, exigeLinkDeRevisao: true },
  { titulo: 'Revisão de segurança', aPartirDe: 3, exigeLinkDeRevisao: true },
  { titulo: 'Regressão', aPartirDe: 1 },
]

const LINK_DE_COMENTARIO = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+#(issuecomment|pullrequestreview)-\d+/

/** Seções do corpo por título, com o texto já sem comentários e sem caixas desmarcadas. */
export function secoesDoCorpo(corpo: string | null): Map<string, string> {
  const secoes = new Map<string, string>()
  if (!corpo) return secoes
  const semComentario = corpo.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '')
  // Título de QUALQUER nível encerra a seção. Só com `###`, o `## Segurança`
  // do modelo virava conteúdo da `### Regressão` e a preenchia sozinho.
  const partes = semComentario.split(/^#{1,6}[ \t]+(.+)$/m)
  // `split` com grupo devolve [antes, título1, texto1, título2, texto2, ...].
  for (let i = 1; i < partes.length; i += 2) {
    const titulo = (partes[i] ?? '').trim().toLowerCase()
    const texto = (partes[i + 1] ?? '')
      .split('\n')
      .filter((linha) => !/^\s*[-*]\s+\[ \]/.test(linha))
      .join('\n')
      .trim()
    secoes.set(titulo, texto)
  }
  return secoes
}

const TAMANHO_MINIMO = 10

export function evidenciasFaltando(nivel: Nivel, corpo: string | null): string[] {
  const secoes = secoesDoCorpo(corpo)
  const faltando: string[] = []
  for (const e of EVIDENCIAS) {
    if (nivel < e.aPartirDe) continue
    const texto = secoes.get(e.titulo.toLowerCase()) ?? ''
    if (texto.length < TAMANHO_MINIMO) {
      faltando.push(`${e.titulo}: seção ausente ou vazia`)
    } else if (e.exigeLinkDeRevisao && !LINK_DE_COMENTARIO.test(texto)) {
      faltando.push(`${e.titulo}: falta o link do comentário publicado no PR (…/pull/N#issuecomment-…)`)
    }
  }
  return faltando
}
