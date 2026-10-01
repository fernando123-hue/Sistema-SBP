import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Pendências 37 e 47: `ambiente()` confere `NODE_TLS_REJECT_UNAUTHORIZED` na
 * partida. O Node relê a variável a cada `tls.connect`, então código que a
 * escrevesse depois, ou que passasse `rejectUnauthorized`/`checkServerIdentity`
 * direto a uma conexão, desligaria a verificação sem passar pela trava. Hoje
 * não há nenhum; esta varredura transforma a ausência em regra.
 *
 * A regra proíbe o IDENTIFICADOR, não só a forma "`: false`": as revisões do
 * PR da pendência 47 mostraram que `{"rejectUnauthorized": false}`,
 * `opts.rejectUnauthorized = false`, `!1`, um valor vindo de variável e o nome
 * montado por concatenação escapavam de uma regex mais estreita. Mencionar o
 * nome, até em comentário, já é vermelho: uso legítimo entra em `PERMITIDOS`,
 * com o motivo. É rede de segurança, não prova — indireção suficiente escapa
 * de qualquer varredura de texto.
 */

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PROIBIDO = /NODE_TLS|rejectUnauthorized|checkServerIdentity/
const EXTENSOES = /\.[cm]?[jt]sx?$/

/**
 * Os dois usos legítimos, cada um com uma lista FECHADA do que é aceito.
 *
 * - `ambiente.ts` LÊ a variável para recusá-la. Toda linha dele que cite
 *   `NODE_TLS` tem de ser comentário, a leitura exata da trava ou a linha da
 *   mensagem de erro; e ali também não pode haver opção de TLS nem escrita em
 *   `process.env` por `defineProperty`, `assign`, `Reflect` ou `delete`.
 *   Lista fechada, e não uma regex de "escrita": a segunda revisão de
 *   segurança mostrou `||=`, `??=`, `defineProperty` e `assign` escapando
 *   daquela.
 * - `vitest.config.ts` a ESVAZIA para a suíte (vazia, a verificação fica
 *   ligada). Só essa linha exata é aceita.
 */
