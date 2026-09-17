import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  comentariosCitados,
  conferirComentarios,
  EVIDENCIAS,
  evidenciasFaltando,
  nivelDaMudanca,
  nivelDoArquivo,
  secoesDoCorpo,
} from './nivel-de-risco'

describe('nivelDoArquivo', () => {
  it.each([
    ['docs/ESTADO.md', 0],
    ['README.md', 0],
    ['src/app/fila/page.tsx', 1],
    ['src/components/ui/botao.tsx', 1],
    ['src/core/distribuicao/motor.ts', 2],
    ['src/servicos/transferencia.ts', 2],
    ['src/app/api/itens/route.ts', 3],
    ['src/servidor/sessao.ts', 3],
    ['src/middleware.ts', 3],
    ['src/adapters/ia-anthropic.ts', 3],
    ['src/ports/ia.ts', 3],
    ['src/core/seguranca/conteudo-nao-confiavel.ts', 3],
    ['src/core/assistente/conhecimento.ts', 3],
    ['src/core/esquemas.ts', 3],
    ['prisma/schema.prisma', 3],
    ['package.json', 3],
    ['package-lock.json', 3],
    ['.github/workflows/ci.yml', 3],
    ['.env.example', 3],
    ['.gitignore', 3],
    ['vitest.config.ts', 3],
    ['tsconfig.json', 3],
    ['next.config.ts', 3],
    ['CLAUDE.md', 3],
    ['.claude/launch.json', 3],
    ['scripts/expurgo.ts', 3],
  ] as const)('%s → nível %i', (caminho, nivel) => {
    expect(nivelDoArquivo(caminho).nivel).toBe(nivel)
  })

  // Quem muda o portão não pode passar por ele com o nível mais baixo.
  it('o próprio portão é sensível', () => {
    expect(nivelDoArquivo('scripts/processo/nivel-de-risco.ts').nivel).toBe(3)
  })

  // Falhar fechado: um diretório novo que ninguém classificou não pode cair
  // no nível mais leve por omissão (invariante 7).
  it('caminho desconhecido cai no nível mais alto', () => {
    const r = nivelDoArquivo('infra/terraform/main.tf')
    expect(r.nivel).toBe(3)
    expect(r.motivo).toMatch(/desconhecido/)
  })

  // Teste também é código que prova: enfraquecer um teste do motor é mudança
  // de regra de negócio, não de documentação.
  it('arquivo de teste herda o nível do diretório', () => {
    expect(nivelDoArquivo('src/core/distribuicao/motor.test.ts').nivel).toBe(2)
    expect(nivelDoArquivo('src/app/api/itens/route.test.ts').nivel).toBe(3)
  })

  it('aceita barra invertida do Windows', () => {
    expect(nivelDoArquivo('src\\app\\api\\itens\\route.ts').nivel).toBe(3)
  })
})

describe('nivelDaMudanca', () => {
  it('vale o arquivo mais sensível', () => {
    const r = nivelDaMudanca(['docs/ESTADO.md', 'src/app/fila/page.tsx', 'src/core/distribuicao/motor.ts'])
    expect(r.nivel).toBe(2)
  })

  // Um PR sem arquivo é sinal de que a lista veio errada, não de que nada mudou.
  it('recusa lista vazia', () => {
    expect(() => nivelDaMudanca([])).toThrow(/nenhum arquivo/)
  })
})

describe('secoesDoCorpo', () => {
  it('separa por título de nível 3 e ignora comentário do modelo', () => {
    const corpo = '### Especificação\n<!-- explique -->\nPedido do dono.\n\n### Regressão\n<!-- cole -->\n'
    const s = secoesDoCorpo(corpo)
    expect(s.get('especificação')).toBe('Pedido do dono.')
    expect(s.get('regressão')).toBe('')
  })

  it('não conta caixa desmarcada como conteúdo', () => {
    const s = secoesDoCorpo('### Regressão\n- [ ] `npm run verificar` passa\n')
    expect(s.get('regressão')).toBe('')
  })

  it('aceita corpo nulo, que é o que o GitHub manda quando o PR não tem texto', () => {
    expect(secoesDoCorpo(null).size).toBe(0)
  })
})

