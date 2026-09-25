import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Mensagem de regra de negócio não carrega id interno (achado N-28).
 *
 * `ErroDeNegocio` vira 422 e a mensagem chega INTEIRA à tela — foi escrita para
 * quem usa. Várias diziam `Item "cmf3k…" não tem responsável ativo.`: o id não
 * ajuda a pessoa a fazer nada, e ela não tem onde procurá-lo. A varredura
 * impede a volta: um `${…Id}`, `${….id}` ou `${id}` dentro do texto de um
 * `new ErroDeNegocio(` quebra a suíte.
 *
 * Varre `servicos/` e `core/` inteiros — `core/retencao.ts` também lança
 * `ErroDeNegocio` (revisão técnica do #114). Só o texto do erro é olhado —
 * `where: { id: … }` e consultas ao lado ficam de fora. Defeito do sistema (id
 * que devia existir e não existe por falha nossa) não é `ErroDeNegocio`: sobe
 * como `Error`, vira 500 e o id vai para o log.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

const ID_INTERPOLADO = /\$\{[^}]*(?:\bid|Id)\s*\}/

/** O texto passado a cada `new ErroDeNegocio(`, até o parêntese que fecha. */
function mensagensDeNegocio(fonte: string): string[] {
  const mensagens: string[] = []
  const inicio = /new ErroDeNegocio\(/g
  for (let achado = inicio.exec(fonte); achado; achado = inicio.exec(fonte)) {
    let profundidade = 1
    let fim = inicio.lastIndex
    while (fim < fonte.length && profundidade > 0) {
      if (fonte[fim] === '(') profundidade += 1
      if (fonte[fim] === ')') profundidade -= 1
      fim += 1
    }
    mensagens.push(fonte.slice(inicio.lastIndex, fim - 1))
  }
  return mensagens
}

const arquivos = ['servicos', 'core'].flatMap((pasta) =>
  readdirSync(join(SRC, pasta), { recursive: true, encoding: 'utf8' })
    .filter((nome) => nome.endsWith('.ts') && !nome.endsWith('.test.ts'))
    .map((nome) => join(pasta, nome)),
)

describe('mensagens de ErroDeNegocio sem id interno', () => {
  it('a varredura enxerga as mensagens (não passa por não achar nada)', () => {
    const total = arquivos.flatMap((nome) => mensagensDeNegocio(readFileSync(join(SRC, nome), 'utf8')))
    expect(total.length).toBeGreaterThan(20)
    expect(arquivos).toContain(join('core', 'retencao.ts'))
  })

  it('o detector reconhece id interpolado', () => {
    expect(ID_INTERPOLADO.test('`Item "${entrada.itemId}" não tem responsável ativo.`')).toBe(true)
    expect(ID_INTERPOLADO.test('`O item "${item.id}" não pertence`')).toBe(true)
    expect(ID_INTERPOLADO.test('`Colaborador "${id}" não existe.`')).toBe(true)
    expect(ID_INTERPOLADO.test('`${pessoa.nome} já tem afastamento`')).toBe(false)
    expect(ID_INTERPOLADO.test('`Encurtar de ${diasAntes} para ${dados.dias} dias`')).toBe(false)
  })

  it.each(arquivos)('%s', (nome) => {
    const comId = mensagensDeNegocio(readFileSync(join(SRC, nome), 'utf8')).filter((texto) =>
      ID_INTERPOLADO.test(texto),
    )

    expect(comId).toEqual([])
  })
})
