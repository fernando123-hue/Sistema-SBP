import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Texto de tela fala com a equipe, não com quem programa (achado N-28, `A40`).
 *
 * Justificativas de engenharia tinham ido parar no texto visível: "sem este
 * aviso, a lista parecia completa", "o motor", "a porta lateral que este
 * sistema existe para fechar", "pela mesma função", "livro-razão", "cota justa
 * · piso · resto". Elas são memória cara — no COMENTÁRIO. Na tela, a pessoa
 * precisa saber o que houve e o que fazer.
 *
 * A varredura tira os comentários e procura o vocabulário que já escapou uma
 * vez. Não pega toda frase técnica possível; pega a volta destas.
 *
 * Limite conhecido do removedor de comentários (revisão técnica do #115): ele
 * não entende o código, só o texto. Só `http://` e `https://` são poupados; um
 * `//` que fosse texto visível cortaria o resto da linha. Nenhuma tela tem isso
 * hoje; se aparecer, o sintoma é a varredura não ver um trecho da linha.
 */

const APP = dirname(fileURLToPath(import.meta.url))

const JARGAO = [
  /\bo motor\b/i,
  /livro-razão/i,
  /porta lateral/i,
  /pela mesma função/i,
  /cota justa/i,
  /\bpiso\b/i,
  /no banco\b/i,
  /sem este aviso/i,
  /unidades? de carga/i,
]

/** O fonte sem comentários de bloco, de JSX e de linha (sem pegar `http://`). */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!https?:)\/\/.*$/gm, '')
}

const telas = readdirSync(APP, { recursive: true, encoding: 'utf8' }).filter((nome) =>
  nome.endsWith('page.tsx'),
)

describe('textos das telas sem jargão de engenharia', () => {
  it('a varredura enxerga as telas', () => {
    expect(telas.length).toBeGreaterThan(5)
  })

  it('tira comentário e mantém texto', () => {
    expect(semComentarios('a /* o motor */ b // o motor\n{/* cota justa */}c')).not.toMatch(/motor|cota/)
    expect(semComentarios('<p>visite http://exemplo.test</p>')).toContain('http://exemplo.test')
    expect(semComentarios('<a href="https://exemplo.test">x</a>')).toContain('https://exemplo.test')
    // Comentário colado, sem espaço (revisão técnica do #115): antes, o `:`
    // antes do `//` o protegia como se fosse URL e a varredura dava vermelho falso.
    expect(semComentarios('rotulo:// cota justa')).not.toMatch(/cota/)
    expect(semComentarios('x//cota justa')).not.toMatch(/cota/)
  })

  it.each(telas)('%s', (nome) => {
    const texto = semComentarios(readFileSync(join(APP, nome), 'utf8'))
    const achados = JARGAO.filter((padrao) => padrao.test(texto)).map(String)

    expect(achados).toEqual([])
  })
})

/**
 * Em que elemento cada `title=` está. Em `<button>` ele é a descrição
 * acessível — o leitor de tela o lê ao focar —; em texto sem foco, só o mouse
 * o alcança (revisão do #126). Elemento que o detector não reconhece (um `<`
 * de comparação no meio do caminho) volta como `?` e conta como violação:
 * na dúvida, falha fechada.
 */
function elementosComTitle(fonte: string): string[] {
  return [...fonte.matchAll(/\btitle=/g)].map((achado) => {
    const abertura = fonte.lastIndexOf('<', achado.index)
    return /^<([A-Za-z][\w.]*)/.exec(fonte.slice(abertura))?.[1] ?? '?'
  })
}

const COMPONENTES = join(APP, '..', 'componentes')
// `Selo` põe o `title` e o mesmo texto escondido para o leitor de tela.
const componentes = readdirSync(COMPONENTES).filter((nome) => nome.endsWith('.tsx') && nome !== 'matrizes.tsx')

describe('explicação que só aparece passando o mouse (pendência 2)', () => {
  // `title` em texto sem foco não chega a teclado nem a leitor de tela
  // (revisão do #115). O selo do critério e a dica do crédito moravam só ali.
  // Explicação é texto visível ou vai pelo `titulo` do `Selo`, que também a
  // entrega ao leitor de tela.
  it('o detector de elemento acerta', () => {
    expect(elementosComTitle('<span className="x"\n title="a">')).toEqual(['span'])
    expect(elementosComTitle('<button\n  type="button"\n  title="a"\n>')).toEqual(['button'])
  })

  it.each([...telas.map((tela) => join(APP, tela)), ...componentes.map((nome) => join(COMPONENTES, nome))])(
    '%s só usa title em botão',
    (arquivo) => {
      const fonte = semComentarios(readFileSync(arquivo, 'utf8'))

      expect(elementosComTitle(fonte).filter((elemento) => elemento !== 'button')).toEqual([])
    },
  )

  it('a explicação do critério e a do crédito estão no texto da Distribuição', () => {
    const fonte = semComentarios(readFileSync(join(APP, 'distribuicao', 'page.tsx'), 'utf8'))

    // Num parágrafo, não num atributo: `titulo={…explicacao}` passaria aqui.
    expect(fonte).toMatch(/\.explicacao\}\s*<\/p>/)
    expect(fonte).toMatch(/fica na frente para a próxima sobra/)
  })

  it('a explicação do crédito está no texto do Painel', () => {
    const fonte = semComentarios(readFileSync(join(APP, 'painel', 'page.tsx'), 'utf8'))

    expect(fonte).toMatch(/fica na frente para a próxima sobra/)
  })
})