const LINHAS_ACEITAS_EM_AMBIENTE = [
  // Comentário: `//`, ou `/*`/`*` sem código depois de um `*/` na mesma linha
  // (3ª rodada da revisão técnica: `/**/ process.env[...] ||= "0"` passava).
  /^\s*(?:\/\/|\/?\*(?!.*\*\/\s*\S))/,
  /^\s*const motivoTls = process\.env\['NODE_TLS_REJECT_UNAUTHORIZED'\] === '0' \? motivoDeNaoSerDesenvolvimento\(\) : null$/,
  // Sem `$` no resto: um `${...}` a mais esconderia uma escrita (3ª rodada da
  // revisão de segurança).
  /^\s*`NODE_TLS_REJECT_UNAUTHORIZED=0 com \$\{motivoTls\} desliga [^`$]*` \+$/,
]
const SEMPRE_PROIBIDO_EM_AMBIENTE =
  /rejectUnauthorized|checkServerIdentity|delete\s+process\.env|(?:Reflect|Object)\.\w+\(\s*process\.env/

function ambienteOfende(conteudo: string): boolean {
  if (SEMPRE_PROIBIDO_EM_AMBIENTE.test(conteudo)) return true
  return conteudo
    .split('\n')
    .filter((linha) => PROIBIDO.test(linha))
    .some((linha) => !LINHAS_ACEITAS_EM_AMBIENTE.some((aceita) => aceita.test(linha)))
}

const PERMITIDOS: Record<string, (conteudo: string) => boolean> = {
  'src/servidor/ambiente.ts': ambienteOfende,
  'vitest.config.ts': (conteudo) => PROIBIDO.test(conteudo.replace("NODE_TLS_REJECT_UNAUTHORIZED: '',", '')),
}

function fontes(pasta: string): string[] {
  return readdirSync(pasta, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(pasta, entrada.name)
    if (entrada.isDirectory()) return ['generated', 'node_modules'].includes(entrada.name) ? [] : fontes(caminho)
    return EXTENSOES.test(entrada.name) && !/\.test\.[cm]?[jt]sx?$/.test(entrada.name) ? [caminho] : []
  })
}

/** Código que roda: `src/`, `scripts/`, `prisma/` e os arquivos de configuração da raiz. */
function codigoDoRepositorio(): string[] {
  const daRaiz = readdirSync(RAIZ, { withFileTypes: true })
    .filter((entrada) => entrada.isFile() && EXTENSOES.test(entrada.name))
    .map((entrada) => join(RAIZ, entrada.name))
  return [...fontes(join(RAIZ, 'src')), ...fontes(join(RAIZ, 'scripts')), ...fontes(join(RAIZ, 'prisma')), ...daRaiz]
}

function ofende(caminhoRelativo: string, conteudo: string): boolean {
  const permitido = PERMITIDOS[caminhoRelativo]
  return permitido ? permitido(conteudo) : PROIBIDO.test(conteudo)
}

describe('ninguém desliga a verificação de TLS por fora da trava (pendências 37 e 47)', () => {
  it('nenhum arquivo de código menciona NODE_TLS, rejectUnauthorized ou checkServerIdentity fora do permitido', () => {
    const ofensores = codigoDoRepositorio()
      .map((caminho) => relative(RAIZ, caminho).split('\\').join('/'))
      .filter((caminho) => ofende(caminho, readFileSync(join(RAIZ, caminho), 'utf8')))
    expect(ofensores).toEqual([])
  })

  it('a varredura enxerga o que procura', () => {
    // Sem isto, um regex quebrado deixaria o teste de cima verde para sempre.
    for (const trecho of [
      "process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'",
      "process.env['NODE_TLS_' + 'REJECT_UNAUTHORIZED'] = '0'",
      'tls.connect({ rejectUnauthorized : false })',
      '{"rejectUnauthorized": false}',
      'opcoes.rejectUnauthorized = false',
      'tls.connect({ rejectUnauthorized: !1 })',
      'tls.connect({ rejectUnauthorized: inseguro })',
      'tls.connect({ checkServerIdentity: () => undefined })',
    ]) {
      expect(ofende('src/qualquer.ts', trecho), trecho).toBe(true)
    }
    for (const trecho of [
      "process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'",
      'process.env.NODE_TLS_REJECT_UNAUTHORIZED=""',
      "delete process.env['NODE_TLS_REJECT_UNAUTHORIZED']",
      "Reflect.deleteProperty(process.env, 'NODE_ENV')",
      'tls.connect({ rejectUnauthorized: false })',
      "process.env.NODE_TLS_REJECT_UNAUTHORIZED ||= '0'",
      "process.env['NODE_TLS_REJECT_UNAUTHORIZED'] ??= '0'",
      "Object.defineProperty(process.env, 'NODE_TLS_' + 'REJECT_UNAUTHORIZED', { value: '0' })",
      "Object.assign(process.env, { ['NODE_TLS_REJECT_UNAUTHORIZED']: '0' })",
      "const nome = 'NODE_TLS_REJECT_UNAUTHORIZED'",
      '/**/ process.env["NODE_TLS_REJECT_UNAUTHORIZED"] ||= "0"',
      '  * 0; */ process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"',
      "/* x */ process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'",
      "      `NODE_TLS_REJECT_UNAUTHORIZED=0 com ${motivoTls} desliga ${(process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0')}` +",
    ]) {
      expect(ofende('src/servidor/ambiente.ts', trecho), trecho).toBe(true)
    }
    expect(ofende('src/servidor/ambiente.ts', "spawn(cmd, { env: { NODE_TLS_REJECT_UNAUTHORIZED: '0' } })")).toBe(true)
    expect(ofende('vitest.config.ts', "NODE_TLS_REJECT_UNAUTHORIZED: '0',")).toBe(true)
    // O que a trava faz continua permitido: ler, citar em comentário e em mensagem.
    expect(
      ofende(
        'src/servidor/ambiente.ts',
        "  const motivoTls = process.env['NODE_TLS_REJECT_UNAUTHORIZED'] === '0' ? motivoDeNaoSerDesenvolvimento() : null",
      ),
    ).toBe(false)
    expect(ofende('src/servidor/ambiente.ts', '  // `NODE_TLS_REJECT_UNAUTHORIZED=0` desliga')).toBe(false)
    expect(ofende('src/servidor/ambiente.ts', '      `NODE_TLS_REJECT_UNAUTHORIZED=0 com ${motivoTls} desliga a verificação` +')).toBe(false)
    expect(ofende('vitest.config.ts', "NODE_TLS_REJECT_UNAUTHORIZED: '',")).toBe(false)

    const vistos = codigoDoRepositorio().map((caminho) => relative(RAIZ, caminho).split('\\').join('/'))
    for (const esperado of ['src/servidor/ambiente.ts', 'scripts/dev-local.ts', 'prisma/seed.ts', 'next.config.ts', 'prisma.config.ts', 'vitest.config.ts']) {
      expect(vistos, esperado).toContain(esperado)
    }
  })
})
