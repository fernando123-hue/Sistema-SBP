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

export interface PullRequest {
  /** `dono/repositorio`, como em `github.repository`. */
  readonly repositorio: string
  readonly numero: number
}

export type TipoDeComentario = 'issuecomment' | 'pullrequestreview'

const NOME_DE_REPOSITORIO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

// O link precisa ser DESTE repositório e DESTE PR: aceitar qualquer
// `…/pull/N#issuecomment-…` deixava passar a revisão de outro PR, reciclada
// (achado da revisão de segurança do PR #55).
function linkDoPr(pr: PullRequest): RegExp {
  if (!NOME_DE_REPOSITORIO.test(pr.repositorio) || !Number.isInteger(pr.numero) || pr.numero < 1) {
    throw new Error(`pull request inválido: ${pr.repositorio}#${pr.numero}`)
  }
  const repo = pr.repositorio.replace(/\./g, '\\.')
  return new RegExp(`https://github\\.com/${repo}/pull/${pr.numero}#(issuecomment|pullrequestreview)-(\\d+)\\b`, 'g')
}

/**
 * Chave de comparação de um título: sem emoji, pontuação nem espaço a mais.
 * Quem preenche o PR decora o título (`### 🔍 Revisão técnica:`) e a
 * evidência não pode sumir por isso (revisão técnica do PR #55).
 */
function chaveDoTitulo(titulo: string): string {
  return titulo
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const TITULO = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/
const CERCA = /^ {0,3}(```|~~~)/

/** Seções do corpo por título, com o texto já sem comentários e sem caixas desmarcadas. */
export function secoesDoCorpo(corpo: string | null): Map<string, string> {
  const secoes = new Map<string, string>()
  if (!corpo) return secoes
  const semComentario = corpo.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '')
  let atual: string | null = null
  let linhas: string[] = []
  let cerca: string | null = null
  const fechar = () => {
    if (atual !== null) secoes.set(atual, linhas.join('\n').trim())
  }
  for (const linha of semComentario.split('\n')) {
    // Dentro de bloco de código, `# comentário` é texto, não título: sem isso
    // a saída colada de um comando cortava a seção no meio (revisão do PR #55).
    const abreOuFecha = CERCA.exec(linha)
    if (abreOuFecha) {
      const marca = abreOuFecha[1] ?? ''
      if (cerca === null) cerca = marca
      else if (cerca === marca) cerca = null
    } else if (cerca === null) {
      // Título de QUALQUER nível encerra a seção. Só com `###`, o
      // `## Segurança` do modelo virava conteúdo da `### Regressão`.
      const titulo = TITULO.exec(linha)
      if (titulo) {
        fechar()
        atual = chaveDoTitulo(titulo[1] ?? '')
        linhas = []
        continue
      }
      if (/^\s*[-*]\s+\[ \]/.test(linha)) continue
    }
    linhas.push(linha)
  }
  fechar()
  return secoes
}

const TAMANHO_MINIMO = 10

export function evidenciasFaltando(nivel: Nivel, pr: PullRequest, corpo: string | null): string[] {
  const secoes = secoesDoCorpo(corpo)
  const faltando: string[] = []
  for (const e of EVIDENCIAS) {
    if (nivel < e.aPartirDe) continue
    const texto = secoes.get(chaveDoTitulo(e.titulo)) ?? ''
    if (texto.length < TAMANHO_MINIMO) {
      faltando.push(`${e.titulo}: seção ausente ou vazia`)
    } else if (e.exigeLinkDeRevisao && !linkDoPr(pr).test(texto)) {
      faltando.push(
        `${e.titulo}: falta o link do comentário publicado neste PR (https://github.com/${pr.repositorio}/pull/${pr.numero}#issuecomment-…)`,
      )
    }
  }
  return faltando
}

/** Comentários deste PR citados nas seções de revisão — o CI confere cada um na API. */
export function comentariosCitados(pr: PullRequest, corpo: string | null): { tipo: TipoDeComentario; id: number }[] {
  const secoes = secoesDoCorpo(corpo)
  const vistos = new Map<string, { tipo: TipoDeComentario; id: number }>()
  for (const e of EVIDENCIAS) {
    if (!e.exigeLinkDeRevisao) continue
    for (const m of (secoes.get(chaveDoTitulo(e.titulo)) ?? '').matchAll(linkDoPr(pr))) {
      const tipo = m[1] as TipoDeComentario
      const id = Number(m[2])
      vistos.set(`${tipo}-${id}`, { tipo, id })
    }
  }
  return [...vistos.values()]
}

/** Uma chamada GET à API do GitHub; `caminho` sem a barra inicial. */
export type BuscarNaApi = (caminho: string) => Promise<{ status: number; json: () => Promise<unknown> }>

/**
 * Confere na API que cada comentário citado existe e é deste PR.
 *
 * Nunca lança: falha da API vira pendência com o motivo, para o relatório
 * sair mesmo assim e o job ficar vermelho pela razão certa — antes, um 401 ou
 * 503 derrubava o script sem relatório nenhum (revisão técnica do PR #55).
 */
export async function conferirComentarios(pr: PullRequest, corpo: string | null, buscar: BuscarNaApi): Promise<string[]> {
  const pendencias: string[] = []
  for (const c of comentariosCitados(pr, corpo)) {
    const nome = `${c.tipo}-${c.id}`
    const caminho =
      c.tipo === 'issuecomment'
        ? `repos/${pr.repositorio}/issues/comments/${c.id}`
        : `repos/${pr.repositorio}/pulls/${pr.numero}/reviews/${c.id}`
    try {
      const resposta = await buscar(caminho)
      if (resposta.status === 404) {
        pendencias.push(`o comentário ${nome} citado não existe neste PR`)
        continue
      }
      if (resposta.status !== 200) {
        pendencias.push(`não foi possível conferir o comentário ${nome} (API do GitHub respondeu ${resposta.status}) — rode o job de novo`)
        continue
      }
      // A revisão é buscada pelo caminho do próprio PR: existir já basta.
      if (c.tipo === 'pullrequestreview') continue
      const dados = await resposta.json()
      const url = typeof dados === 'object' && dados !== null ? (dados as { issue_url?: unknown }).issue_url : undefined
      if (typeof url !== 'string' || !url.endsWith(`/issues/${pr.numero}`)) {
        pendencias.push(`o comentário ${nome} citado não existe neste PR`)
      }
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro)
      pendencias.push(`não foi possível conferir o comentário ${nome} (${motivo}) — rode o job de novo`)
    }
  }
  return pendencias
}
