import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'

import { nonceDoCabecalho, problemasDoNonce, recusaDoAmbiente } from './nonce-na-pagina'

/**
 * Entrada do passo "Nonce da CSP nos scripts" do CI — pendência 46. Executa
 * SEMPRE ao ser carregado; as funções puras moram em `nonce-na-pagina.ts`.
 *
 * Sobe `next start` sobre o build que já existe, pede `/entrar` (abre sem
 * sessão) e confere que cada `<script>` traz o nonce da CSP da resposta — e,
 * num segundo pedido, que o nonce mudou: um nonce fixo não é nonce.
 *
 * O servidor é derrubado em QUALQUER saída, pelo `finally`. Por isso a falha é
 * lançada, nunca `process.exit` no meio: o `exit` pularia o `finally` e
 * deixaria um `next start` vivo segurando a porta.
 *
 * Só roda contra base de teste e pasta de anexos dadas no comando
 * (`recusaDoAmbiente`): a partida roda a limpeza diária.
 */

const PORTA = process.env['PORTA_DA_CONFERENCIA'] ?? '3999'
const ENDERECO = `http://127.0.0.1:${PORTA}/entrar`
const PRAZO_PARA_SUBIR_MS = 60_000
const PRAZO_POR_PEDIDO_MS = 10_000
const PRAZO_PARA_ENCERRAR_MS = 5_000
const INTERVALO_MS = 500

class ConferenciaFalhou extends Error {}

function pedir(): Promise<Response> {
  return fetch(ENDERECO, { redirect: 'manual', signal: AbortSignal.timeout(PRAZO_POR_PEDIDO_MS) })
}

/** Outro processo já responde na porta? Então a resposta não seria a deste build. */
async function exigirPortaLivre(): Promise<void> {
  try {
    await pedir()
  } catch {
    return
  }
  throw new ConferenciaFalhou(`Já há um servidor respondendo em ${ENDERECO}; a conferência não seria deste build.`)
}

async function pedirQuandoSubir(estado: { encerrou: number | null }): Promise<Response> {
  const limite = Date.now() + PRAZO_PARA_SUBIR_MS
  for (;;) {
    // Encerrou sozinho: a configuração recusou a partida (`AT-65`), por exemplo.
    if (estado.encerrou !== null) {
      throw new ConferenciaFalhou(`O next start encerrou com código ${estado.encerrou} antes de responder.`)
    }
    try {
      return await pedir()
    } catch (erro) {
      // Conexão recusada: ainda subindo. Depois do prazo, falha com a causa.
      if (Date.now() > limite) {
        throw new ConferenciaFalhou(`${ENDERECO} não respondeu em ${PRAZO_PARA_SUBIR_MS / 1000} s: ${String(erro)}`)
      }
      await new Promise((resolver) => setTimeout(resolver, INTERVALO_MS))
    }
  }
}

/** Confere uma resposta e devolve o nonce dela. */
async function conferir(resposta: Response): Promise<string> {
  if (resposta.status !== 200) throw new ConferenciaFalhou(`${ENDERECO} respondeu ${resposta.status}, não 200.`)
  const csp = resposta.headers.get('content-security-policy')
  const problemas = problemasDoNonce(csp, await resposta.text())
  if (problemas.length > 0) {
    throw new ConferenciaFalhou('O nonce da CSP NÃO chega aos scripts:\n' + problemas.map((p) => `- ${p}`).join('\n'))
  }
  return nonceDoCabecalho(csp)!
}

/** SIGTERM, e SIGKILL se ele não sair no prazo: o passo não pode ficar pendurado. */
async function derrubar(servidor: ChildProcess, estado: { encerrou: number | null }): Promise<void> {
  if (estado.encerrou !== null) return
  const saiu = new Promise<void>((resolver) => servidor.once('exit', () => resolver()))
  servidor.kill()
  let prazo: NodeJS.Timeout | undefined
  const noPrazo = await Promise.race([
    saiu.then(() => true),
    new Promise<boolean>((resolver) => {
      prazo = setTimeout(() => resolver(false), PRAZO_PARA_ENCERRAR_MS)
    }),
  ])
  // Sem isto, o temporizador segurava o processo vivo até o fim do prazo,
  // mesmo com o servidor já fora (revisão técnica do #214).
  clearTimeout(prazo)
  if (!noPrazo) servidor.kill('SIGKILL')
}

async function principal(): Promise<void> {
  const recusa = recusaDoAmbiente(process.env)
  if (recusa !== null) throw new ConferenciaFalhou(recusa)
  await exigirPortaLivre()

  const next = join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next')
  const servidor = spawn(process.execPath, [next, 'start', '-p', PORTA, '-H', '127.0.0.1'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let saida = ''
  servidor.stdout!.on('data', (pedaco: Buffer) => (saida += pedaco.toString()))
  servidor.stderr!.on('data', (pedaco: Buffer) => (saida += pedaco.toString()))
  const estado: { encerrou: number | null } = { encerrou: null }
  servidor.on('exit', (codigo) => (estado.encerrou = codigo ?? -1))

  try {
    const primeiro = await conferir(await pedirQuandoSubir(estado))
    const segundo = await conferir(await pedir())
    if (primeiro === segundo) throw new ConferenciaFalhou('O nonce não mudou entre dois pedidos: nonce fixo não protege.')
    console.log(`Nonce da CSP em todos os scripts de ${ENDERECO}, diferente a cada pedido.`)
  } catch (erro) {
    if (saida.trim() !== '') console.error(`--- saída do next start ---\n${saida.slice(-4000)}`)
    throw erro
  } finally {
    await derrubar(servidor, estado)
  }
}

principal().catch((erro: unknown) => {
  console.error(erro instanceof ConferenciaFalhou ? erro.message : erro)
  process.exitCode = 1
})
