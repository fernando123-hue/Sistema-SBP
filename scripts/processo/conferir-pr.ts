/**
 * Portão do processo, rodado pelo CI em cada pull request (`.github/workflows/processo.yml`).
 *
 *   BASE_SHA=… HEAD_SHA=… REPOSITORIO=dono/repo NUMERO_DO_PR=N CORPO_DO_PR="…" \
 *   GITHUB_TOKEN=… npx tsx scripts/processo/conferir-pr.ts
 *
 * Calcula o nível de risco pelos arquivos alterados e falha se o corpo do PR
 * não traz a evidência que esse nível exige. Regra em `docs/PROCESSO.md`.
 *
 * O corpo do PR chega por variável de ambiente, NUNCA interpolado no comando
 * do workflow: texto de PR é entrada de quem abriu o PR, e `${{ … }}` dentro
 * de `run:` vira injeção de comando no executor do CI.
 */

import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

import {
  conferirComentarios,
  evidenciasFaltando,
  NOME_DO_NIVEL,
  nivelDaMudanca,
  type PullRequest,
} from './nivel-de-risco'

function exigir(nome: string): string {
  const valor = process.env[nome]
  if (!valor) throw new Error(`${nome} não definida — o workflow precisa passá-la`)
  return valor
}

const SHA = /^[0-9a-f]{7,40}$/

const base = exigir('BASE_SHA')
const head = exigir('HEAD_SHA')
if (!SHA.test(base) || !SHA.test(head)) throw new Error('BASE_SHA e HEAD_SHA precisam ser hashes de commit')
const pr: PullRequest = { repositorio: exigir('REPOSITORIO'), numero: Number(exigir('NUMERO_DO_PR')) }
const token = exigir('GITHUB_TOKEN')
// Corpo vazio é permitido aqui: quem decide se falta evidência é a regra.
const corpo = process.env['CORPO_DO_PR'] ?? ''

// `--no-renames`: um arquivo renomeado aparece com o nome velho E o novo, para
// que mover `src/servidor/x.ts` para `docs/x.md` não pareça só documentação.
const arquivos = execFileSync('git', ['diff', '--name-only', '--no-renames', `${base}...${head}`], { encoding: 'utf8' })
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)

const { nivel, porArquivo } = nivelDaMudanca(arquivos)
const faltando = evidenciasFaltando(nivel, pr, corpo)

// O formato do link não prova que o comentário existe: confere na API que
// cada comentário citado existe e pertence a ESTE PR.
faltando.push(
  ...(await conferirComentarios(pr, corpo, (caminho) =>
    fetch(`https://api.github.com/${caminho}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
    }),
  )),
)

// `|` num nome de arquivo quebraria a tabela do resumo.
const celula = (texto: string): string => texto.replace(/\|/g, '\\|')

const linhas = [
  `## Processo: nível ${nivel} — ${NOME_DO_NIVEL[nivel]}`,
  '',
  '| Arquivo | Nível | Por quê |',
  '|---|---|---|',
  ...porArquivo
    .slice()
    .sort((a, b) => b.nivel - a.nivel)
    .map((a) => `| \`${celula(a.arquivo)}\` | ${a.nivel} | ${a.motivo} |`),
  '',
  faltando.length === 0
    ? '**Evidência completa para este nível.**'
    : ['**Falta evidência no corpo do PR:**', ...faltando.map((f) => `- ${f}`)].join('\n'),
]
const relatorio = linhas.join('\n')

console.log(relatorio)
const resumo = process.env['GITHUB_STEP_SUMMARY']
if (resumo) appendFileSync(resumo, relatorio + '\n')

if (faltando.length > 0) process.exit(1)
