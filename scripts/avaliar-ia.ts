/**
 * Nota automática do adapter de IA contra o gabarito sintético.
 *
 * Onde `ia:experimentar` mostra as saídas para alguém ler, este script dá um
 * NÚMERO: a mesma bateria fixa (`src/core/avaliacao/casos.ts`), a resposta
 * esperada escrita antes, e a nota por caso e por dimensão. É com ele que se
 * compara fornecedor com fornecedor, prompt com prompt, e o modelo local que
 * ainda vai chegar (`A56`) com os outros.
 *
 *   npm run ia:avaliar                          # o IA_ADAPTER do .env
 *   IA_ADAPTER=mock   npm run ia:avaliar        # linha de base, sem rede
 *   IA_ADAPTER=gemini npm run ia:avaliar        # camada gratuita
 *   npm run ia:avaliar -- --json                # uma linha JSON, para guardar
 *
 * Chama a API real quando o adapter não é o mock — nenhum teste automático
 * faz isso. A saída tem só identificadores de caso e números: nenhum texto de
 * e-mail, nenhum campo extraído.
 */

import { criarAiPort } from '../src/adapters/fabrica'
import { DIMENSOES } from '../src/core/avaliacao/gabarito'
import { ambiente } from '../src/servidor/ambiente'
import { mandarTodoLogAoStderr } from '../src/servidor/observabilidade'
import { avaliarInterpretacao, type ResultadoDaAvaliacao } from '../src/servicos/avaliacao-da-ia'

function linha(texto = ''): void {
  process.stdout.write(`${texto}\n`)
}

function numero(valor: number | null): string {
  return valor === null ? '   —' : valor.toFixed(2)
}

function imprimir(resultado: ResultadoDaAvaliacao): void {
  const { resumo } = resultado
  linha('='.repeat(74))
  linha(`AVALIAÇÃO DA IA — ${resumo.versaoDoGabarito}`)
  linha(`adapter: ${resultado.adapter}  ·  modelo: ${resultado.modelos.join(', ') || '(nenhuma resposta)'}`)
  linha(`prompt: ${resultado.versoesPrompt.join(', ') || '—'}`)
  linha('='.repeat(74))
  linha(`${'caso'.padEnd(28)} qtd  cat  camp lit  susp  NOTA`)
  for (const nota of resultado.notas) {
    const colunas = [nota.quantidade, nota.categorias, nota.campos, nota.literalidade, nota.suspeita]
      .map(numero)
      .join(' ')
    linha(`${nota.id.padEnd(28)} ${colunas}  ${numero(nota.nota)}${nota.falhou ? `  FALHOU: ${(nota.motivo ?? '').slice(0, 60)}` : ''}`)
  }
  linha('─'.repeat(74))
  linha(`por dimensão: ${DIMENSOES.map((dimensao) => `${dimensao} ${numero(resumo.porDimensao[dimensao])}`).join(' · ')}`)
  linha(`falhas: ${resumo.falhas} de ${resumo.casos}`)
  linha(`NOTA GERAL: ${numero(resumo.nota)}  (só as respondidas: ${numero(resumo.notaDasRespondidas)})`)
  if (resumo.falhas > 0) {
    // Falha costuma ser o fornecedor (503, tempo esgotado), não a leitura.
    // Comparar esta nota com a de outra rodada misturaria as duas coisas.
    linha(`ATENÇÃO: ${resumo.falhas} caso(s) sem resposta — a nota geral não é comparável; rode de novo.`)
  }
}

async function principal(): Promise<void> {
  const emJson = process.argv.includes('--json')
  // A única linha do stdout é a que se guarda: log de adapter vai ao stderr.
  if (emJson) mandarTodoLogAoStderr()
  const configurado = ambiente().IA_ADAPTER
  if (configurado !== 'mock') {
    // Em `stderr` para valer também no `--json`, cuja única linha em `stdout`
    // é a que se guarda (revisão de segurança do PR #73).
    process.stderr.write(
      `Rodando contra a API REAL de "${configurado}".${configurado === 'anthropic' ? ' Isto gasta crédito.' : ''}\n`,
    )
  }

  const resultado = await avaliarInterpretacao(criarAiPort())

  if (emJson) {
    linha(
      JSON.stringify({
        quando: new Date().toISOString(),
        adapter: resultado.adapter,
        modelos: resultado.modelos,
        versoesPrompt: resultado.versoesPrompt,
        ...resultado.resumo,
        notas: resultado.notas,
      }),
    )
  } else {
    imprimir(resultado)
  }
}

principal().catch((erro: unknown) => {
  process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`)
  process.exitCode = 1
})
