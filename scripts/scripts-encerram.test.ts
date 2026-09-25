import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Script de linha de comando que usa o banco tem de ENCERRAR sozinho.
 *
 * Medido em 25/09/2026 nesta máquina: `db:privilegios` imprimia o resultado e
 * ficava vivo para sempre, e a rotina agendada do Gemini deixou dois
 * `ia:experimentar` pendurados desde as 07:44 e as 13:44. A conexão aberta
 * pelo Prisma segura o processo. Num servidor, a limpeza diária (`db:expurgar`)
 * agendada faria o mesmo: um processo vivo a mais por dia, e o agendador sem
 * saber se a rodada terminou — falha silenciosa, a doença que o sistema existe
 * para curar.
 *
 * O teste roda o script de verdade, contra a base de teste, e exige a saída.
 */

const RAIZ = join(__dirname, '..')
const TSX = join(RAIZ, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const PRAZO_PARA_ENCERRAR_MS = 45_000

function rodar(script: string, argumentos: string[], envExtra: Record<string, string> = {}) {
  return new Promise<{ codigo: number | null; saida: string; encerrou: boolean }>((resolver) => {
    const filho = spawn(process.execPath, [TSX, join(RAIZ, 'scripts', script), ...argumentos], {
      cwd: RAIZ,
      // A suíte já traz DATABASE_URL (base de teste) e BUSCA_SECRET; o segredo
      // de sessão é sintético. Sem ele o script sai na partida por configuração
      // — e "encerrou" viraria verde falso: foi o que aconteceu na 1ª versão.
      env: { ...process.env, SESSAO_SECRET: 'teste-nao-e-segredo-sessao-scripts', ...envExtra },
    })
    let saida = ''
    filho.stdout.on('data', (pedaco: Buffer) => (saida += pedaco.toString()))
    filho.stderr.resume()
    const prazo = setTimeout(() => {
      filho.kill()
      resolver({ codigo: null, saida, encerrou: false })
    }, PRAZO_PARA_ENCERRAR_MS)
    filho.on('exit', (codigo) => {
      clearTimeout(prazo)
      resolver({ codigo, saida, encerrou: true })
    })
  })
}

describe('scripts que usam o banco encerram sozinhos', () => {
  it('db:privilegios termina depois de imprimir', async () => {
    const resultado = await rodar('conferir-privilegios.ts', [])

    expect(resultado.encerrou).toBe(true)
    // Chegou ao fim de verdade: o relatório foi impresso.
    expect(resultado.saida.trim().length).toBeGreaterThan(0)
  })

  describe('ia:avaliar contra um servidor de modelo falso', () => {
    let servidor: Server
    let endereco: string

    beforeAll(async () => {
      const resposta = {
        itens: [
          {
            categoriaCodigo: 'EMAIL_CADASTRO',
            titulo: 'Pedido de exemplo',
            confianca: 0.9,
            campos: {},
            camposAusentes: [],
            ligaMencionada: null,
            observacao: null,
          },
        ],
        pareceInstrucao: false,
      }
      servidor = createServer((pedido, saida) => {
        pedido.resume()
        pedido.on('end', () => {
          saida.writeHead(200, { 'content-type': 'application/json' })
          saida.end(
            JSON.stringify({
              model: 'modelo-falso',
              choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(resposta) } }],
            }),
          )
        })
      })
      await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto))
      endereco = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
    })

    afterAll(async () => {
      await new Promise<void>((fechado) => servidor.close(() => fechado()))
    })

    it('termina depois da linha JSON — com o banco no ar, que é o caso que travava', async () => {
      const resultado = await rodar('avaliar-ia.ts', ['--json'], {
        IA_ADAPTER: 'local',
        IA_LOCAL_URL: endereco,
        IA_MODELO: 'modelo-falso',
        INGESTAO_ADAPTER: 'mock',
      })

      expect(resultado.encerrou).toBe(true)
      expect(resultado.codigo).toBe(0)
      expect(resultado.saida.trim().split('\n')).toHaveLength(1)
    })
  })
})
