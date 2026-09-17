import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { obterPrisma } from '../servidor/prisma'
import { limparTudo } from '../testes/apoio'

/**
 * A trilha é append-only — e agora isso é verificado, não prometido.
 *
 * `LogAuditoria` e `EventoProcessamento` são a memória que o `CLAUDE.md` promete
 * nos invariantes 11, 12 e 14: "a trilha é append-only, então uma linha gravada
 * sem domínio só ganharia um por UPDATE — a única escrita que este sistema
 * promete nunca fazer". Até aqui, nada além da promessa segurava isso: a
 * aplicação conecta com um usuário que pode tudo, e um `updateMany` escrito por
 * engano — ou de propósito — passaria sem ninguém notar. Achado N-19 da
 * auditoria de 17/09/2026.
 *
 * São duas camadas, e elas protegem de coisas diferentes:
 *
 *   1. **No código** (a varredura abaixo): ninguém em `src/` ou `scripts/`
 *      chama `update`/`delete`/`upsert` nessas duas tabelas. Pega o engano
 *      honesto, na hora de escrever, com mensagem que explica.
 *   2. **No banco** (a trigger da migração `trilha_append_only`): o próprio
 *      MySQL recusa o `UPDATE`, venha ele do Prisma, de um script solto ou de
 *      um cliente de linha de comando aberto às pressas numa madrugada.
 *
 * O `DELETE` fica de fora da trigger de propósito: a suíte limpa as tabelas
 * entre casos, e uma trava que obrigasse a recriar a base a cada teste seria
 * paga todo dia para proteger um cenário que, em produção, o privilégio do
 * usuário do banco resolve melhor (ver `docs/03-SPEC.md`, implantação).
 */

const RAIZ_SRC = dirname(dirname(fileURLToPath(import.meta.url)))
const RAIZ_PROJETO = dirname(RAIZ_SRC)

const TABELAS_DA_TRILHA = ['logAuditoria', 'eventoProcessamento'] as const
const METODOS_PROIBIDOS = ['update', 'updateMany', 'delete', 'deleteMany', 'upsert'] as const

function listarTs(diretorio: string): string[] {
  return readdirSync(diretorio, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(diretorio, entrada.name)
    if (entrada.isDirectory()) {
      // `generated/` é código do Prisma (a documentação dele cita os métodos);
      // `testes/` limpa as tabelas entre casos, e é o único que pode.
      return entrada.name === 'generated' || entrada.name === 'testes' ? [] : listarTs(caminho)
    }
    return /\.tsx?$/.test(entrada.name) ? [caminho] : []
  })
}

interface Violacao {
  readonly arquivo: string
  readonly chamada: string
}

/**
 * A única exceção, e ela é nominal.
 *
 * `db:limpar` existe para repetir a demo do zero num banco de desenvolvimento,
 * e apagar a trilha junto é o objetivo dele — não um efeito colateral. Ele já
 * recusa `NODE_ENV=production` e exige `PERMITIR_LIMPEZA=sim`; a exceção mora
 * aqui, com nome e motivo, em vez de a varredura inteira ficar frouxa.
 */
const EXCECAO = join(RAIZ_PROJETO, 'scripts', 'limpar-transacional.ts')

function analisar(fonte: string, arquivo: string): Violacao[] {
  if (arquivo === EXCECAO) return []
  const violacoes: Violacao[] = []
  for (const tabela of TABELAS_DA_TRILHA) {
    for (const metodo of METODOS_PROIBIDOS) {
      const padrao = new RegExp(`\\b${tabela}\\s*\\.\\s*${metodo}\\s*\\(`, 'g')
      for (const _achado of fonte.matchAll(padrao)) {
        violacoes.push({ arquivo: relative(RAIZ_PROJETO, arquivo), chamada: `${tabela}.${metodo}` })
      }
    }
  }
  return violacoes
}

describe('a trilha é append-only', () => {
  it('nenhum código de produção altera ou apaga linha da trilha', () => {
    const arquivos = [...listarTs(RAIZ_SRC), ...listarTs(join(RAIZ_PROJETO, 'scripts'))].filter(
      (arquivo) => !/\.test\.tsx?$/.test(arquivo),
    )
    const violacoes = arquivos.flatMap((arquivo) => analisar(readFileSync(arquivo, 'utf8'), arquivo))

    expect(
      violacoes,
      'A trilha só recebe `create`. Corrigir um registro errado é gravar um registro NOVO que o explique — ' +
        'reescrever o passado é exatamente o que uma trilha de auditoria existe para impedir.',
    ).toEqual([])
  })

  it('detecta a chamada proibida que promete detectar', () => {
    // Sem isto, um erro na varredura devolveria lista vazia e o teste acima
    // ficaria verde para sempre sem guardar nada.
    const caso = `await banco.logAuditoria.updateMany({ where: {}, data: { dominio: 'x' } })`
    expect(analisar(caso, join(RAIZ_SRC, 'servicos/auditoria.ts'))).toHaveLength(1)
  })

  it('o BANCO recusa alterar uma linha da trilha, mesmo por consulta crua', async () => {
    const banco = obterPrisma()
    await limparTudo(banco)

    await banco.logAuditoria.create({
      data: {
        entidade: 'Item',
        entidadeId: 'item-sintetico',
        acao: 'teste',
        usuario: 'pessoa-sintetica',
        dominio: 'distribuicao',
      },
    })

    await expect(
      banco.$executeRaw`UPDATE LogAuditoria SET acao = 'reescrito'`,
    ).rejects.toThrow(/append-only|45000|1644/i)

    // E a linha continua como nasceu.
    expect((await banco.logAuditoria.findFirstOrThrow({})).acao).toBe('teste')
  })
})
