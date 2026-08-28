import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A trava arquitetural: `src/core/` é domínio puro.
 *
 * As setas apontam só para dentro — `app → servicos → core` — e nunca ao
 * contrário. Isso não é estética: é o que mantém o motor de distribuição
 * testável em milissegundos (sem banco, sem rede, sem render) e auditável para
 * sempre (a regra de negócio pode ser lida inteira sem abrir um schema Prisma
 * ou um componente React).
 *
 * Até hoje essa regra era sustentada só por disciplina. Disciplina não sobrevive
 * a um dia corrido: basta UM `import { prisma }` dentro do motor para que os
 * testes do núcleo passem a exigir banco, o tempo de suíte salte de
 * milissegundos para dezenas de segundos, e a suíte lenta comece a ser pulada —
 * que é exatamente como a conservação deixa de ser verificada. A regressão não
 * aparece como erro; aparece como lentidão que alguém contorna. Este arquivo é
 * a barreira que faz o defeito aparecer como vermelho, no minuto em que entra.
 *
 * DECISÃO SOBRE OS PRÓPRIOS TESTES: eles NÃO são excluídos da varredura.
 * Hoje `motor.test.ts`, `simulacao.test.ts`, `qualidade-ia.test.ts` e
 * `conteudo-nao-confiavel.test.ts` importam apenas `vitest` e irmãos de
 * `core/` — verificado antes de escrever esta regra, portanto a inclusão não
 * custa nada agora. E excluí-los abriria justamente o buraco que interessa
 * fechar: um teste do núcleo que monta cenário via Prisma arrasta o banco para
 * dentro da camada pura pela porta dos fundos e legitima a exceção. O teste do
 * domínio puro também é código do domínio puro.
 */

const RAIZ_CORE = dirname(fileURLToPath(import.meta.url))
const RAIZ_SRC = dirname(RAIZ_CORE)
const RAIZ_PROJETO = dirname(RAIZ_SRC)

/** Uma proibição: como reconhecê-la e, sobretudo, por que ela existe. */
interface Proibicao {
  readonly nome: string
  readonly viola: (especificador: string, dirDoArquivo: string) => boolean
  readonly motivo: string
}

const PROIBICOES: readonly Proibicao[] = [
  {
    nome: 'Prisma / cliente gerado',
    viola: (esp) =>
      esp === '@prisma/client' ||
      esp.startsWith('@prisma/') ||
      /(^|\/)generated(\/|$)/.test(esp),
    motivo:
      'O domínio não conhece persistência. Quem importa Prisma passa a precisar ' +
      'de banco para rodar, e o motor deixa de ser verificável em milissegundos. ' +
      'Persistência entra por `src/servicos/`, que traduz linha de banco em tipo ' +
      'de domínio antes de chamar o núcleo.',
  },
  {
    nome: 'React / Next',
    viola: (esp) =>
      esp === 'react' ||
      esp.startsWith('react/') ||
      esp === 'react-dom' ||
      esp.startsWith('react-dom/') ||
      esp === 'next' ||
      esp.startsWith('next/'),
    motivo:
      'Regra de negócio não pode depender de framework de tela. Se depender, ' +
      'ela morre junto com a próxima troca de framework — e a regra de rateio ' +
      'vale mais tempo do que qualquer versão do Next.',
  },
  {
    nome: 'Camada externa (import que sobe de `core/`)',
    viola: (esp, dirDoArquivo) => {
      const alvo = esp.startsWith('@/')
        ? resolve(RAIZ_SRC, esp.slice(2))
        : esp.startsWith('.')
          ? resolve(dirDoArquivo, esp)
          : null
      // Import de pacote (`zod`, `vitest`) não é caminho de camada: outras
      // proibições cuidam dele. Aqui só interessa caminho que sai de `core/`.
      if (alvo === null) return false
      return alvo !== RAIZ_CORE && !alvo.startsWith(RAIZ_CORE + sep)
    },
    motivo:
      'Seta invertida: `core/` alcançando `servicos/`, `servidor/`, `adapters/`, ' +
      '`app/`, `ports/` ou qualquer coisa fora de si. Basta um destes para o ' +
      'grafo de dependências virar ciclo — e a partir daí não existe mais ' +
      '"núcleo" que possa ser lido, testado ou auditado isoladamente. Se o ' +
      'domínio precisa de algo de fora, quem chama passa como argumento.',
  },
]

