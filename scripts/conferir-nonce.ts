import { spawn } from 'node:child_process'
import { join } from 'node:path'

import { problemasDoNonce } from './nonce-na-pagina'

/**
 * Entrada do passo "Nonce da CSP nos scripts" do CI — pendência 46. Executa
 * SEMPRE ao ser carregado; a função pura mora em `nonce-na-pagina.ts`.
 *
 * Sobe `next start` sobre o build que já existe, pede `/entrar` (abre sem
 * sessão) e confere que cada `<script>` traz o nonce da CSP da resposta.
 *
 * O servidor é derrubado em QUALQUER saída, pelo `finally`. Por isso a falha é
 * lançada, nunca `process.exit` no meio: o `exit` pularia o `finally` e
 * deixaria um `next start` vivo segurando a porta.
 */

const PORTA = process.env['PORTA_DA_CONFERENCIA'] ?? '3999'
const ENDERECO = `http://127.0.0.1:${PORTA}/entrar`
const PRAZO_PARA_SUBIR_MS = 60_000
const INTERVALO_MS = 500

class ConferenciaFalhou extends Error {}

async function pedirQuandoSubir(estado: { encerrou: number | null }): Promise<Response> {
  const limite = Date.now() + PRAZO_PARA_SUBIR_MS
  for (;;) {
    // Encerrou sozinho: a configuração recusou a partida (`AT-65`), por exemplo.
    if (estado.encerrou !== null) {
      throw new ConferenciaFalhou(`O next start encerrou com código ${estado.encerrou} antes de responder.`)
    }
    try {
      return await fetch(ENDERECO, { redirect: 'manual' })
    } catch (erro) {
      // Conexão recusada: ainda subindo. Depois do prazo, falha com a causa.
      if (Date.now() > limite) {
        throw new ConferenciaFalhou(`${ENDERECO} não respondeu em ${PRAZO_PARA_SUBIR_MS / 1000} s: ${String(erro)}`)
      }
      await new Promise((resolver) => setTimeout(resolver, INTERVALO_MS))
    }
  }
}

async function principal(): Promise<void> {
  const next = join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next')
  const servidor = spawn(process.execPath, [next, 'start', '-p', PORTA, '-H', '127.0.0.1'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let saida = ''
  servidor.stdout.on('data', (pedaco: Buffer) => (saida += pedaco.toString()))
  servidor.stderr.on('data', (pedaco: Buffer) => (saida += pedaco.toString()))
  const estado: { encerrou: number | null } = { encerrou: null }
  servidor.on('exit', (codigo) => (estado.encerrou = codigo ?? -1))

  try {
    const resposta = await pedirQuandoSubir(estado)
    if (resposta.status !== 200) throw new ConferenciaFalhou(`${ENDERECO} respondeu ${resposta.status}, não 200.`)
    const problemas = problemasDoNonce(resposta.headers.get('content-security-policy'), await resposta.text())
    if (problemas.length > 0) {
      throw new ConferenciaFalhou('O nonce da CSP NÃO chega aos scripts:\n' + problemas.map((p) => `- ${p}`).join('\n'))
    }
    console.log(`Nonce da CSP em todos os scripts de ${ENDERECO}.`)
  } catch (erro) {
    console.error(erro instanceof ConferenciaFalhou ? erro.message : erro)
    if (saida.trim() !== '') console.error(`--- saída do next start ---\n${saida.slice(-4000)}`)
    process.exitCode = 1
  } finally {
    servidor.kill()
  }
}

void principal()
