/**
 * Nota automática do CLASSIFICADOR contra o gabarito sintético (`A70`, P2).
 *
 * O par de `ia:avaliar`, para a segunda opinião: as mesmas perguntas fechadas
 * da ingestão e a nova de quantidade ("nenhum, um ou vários pedidos?"), nos
 * mesmos casos, com a resposta certa escrita antes. É o número que diz se o
 * classificador local empata com o Jev — e quanto tempo ele leva por e-mail.
 *
 *   CLASSIFICADOR_ADAPTER=mock  npm run classificador:avaliar   # linha de base, sem rede
 *   CLASSIFICADOR_ADAPTER=local IA_LOCAL_URL=http://127.0.0.1:11434/v1 \
 *     CLASSIFICADOR_MODELO=qwen2.5:1.5b npm run classificador:avaliar
 *   npm run classificador:avaliar -- --json                     # uma linha JSON, para guardar
 *
 * A saída tem só identificadores de caso e números: nenhum texto de e-mail.
 */

import { criarClassificadorPort } from '../src/adapters/fabrica'
import { PERGUNTAS_AVALIADAS, type NotaDaPergunta } from '../src/core/avaliacao/classificacao'
import { ambiente } from '../src/servidor/ambiente'
import { mandarTodoLogAoStderr } from '../src/servidor/observabilidade'
import { encerrarBanco } from '../src/servidor/prisma'
import {
  avaliarClassificador,
  type ResultadoDaAvaliacaoDoClassificador,
} from '../src/servicos/avaliacao-do-classificador'

function linha(texto = ''): void {
  process.stdout.write(`${texto}\n`)
}

function numero(valor: number | null): string {
  return valor === null ? '   —' : valor.toFixed(2)
}

function celula(nota: NotaDaPergunta | null): string {
  if (!nota) return '      —     '
  return `${nota.acerto ? 'ok ' : 'ERR'} ${nota.escolhida.slice(0, 4).padEnd(4)} ${numero(nota.probabilidadeDaCerta)}`
}

function imprimir(resultado: ResultadoDaAvaliacaoDoClassificador): void {
  const { resumo } = resultado
  linha('='.repeat(86))
  linha(`AVALIAÇÃO DO CLASSIFICADOR — ${resumo.versao}`)
  linha(`fornecedor: ${resultado.fornecedor}  ·  modelo: ${resultado.modelos.join(', ') || '(nenhuma resposta)'}`)
  linha(`perguntas: ${resultado.versaoDasPerguntas}`)
  linha('='.repeat(86))
  linha(`${'caso'.padEnd(26)} ${'quantidade'.padEnd(13)} ${'categoria'.padEnd(13)} ${'suspeita'.padEnd(13)} tempo`)
  for (const nota of resultado.notas) {
    const tempo = `${(nota.tempoMs / 1000).toFixed(1)}s`
    if (nota.falhou) {
      linha(`${nota.id.padEnd(26)} FALHOU: ${(nota.motivo ?? '').slice(0, 40)}  ${tempo}`)
      continue
    }
    linha(`${nota.id.padEnd(26)} ${celula(nota.quantidade)}  ${celula(nota.categoria)}  ${celula(nota.suspeita)}  ${tempo}`)
  }
  linha('─'.repeat(86))
  for (const pergunta of PERGUNTAS_AVALIADAS) {
    const p = resumo.porPergunta[pergunta]
    linha(`${pergunta.padEnd(12)} acerto ${numero(p.acerto)}  ·  probabilidade da certa ${numero(p.probabilidadeDaCerta)}  (${p.casos} casos)`)
  }
  const segundos = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`)
  linha(`tempo por e-mail: médio ${segundos(resumo.tempoMedioMs)}  ·  pior ${segundos(resumo.tempoMaximoMs)}`)
  linha(`falhas: ${resumo.falhas} de ${resumo.casos}`)
  if (resumo.falhas > 0) {
    linha(`ATENÇÃO: ${resumo.falhas} caso(s) sem resposta — a nota não é comparável; veja o motivo e rode de novo.`)
  }
}

async function principal(): Promise<void> {
  const emJson = process.argv.includes('--json')
  // A única linha do stdout é a que se guarda: log de adapter vai ao stderr.
  if (emJson) mandarTodoLogAoStderr()

  const porta = criarClassificadorPort()
  if (!porta) {
    throw new Error('CLASSIFICADOR_ADAPTER="nenhum": não há classificador para avaliar. Use "mock" ou "local".')
  }
  if (ambiente().CLASSIFICADOR_ADAPTER !== 'mock') {
    process.stderr.write(`Rodando contra o classificador REAL "${porta.fornecedor}".\n`)
  }

  const resultado = await avaliarClassificador(porta)

  if (emJson) {
    linha(
      JSON.stringify({
        quando: new Date().toISOString(),
        fornecedor: resultado.fornecedor,
        modelos: resultado.modelos,
        versaoDasPerguntas: resultado.versaoDasPerguntas,
        ...resultado.resumo,
        notas: resultado.notas,
      }),
    )
  } else {
    imprimir(resultado)
  }
}

principal()
  .catch((erro: unknown) => {
    process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`)
    process.exitCode = 1
  })
  .finally(encerrarBanco)