const PR = { repositorio: 'dono/repo', numero: 7 }
const LINK = 'https://github.com/dono/repo/pull/7#issuecomment-123456'

function corpoCompleto(): string {
  return [
    '### Especificação', 'Pedido do dono: conferir o processo (A55).',
    '### Visto rodando', 'Não se aplica: nenhuma tela mudou.',
    '### Verificação comportamental', 'Propriedade: soma das atribuições igual à entrada em 1.000 sorteios.',
    '### Teste visto vermelho', 'Revertida a correção, o teste X falhou com "esperado 3".',
    '### Revisão técnica', `code-reviewer: ${LINK}`,
    '### Revisão de segurança', `security-reviewer: ${LINK}`,
    '### Regressão', 'npm run verificar: 83 arquivos, 900 testes, nenhum pulado.',
  ].join('\n')
}

describe('evidenciasFaltando', () => {
  it('nível 0 pede só a especificação', () => {
    expect(evidenciasFaltando(0, PR, '### Especificação\nCorrige texto do ESTADO.')).toEqual([])
    expect(evidenciasFaltando(0, PR, '')).toEqual(['Especificação: seção ausente ou vazia'])
  })

  it('nível 1 pede tela vista rodando e regressão', () => {
    const faltam = evidenciasFaltando(1, PR, '### Especificação\nMuda o texto do botão.')
    expect(faltam).toEqual(['Visto rodando: seção ausente ou vazia', 'Regressão: seção ausente ou vazia'])
  })

  it('nível 3 com tudo preenchido passa', () => {
    expect(evidenciasFaltando(3, PR, corpoCompleto())).toEqual([])
  })

  it('nível 3 sem revisão de segurança não passa', () => {
    const corpo = corpoCompleto().replace(/### Revisão de segurança\n.*\n/, '')
    expect(evidenciasFaltando(3, PR, corpo)).toEqual(['Revisão de segurança: seção ausente ou vazia'])
  })

  // A revisão precisa existir publicada no PR, não só ser afirmada no texto:
  // "revisado, ok" sem link é exatamente a aprovação sem evidência que o
  // processo existe para impedir.
  it('revisão sem link para o comentário publicado não vale', () => {
    const corpo = corpoCompleto().replace(`code-reviewer: ${LINK}`, 'code-reviewer: revisado, tudo certo')
    expect(evidenciasFaltando(2, PR, corpo)).toEqual([
      'Revisão técnica: falta o link do comentário publicado neste PR (https://github.com/dono/repo/pull/7#issuecomment-…)',
    ])
  })

  // O modelo de PR vazio, como o GitHub o entrega, não pode passar em nível
  // nenhum acima de zero. Pega também a divergência entre os títulos do
  // modelo e os de EVIDENCIAS, e título de outro nível (`## Segurança`)
  // sendo lido como conteúdo da seção anterior.
  it('o modelo de PR sem preencher falha em todas as evidências do nível 3', () => {
    const modelo = readFileSync(join(process.cwd(), '.github/pull_request_template.md'), 'utf8')
    expect(evidenciasFaltando(3, PR, modelo)).toEqual(EVIDENCIAS.map((e) => `${e.titulo}: seção ausente ou vazia`))
  })

  it('título de outro nível encerra a seção', () => {
    const s = secoesDoCorpo('### Regressão\n\n## Segurança\n- [ ] Sem segredo em código\n')
    expect(s.get('regressão')).toBe('')
  })

  // Um link de outro PR, ou de outro repositório, é revisão de outra coisa.
  it('link de revisão de outro PR não vale', () => {
    const corpo = corpoCompleto().replace(`code-reviewer: ${LINK}`, 'code-reviewer: https://github.com/dono/repo/pull/6#issuecomment-1')
    expect(evidenciasFaltando(2, PR, corpo)).toEqual([
      'Revisão técnica: falta o link do comentário publicado neste PR (https://github.com/dono/repo/pull/7#issuecomment-…)',
    ])
  })

  it('link de revisão de outro repositório não vale', () => {
    const corpo = corpoCompleto().replace(`code-reviewer: ${LINK}`, 'code-reviewer: https://github.com/outro/repo/pull/7#issuecomment-1')
    expect(evidenciasFaltando(2, PR, corpo)).toHaveLength(1)
  })

  it('nível 2 não exige revisão de segurança', () => {
    const corpo = corpoCompleto().replace(/### Revisão de segurança\n.*\n/, '')
    expect(evidenciasFaltando(2, PR, corpo)).toEqual([])
  })
})

describe('comentariosCitados', () => {
  // O CI confere na API que cada comentário citado existe e é deste PR:
  // o formato certo não prova que o comentário existe.
  it('devolve os comentários citados nas seções de revisão, sem repetir', () => {
    const corpo = corpoCompleto().replace(
      `security-reviewer: ${LINK}`,
      'security-reviewer: https://github.com/dono/repo/pull/7#pullrequestreview-99',
    )
    expect(comentariosCitados(PR, corpo)).toEqual([
      { tipo: 'issuecomment', id: 123456 },
      { tipo: 'pullrequestreview', id: 99 },
    ])
  })

  it('ignora link fora das seções de revisão', () => {
    expect(comentariosCitados(PR, `### Especificação
Ver ${LINK}`)).toEqual([])
  })
})

// Achados da revisão técnica do PR #55.
describe('secoesDoCorpo — o que o GitHub mostra, não o que parece título', () => {
  it('linha com # dentro de bloco de código não encerra a seção', () => {
    const corpo = '### Regressão\nRodei:\n```bash\n# comentário de shell\nnpm run verificar\n```\n### Especificação\nPedido.'
    expect(secoesDoCorpo(corpo).get('regressão')).toBe('Rodei:\n```bash\n# comentário de shell\nnpm run verificar\n```')
  })

  it('bloco com ~~~ também conta', () => {
    const corpo = '### Regressão\n~~~\n# saída\n~~~\n'
    expect(secoesDoCorpo(corpo).get('regressão')).toBe('~~~\n# saída\n~~~')
  })

  it('título com emoji, pontuação ou espaço a mais é reconhecido', () => {
    const s = secoesDoCorpo('###   🔍 Revisão técnica:  \nlink\n')
    expect(s.get('revisão técnica')).toBe('link')
  })
})

describe('conferirComentarios', () => {
  const corpo = `### Revisão técnica\n${LINK}\n`
  const resposta = (status: number, corpoJson: unknown = {}) => async () => ({ status, json: async () => corpoJson })

  it('comentário deste PR passa', async () => {
    const buscar = resposta(200, { issue_url: 'https://api.github.com/repos/dono/repo/issues/7' })
    expect(await conferirComentarios(PR, corpo, buscar)).toEqual([])
  })

  it('comentário de outro PR não passa', async () => {
    const buscar = resposta(200, { issue_url: 'https://api.github.com/repos/dono/repo/issues/70' })
    expect(await conferirComentarios(PR, corpo, buscar)).toEqual(['o comentário issuecomment-123456 citado não existe neste PR'])
  })

  it('404 é comentário inexistente', async () => {
    expect(await conferirComentarios(PR, corpo, resposta(404))).toEqual([
      'o comentário issuecomment-123456 citado não existe neste PR',
    ])
  })

  // Falha da API não pode sumir com o relatório nem passar como evidência:
  // vira pendência própria, e o job continua vermelho com o motivo certo.
  it('erro da API vira pendência com o motivo, sem lançar', async () => {
    expect(await conferirComentarios(PR, corpo, resposta(503))).toEqual([
      'não foi possível conferir o comentário issuecomment-123456 (API do GitHub respondeu 503) — rode o job de novo',
    ])
    const quebrada = async () => {
      throw new Error('rede fora')
    }
    expect(await conferirComentarios(PR, corpo, quebrada)).toEqual([
      'não foi possível conferir o comentário issuecomment-123456 (rede fora) — rode o job de novo',
    ])
  })

  it('pede a revisão pelo caminho do próprio PR', async () => {
    const caminhos: string[] = []
    const buscar = async (caminho: string) => {
      caminhos.push(caminho)
      return { status: 200, json: async () => ({}) }
    }
    const comRevisao = '### Revisão técnica\nhttps://github.com/dono/repo/pull/7#pullrequestreview-9\n'
    expect(await conferirComentarios(PR, comRevisao, buscar)).toEqual([])
    expect(caminhos).toEqual(['repos/dono/repo/pulls/7/reviews/9'])
  })
})