/**
 * `fetch` global. Buscado por texto, não por import, porque ele não tem import:
 * é a única dependência externa que entra sem deixar rastro no topo do arquivo.
 */
const PADROES_DE_REDE: readonly RegExp[] = [
  /(?<![.\w$])fetch\s*\(/g,
  /\b(?:globalThis|global|window)\s*\.\s*fetch\b/g,
]

const MOTIVO_REDE =
  'I/O de rede dentro do domínio. Além de tornar o teste lento e instável, ' +
  'esconde uma chamada externa onde se espera cálculo determinístico: a mesma ' +
  'entrada deixaria de produzir a mesma saída, e a auditoria da distribuição ' +
  'perderia o sentido. Rede vive em `src/adapters/`.'

interface Violacao {
  readonly arquivo: string
  readonly linha: number
  readonly trecho: string
  readonly regra: string
  readonly motivo: string
}

function listarArquivosTs(diretorio: string): string[] {
  const encontrados: string[] = []
  for (const entrada of readdirSync(diretorio, { withFileTypes: true })) {
    const caminho = join(diretorio, entrada.name)
    if (entrada.isDirectory()) {
      encontrados.push(...listarArquivosTs(caminho))
    } else if (entrada.isFile() && /\.tsx?$/.test(entrada.name)) {
      encontrados.push(caminho)
    }
  }
  return encontrados
}

/**
 * Apaga comentários preservando as quebras de linha (o número da linha
 * reportada precisa continuar batendo com o arquivo real).
 *
 * Sem isto, um comentário que MENCIONA a proibição — como os desta própria
 * suíte — seria acusado como violação, e um teste que acusa o inocente é
 * desligado na primeira semana.
 */
function removerComentarios(codigo: string): string {
  let resultado = ''
  let i = 0
  let estado: 'codigo' | 'linha' | 'bloco' | 'aspas' | 'apostrofo' | 'template' = 'codigo'

  while (i < codigo.length) {
    const c = codigo[i] ?? ''
    const proximo = codigo[i + 1] ?? ''

    if (estado === 'codigo') {
      if (c === '/' && proximo === '/') {
        estado = 'linha'
        resultado += '  '
        i += 2
        continue
      }
      if (c === '/' && proximo === '*') {
        estado = 'bloco'
        resultado += '  '
        i += 2
        continue
      }
      if (c === '"') estado = 'aspas'
      else if (c === "'") estado = 'apostrofo'
      else if (c === '`') estado = 'template'
      resultado += c
      i += 1
      continue
    }

    if (estado === 'linha') {
      if (c === '\n') {
        estado = 'codigo'
        resultado += c
      } else {
        resultado += ' '
      }
      i += 1
      continue
    }

    if (estado === 'bloco') {
      if (c === '*' && proximo === '/') {
        estado = 'codigo'
        resultado += '  '
        i += 2
        continue
      }
      resultado += c === '\n' ? c : ' '
      i += 1
      continue
    }

    // Dentro de string: preserva o conteúdo (é dele que sai o especificador).
    resultado += c
    if (c === '\\') {
      resultado += codigo[i + 1] ?? ''
      i += 2
      continue
    }
    if (
      (estado === 'aspas' && c === '"') ||
      (estado === 'apostrofo' && c === "'") ||
      (estado === 'template' && c === '`')
    ) {
      estado = 'codigo'
    }
    i += 1
  }

  return resultado
}

/**
 * Estático, dinâmico e `require` — as três portas de entrada. Cobrir só o
 * `import ... from` deixaria a mais fácil de esconder (`await import(...)`)
 * escancarada.
 */
const PADROES_DE_IMPORT: readonly RegExp[] = [
  /\bimport\s+[^;'"()]*\bfrom\s*(['"])([^'"]+)\1/g, // import x from 'y'
  /\bexport\s+[^;'"()]*\bfrom\s*(['"])([^'"]+)\1/g, // export x from 'y'
  /\bimport\s*(['"])([^'"]+)\1/g, // import 'y' (efeito colateral)
  /\bimport\s*\(\s*(['"])([^'"]+)\1/g, // import('y') dinâmico
  /\brequire\s*\(\s*(['"])([^'"]+)\1/g, // require('y')
]

function linhaDe(codigo: string, indice: number): number {
  let linha = 1
  for (let i = 0; i < indice && i < codigo.length; i += 1) {
    if (codigo[i] === '\n') linha += 1
  }
  return linha
}

function analisar(caminhoAbsoluto: string): Violacao[] {
  return analisarCodigo(
    readFileSync(caminhoAbsoluto, 'utf8'),
    relative(RAIZ_PROJETO, caminhoAbsoluto),
    dirname(caminhoAbsoluto),
  )
}

function analisarCodigo(fonte: string, arquivo: string, dirDoArquivo: string): Violacao[] {
  const codigo = removerComentarios(fonte)
  const violacoes: Violacao[] = []
  const jaVistos = new Set<string>()

  for (const padrao of PADROES_DE_IMPORT) {
    padrao.lastIndex = 0
    let achado: RegExpExecArray | null = padrao.exec(codigo)
    while (achado !== null) {
      const especificador = achado[2] ?? ''
      const linha = linhaDe(codigo, achado.index)
      for (const proibicao of PROIBICOES) {
        const chave = `${linha}|${especificador}|${proibicao.nome}`
        if (jaVistos.has(chave)) continue
        if (proibicao.viola(especificador, dirDoArquivo)) {
          jaVistos.add(chave)
          violacoes.push({
            arquivo,
            linha,
            trecho: especificador,
            regra: proibicao.nome,
            motivo: proibicao.motivo,
          })
        }
      }
      achado = padrao.exec(codigo)
    }
  }

  for (const padrao of PADROES_DE_REDE) {
    padrao.lastIndex = 0
    let achado: RegExpExecArray | null = padrao.exec(codigo)
    while (achado !== null) {
      violacoes.push({
        arquivo,
        linha: linhaDe(codigo, achado.index),
        trecho: achado[0].trim(),
        regra: 'fetch global',
        motivo: MOTIVO_REDE,
      })
      achado = padrao.exec(codigo)
    }
  }

  return violacoes
}

function montarMensagem(violacoes: readonly Violacao[]): string {
  const detalhes = violacoes
    .map(
      (v) =>
        `  • ${v.arquivo}:${v.linha}\n` +
        `      importou/usou: ${v.trecho}\n` +
        `      regra violada: ${v.regra}\n` +
        `      por quê: ${v.motivo}`,
    )
    .join('\n\n')

  return (
    `PUREZA DO DOMÍNIO VIOLADA — ${violacoes.length} ocorrência(s) em src/core/.\n\n` +
    `${detalhes}\n\n` +
    'A regra: `src/core/` não importa Prisma, React, Next, `fetch` nem nada das ' +
    'camadas de fora. As setas apontam só para dentro (app → servicos → core).\n' +
    'É isso que mantém o motor testável em milissegundos e auditável para sempre. ' +
    'Uma única aresta invertida transforma a suíte do núcleo em suíte de ' +
    'integração — lenta, dependente de banco e, por isso, a primeira a ser ' +
    'ignorada. Mova a dependência para `src/servicos/` ou `src/adapters/` e ' +
    'passe o resultado ao domínio como argumento.'
  )
}

describe('pureza do domínio (src/core)', () => {
  const arquivos = listarArquivosTs(RAIZ_CORE)

  it('encontra os arquivos do núcleo para varrer', () => {
    // Guarda contra o pior desfecho possível deste arquivo: a varredura quebrar,
    // não achar nada e passar verde para sempre — silêncio disfarçado de saúde,
    // que é a doença que este sistema existe para curar.
    expect(arquivos.length).toBeGreaterThan(5)
    expect(arquivos.some((a) => a.endsWith(`distribuicao${sep}motor.ts`))).toBe(true)
  })

  it('nenhum arquivo importa camada externa, Prisma, React, Next ou usa fetch', () => {
    const violacoes = arquivos.flatMap(analisar)
    if (violacoes.length > 0) {
      throw new Error(montarMensagem(violacoes))
    }
  })

  /**
   * Um detector que nunca acusou ninguém não prova nada: um regex "simplificado"
   * aqui dentro deixaria a suíte verde para sempre sem proteger nada.
   *
   * Os casos são montados em pedaços (cláusula + especificador) de propósito.
   * Escritos como literal completo, seriam varridos como violação REAL deste
   * arquivo — que também mora em `src/core/` e também é varrido. Montar em
   * pedaços é o que permite o guarda se auditar sem se acusar.
   */
  function montar(prefixo: string, especificador: string, sufixo = ''): string {
    return `${prefixo} ${JSON.stringify(especificador)}${sufixo}`
  }

  interface Caso {
    readonly prefixo: string
    readonly especificador: string
    readonly sufixo?: string
    /** De onde o import parte — caminho relativo só significa algo com origem. */
    readonly dir: string
  }

  const DIR_RAIZ = RAIZ_CORE
  const DIR_SUB = join(RAIZ_CORE, 'distribuicao')

  function violacoesDe(caso: Caso): Violacao[] {
    return analisarCodigo(
      montar(caso.prefixo, caso.especificador, caso.sufixo ?? ''),
      'sintetico.ts',
      caso.dir,
    )
  }

  it('detecta as violações que promete detectar', () => {
    const proibidos: readonly Caso[] = [
      { prefixo: 'import { PrismaClient } from', especificador: '@prisma/client', dir: DIR_RAIZ },
      { prefixo: 'import { prisma } from', especificador: '../../generated/prisma', dir: DIR_SUB },
      { prefixo: 'import { useState } from', especificador: 'react', dir: DIR_RAIZ },
      { prefixo: 'import { NextResponse } from', especificador: 'next/server', dir: DIR_RAIZ },
      { prefixo: 'import { distribuirDoDia } from', especificador: '../servicos/distribuicao', dir: DIR_RAIZ },
      { prefixo: 'import { logar } from', especificador: '@/servidor/log', dir: DIR_SUB },
      { prefixo: 'import', especificador: '@/app/registrar', dir: DIR_RAIZ },
      { prefixo: 'const svc = await import(', especificador: '../adapters/email', sufixo: ')', dir: DIR_RAIZ },
      { prefixo: 'const p = require(', especificador: '../ports/relogio', sufixo: ')', dir: DIR_RAIZ },
    ]

    for (const caso of proibidos) {
      const achadas = violacoesDe(caso)
      expect(achadas.length, `não detectou a violação: ${caso.especificador}`).toBeGreaterThan(0)
      // A mensagem precisa nomear o arquivo, a linha e o import — sem isso o
      // vermelho só diz "algo está errado", e alguém apaga o teste em vez do bug.
      const mensagem = montarMensagem(achadas)
      expect(mensagem).toContain('sintetico.ts:1')
      expect(mensagem).toContain(caso.especificador)
      expect(mensagem).toContain('por quê:')
    }
  })

  it('detecta fetch global mesmo sem import', () => {
    // `fetch` é a única dependência externa que entra sem deixar rastro no topo
    // do arquivo. Montado por interpolação para não acusar este arquivo.
    const usos = [`const r = await ${'fetch'}(url)`, `const r = globalThis.${'fetch'}(url)`]
    for (const uso of usos) {
      const achadas = analisarCodigo(uso, 'sintetico.ts', RAIZ_CORE)
      expect(achadas.map((v) => v.regra), uso).toContain('fetch global')
    }
  })

  it('não acusa import legítimo dentro do próprio núcleo', () => {
    // Falso positivo aqui é tão destrutivo quanto falso negativo: um guarda que
    // acusa o inocente é desligado na primeira semana, e aí não guarda nada.
    const legitimos: readonly Caso[] = [
      { prefixo: 'import { z } from', especificador: 'zod', dir: DIR_RAIZ },
      { prefixo: 'import { describe, it } from', especificador: 'vitest', dir: DIR_SUB },
      { prefixo: 'import { somar } from', especificador: '../util/numero', dir: DIR_SUB },
      { prefixo: 'import type { Categoria } from', especificador: './tipos', dir: DIR_RAIZ },
      { prefixo: 'import { criarElegivel } from', especificador: '@/core/testes/fabricas', dir: DIR_SUB },
      { prefixo: 'import { readFileSync } from', especificador: 'node:fs', dir: DIR_RAIZ },
    ]

    for (const caso of legitimos) {
      expect(violacoesDe(caso), `acusou import legítimo: ${caso.especificador}`).toEqual([])
    }
  })

  it('não confunde comentário e string com código', () => {
    // Um comentário que MENCIONA a proibição — como os deste arquivo — não é
    // uma violação. Sem esta garantia, documentar a regra quebraria a regra.
    const fonte = [
      `// jamais ${'fetch'}( aqui dentro`,
      `/* nem ${montar('import { PrismaClient } from', '@prisma/client')} */`,
      `const texto = 'react'`,
    ].join('\n')

    expect(analisarCodigo(fonte, 'sintetico.ts', RAIZ_CORE)).toEqual([])
  })
})
