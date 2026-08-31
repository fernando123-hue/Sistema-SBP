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
 * Até aqui essa regra era sustentada só por disciplina. Disciplina não sobrevive
 * a um dia corrido: basta UM `import { prisma }` dentro do motor para que os
 * testes do núcleo passem a exigir banco, o tempo de suíte salte de
 * milissegundos para dezenas de segundos, e a suíte lenta comece a ser pulada —
 * que é exatamente como a conservação deixa de ser verificada. A regressão não
 * aparece como erro; aparece como lentidão que alguém contorna.
 *
 * ESTE GUARDA É UM ALLOWLIST, NÃO UM DENYLIST — e a distinção é a diferença
 * entre proteger e parecer que protege. A primeira versão listava os proibidos
 * (Prisma, React, Next) e por isso deixava passar tudo o que não estava na
 * lista: `@anthropic-ai/sdk` (que já está instalado neste projeto), qualquer
 * cliente HTTP, qualquer pacote novo, e builtins como `node:https` ou
 * `node:child_process` — rede e processo dentro do domínio, com a suíte verde.
 * Denylist protege contra o que já se imaginou; allowlist protege contra o que
 * ninguém imaginou ainda, que é justamente de onde vem a regressão.
 *
 * DECISÃO SOBRE OS PRÓPRIOS TESTES: eles NÃO são excluídos da varredura. Os
 * testes de `core/` importam hoje apenas `vitest` e irmãos — verificado antes
 * de escrever a regra, portanto incluí-los não custa nada agora. E excluí-los
 * abriria justamente o buraco que interessa fechar: um teste do núcleo que
 * monta cenário via Prisma arrasta o banco para dentro da camada pura pela
 * porta dos fundos e legitima a exceção. O teste do domínio puro também é
 * código do domínio puro — este arquivo inclusive, que se varre a si mesmo.
 */

const RAIZ_CORE = dirname(fileURLToPath(import.meta.url))
const RAIZ_SRC = dirname(RAIZ_CORE)
const RAIZ_PROJETO = dirname(RAIZ_SRC)

/**
 * Tudo que um arquivo de PRODUÇÃO do núcleo pode importar de fora do núcleo.
 *
 * Só validação de esquema. `zod` está aqui porque a fronteira de dados do
 * domínio é definida em `esquemas.ts` e o próprio invariante "o que não valida
 * vai para revisão humana, nunca para o motor" depende dela.
 *
 * Nome exato, sem subcaminho e sem prefixo: acrescentar uma dependência de
 * terceiro ao domínio é decisão de arquitetura, e decisão de arquitetura passa
 * por editar esta linha — de propósito.
 */
const PERMITIDOS_EM_PRODUCAO: readonly string[] = ['zod']

/**
 * O que um arquivo `*.test.ts` do núcleo pode importar além do acima.
 *
 * `vitest` porque sem ele não há teste. Os três builtins porque ESTE arquivo
 * precisa ler o disco para se varrer — e são nomeados um a um, jamais `node:`
 * inteiro: `node:https`, `node:net`, `node:child_process` e `node:worker_threads`
 * continuam violação mesmo em teste. O guarda não pode abrir para si uma porta
 * mais larga do que a que fecha para os outros.
 */
const PERMITIDOS_EM_TESTE: readonly string[] = [
  ...PERMITIDOS_EM_PRODUCAO,
  'vitest',
  'node:fs',
  'node:path',
  'node:url',
]

const REGRA_CAMADA = 'Import que sobe de `core/` para camada externa'
const REGRA_TERCEIRO = 'Dependência externa não permitida no domínio'
const REGRA_REDE = 'fetch global'

const MOTIVO_CAMADA =
  'Seta invertida: `core/` alcançando `servicos/`, `servidor/`, `adapters/`, ' +
  '`app/`, `ports/`, `generated/` ou qualquer coisa fora de si. Basta um destes ' +
  'para o grafo de dependências virar ciclo — e a partir daí não existe mais ' +
  '"núcleo" que possa ser lido, testado ou auditado isoladamente. Se o domínio ' +
  'precisa de algo de fora, quem chama passa como argumento.'

const MOTIVO_REDE =
  'I/O de rede dentro do domínio. Além de tornar o teste lento e instável, ' +
  'esconde uma chamada externa onde se espera cálculo determinístico: a mesma ' +
  'entrada deixaria de produzir a mesma saída, e a auditoria da distribuição ' +
  'perderia o sentido. Rede vive em `src/adapters/`.'

/**
 * O motivo genérico basta para barrar, mas não para ensinar. Quem esbarra em
 * Prisma ou React esbarrou numa fronteira específica, e a mensagem que nomeia
 * a fronteira certa é a que evita a segunda tentativa pelo mesmo caminho.
 */
function motivoDeTerceiro(especificador: string, ehTeste: boolean): string {
  if (especificador === '@prisma/client' || especificador.startsWith('@prisma/')) {
    return (
      'O domínio não conhece persistência. Quem importa Prisma passa a precisar ' +
      'de banco para rodar, e o motor deixa de ser verificável em milissegundos. ' +
      'Persistência entra por `src/servicos/`, que traduz linha de banco em tipo ' +
      'de domínio antes de chamar o núcleo.'
    )
  }
  if (/^(react|react-dom|next)(\/|$)/.test(especificador)) {
    return (
      'Regra de negócio não pode depender de framework de tela. Se depender, ela ' +
      'morre junto com a próxima troca de framework — e a regra de rateio vale ' +
      'mais tempo do que qualquer versão do Next.'
    )
  }
  if (especificador.startsWith('node:') || /^(fs|path|http|https|net|child_process)$/.test(especificador)) {
    return (
      'Builtin do Node dentro do domínio. O núcleo não lê disco, não abre socket ' +
      'e não cria processo: ele recebe dado pronto e devolve decisão. Só ' +
      `${PERMITIDOS_EM_TESTE.filter((p) => p.startsWith('node:')).join(', ')} são ` +
      'aceitos, e apenas em `*.test.ts`, porque a varredura de pureza precisa ler ' +
      'os próprios arquivos. Qualquer outro é I/O disfarçado.'
    )
  }
  if (especificador.startsWith('@anthropic-ai/')) {
    return (
      'SDK de IA dentro do domínio. "IA interpreta, algoritmo decide": a chamada ' +
      'ao modelo vive em `src/adapters/`, a validação da resposta em ' +
      '`esquemas.ts`, e o motor recebe apenas o objeto já validado. Importar o ' +
      'SDK aqui é o primeiro passo para a IA calcular divisão — que é a coisa ' +
      'que este sistema existe para impedir.'
    )
  }
  const permitidos = (ehTeste ? PERMITIDOS_EM_TESTE : PERMITIDOS_EM_PRODUCAO).join(', ')
  return (
    'O núcleo é puro: só depende de si mesmo e do que estiver explicitamente ' +
    `liberado (aqui: ${permitidos}). Dependência nova de terceiro no domínio é ` +
    'decisão de arquitetura, não detalhe de implementação — ela passa a fazer ' +
    'parte do que precisa ser instalado, auditado e mantido para que a regra de ' +
    'negócio rode. Se a dependência é mesmo necessária, use-a em ' +
    '`src/adapters/` ou `src/servicos/` e passe o resultado ao domínio; se ela ' +
    'pertence ao núcleo, acrescente-a a esta lista de propósito, num commit que ' +
    'só faça isso.'
  )
}

interface Violacao {
  readonly arquivo: string
  readonly linha: number
  readonly trecho: string
  readonly regra: string
  readonly motivo: string
}

/**
 * A única pergunta que importa: este import é permitido a partir daqui?
 *
 * Caminho relativo ou alias vale por RESOLUÇÃO, não por texto. Casar a string
 * `../servicos/` pegaria só as camadas que existem hoje; resolver o caminho e
 * exigir que ele caia dentro de `src/core/` pega também as que ainda não foram
 * criadas — e não se engana com `../../generated/prisma` nem com `@/app/x`.
 */
function classificarImport(
  especificador: string,
  dirDoArquivo: string,
  ehTeste: boolean,
): { regra: string; motivo: string } | null {
  const ehCaminho = especificador.startsWith('.') || especificador.startsWith('@/')
  if (ehCaminho) {
    const alvo = especificador.startsWith('@/')
      ? resolve(RAIZ_SRC, especificador.slice(2))
      : resolve(dirDoArquivo, especificador)
    const dentroDoNucleo = alvo === RAIZ_CORE || alvo.startsWith(RAIZ_CORE + sep)
    return dentroDoNucleo ? null : { regra: REGRA_CAMADA, motivo: MOTIVO_CAMADA }
  }

  const permitidos = ehTeste ? PERMITIDOS_EM_TESTE : PERMITIDOS_EM_PRODUCAO
  if (permitidos.includes(especificador)) return null
  return { regra: REGRA_TERCEIRO, motivo: motivoDeTerceiro(especificador, ehTeste) }
}

/**
 * `fetch` global. Buscado por texto, não por import, porque ele não tem import:
 * é a única dependência externa que entra sem deixar rastro no topo do arquivo.
 */
const PADROES_DE_REDE: readonly RegExp[] = [
  /(?<![.\w$])fetch\s*\(/g,
  /\b(?:globalThis|global|window)\s*\.\s*fetch\b/g,
]

/**
 * Estático, dinâmico e `require` — as três portas de entrada. Cobrir só o
 * `import ... from` deixaria a mais fácil de esconder (`await import(...)`)
 * escancarada.
 *
 * Duas restrições que parecem detalhe e não são:
 *
 * 1. As formas ESTÁTICAS são ancoradas em início de sentença (`^`, `;` ou `}`).
 *    Declaração de import só existe em posição de sentença, então ancorar não
 *    perde nada — e evita casar PROSA. Sem a âncora, o nome de teste
 *    "detecta fetch global mesmo sem import" seguido da próxima aspa do arquivo
 *    era lido como `import '<lixo>'`; com denylist o lixo não casava com
 *    proibição nenhuma e passava despercebido, com allowlist ele vira violação
 *    inventada. Foi exatamente o que aconteceu ao inverter a regra.
 * 2. O especificador não pode conter quebra de linha (`[^'"\n]+`). A lista de
 *    ligações de um import multi-linha atravessa linhas; o caminho do módulo,
 *    nunca. Sem isso, uma aspa solta faz o casamento varrer meio arquivo.
 */
const PADROES_DE_IMPORT: readonly RegExp[] = [
  /(?:^|[;}])[ \t]*import\s+[^;'"()]*\bfrom\s*(['"])([^'"\n]+)\1/gm,
  /(?:^|[;}])[ \t]*export\s+[^;'"()]*\bfrom\s*(['"])([^'"\n]+)\1/gm,
  /(?:^|[;}])[ \t]*import\s*(['"])([^'"\n]+)\1/gm,
  // Expressões: podem aparecer em qualquer posição, então não se ancoram.
  /\bimport\s*\(\s*(['"])([^'"\n]+)\1/g,
  /\brequire\s*\(\s*(['"])([^'"\n]+)\1/g,
]

function listarArquivosTs(diretorio: string): string[] {
  const encontrados: string[] = []
  for (const entrada of readdirSync(diretorio, { withFileTypes: true })) {
    const caminho = join(diretorio, entrada.name)
    if (entrada.isDirectory()) encontrados.push(...listarArquivosTs(caminho))
    else if (entrada.isFile() && /\.tsx?$/.test(entrada.name)) encontrados.push(caminho)
  }
  return encontrados
}

const INICIO_DE_REGEX = /(?:^|[([{,;:=!&|?+\-*%~^<>])\s*$|\b(?:return|typeof|case|in|of|do|else|yield|await|delete|void|new)\s*$/

/**
 * Apaga comentários preservando as quebras de linha (a linha reportada precisa
 * continuar batendo com o arquivo real).
 *
 * Sem isto, um comentário que MENCIONA a proibição — como os deste arquivo —
 * seria acusado como violação, e um teste que acusa o inocente é desligado na
 * primeira semana.
 *
 * O estado `regex` existe por um defeito concreto: sem ele, um literal de
 * expressão regular com aspas ímpares, como `/'/`, jogava a máquina em modo
 * string e, dali em diante, comentário nenhum era apagado — o arquivo inteiro
 * virava campo minado de falso positivo. A versão anterior só funcionava porque
 * as aspas das regexes existentes se equilibravam por acaso; isso é paridade de
 * sorte, não correção.
 *
 * LIMITE ASSUMIDO: distinguir `/` de divisão de `/` de regex exige o contexto
 * do parser, e aqui isso é heurística (o caractere significativo anterior).
 * Se ela errar, o dano é limitado a uma linha — um literal de regex nunca
 * atravessa quebra de linha, então o estado sempre volta ao normal na linha
 * seguinte. Preferiu-se heurística contida a parser completo: o custo de um
 * parser é permanente, e o desta imprecisão é uma linha.
 */
function removerComentarios(codigo: string): string {
  let resultado = ''
  let i = 0
  let estado: 'codigo' | 'linha' | 'bloco' | 'aspas' | 'apostrofo' | 'template' | 'regex' =
    'codigo'
  let dentroDeClasse = false

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
      if (c === '/' && INICIO_DE_REGEX.test(resultado)) {
        estado = 'regex'
        dentroDeClasse = false
        resultado += c
        i += 1
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

    if (estado === 'regex') {
      resultado += c
      if (c === '\\') {
        resultado += codigo[i + 1] ?? ''
        i += 2
        continue
      }
      // Quebra de linha em estado `regex` significa que a heurística errou:
      // volta ao normal para que o erro não contamine o resto do arquivo.
      if (c === '\n') estado = 'codigo'
      else if (c === '[') dentroDeClasse = true
      else if (c === ']') dentroDeClasse = false
      else if (c === '/' && !dentroDeClasse) estado = 'codigo'
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
  const ehTeste = /\.test\.tsx?$/.test(arquivo)
  const violacoes: Violacao[] = []
  const jaVistos = new Set<string>()

  for (const padrao of PADROES_DE_IMPORT) {
    padrao.lastIndex = 0
    let achado: RegExpExecArray | null = padrao.exec(codigo)
    while (achado !== null) {
      const especificador = achado[2] ?? ''
      const linha = linhaDe(codigo, achado.index)
      const chave = `${linha}|${especificador}`
      if (!jaVistos.has(chave)) {
        const problema = classificarImport(especificador, dirDoArquivo, ehTeste)
        if (problema !== null) {
          jaVistos.add(chave)
          violacoes.push({ arquivo, linha, trecho: especificador, ...problema })
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
        regra: REGRA_REDE,
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
    'A regra: `src/core/` só importa a si mesmo e o que está explicitamente ' +
    `liberado (produção: ${PERMITIDOS_EM_PRODUCAO.join(', ')}; testes: ` +
    `${PERMITIDOS_EM_TESTE.join(', ')}). As setas apontam só para dentro ` +
    '(app → servicos → core).\n' +
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
    expect(arquivos.some((a) => a.endsWith(`core${sep}esquemas.ts`))).toBe(true)
  })

  it('nenhum arquivo importa fora do permitido nem usa fetch', () => {
    const violacoes = arquivos.flatMap(analisar)
    if (violacoes.length > 0) {
      throw new Error(montarMensagem(violacoes))
    }
  })

  /**
   * Um detector que nunca acusou ninguém não prova nada: um regex
   * "simplificado" aqui dentro deixaria a suíte verde para sempre sem proteger
   * nada.
   *
   * Os casos são MONTADOS por interpolação, nunca escritos como literal
   * completo. Não é preciosismo: este arquivo mora em `src/core/` e se varre a
   * si mesmo, então um `import { X } from 'y'` escrito por extenso aqui é uma
   * violação de verdade aos olhos da varredura. E com allowlist isso ficou mais
   * agudo do que era com denylist — antes, um especificador estranho extraído
   * de um literal simplesmente não casava com nenhuma proibição; agora, tudo
   * que não está liberado é violação, inclusive o fragmento sem sentido que a
   * regex arranca do meio de uma fixture. O viés é proposital: erra para o lado
   * de acusar, nunca para o de deixar passar.
   */
  type Forma = 'estatico' | 'efeito' | 'dinamico' | 'require'

  interface Caso {
    readonly forma: Forma
    /** O que o import traz, só para a forma estática (`{ x }`, `Algo`, `type { T }`). */
    readonly ligacao?: string
    readonly especificador: string
    /** De onde o import parte — caminho relativo só significa algo com origem. */
    readonly dir: string
    /** O nome decide o allowlist: `*.test.ts` pode mais que arquivo de produção. */
    readonly arquivo: string
  }

  function montar(caso: Caso): string {
    const alvo = JSON.stringify(caso.especificador)
    switch (caso.forma) {
      case 'estatico':
        return `import ${caso.ligacao ?? 'algo'} from ${alvo}`
      case 'efeito':
        return `import ${alvo}`
      case 'dinamico':
        return `const mod = await import(${alvo})`
      case 'require':
        return `const mod = require(${alvo})`
    }
  }

  const DIR_RAIZ = RAIZ_CORE
  const DIR_SUB = join(RAIZ_CORE, 'distribuicao')

  function violacoesDe(caso: Caso): Violacao[] {
    return analisarCodigo(montar(caso), caso.arquivo, caso.dir)
  }

  /** Atalho para o caso mais comum, que é a maioria das fixtures. */
  function estatico(
    ligacao: string,
    especificador: string,
    arquivo: string,
    dir: string = RAIZ_CORE,
  ): Caso {
    return { forma: 'estatico', ligacao, especificador, arquivo, dir }
  }

  it('detecta as violações que promete detectar', () => {
    const proibidos: readonly Caso[] = [
      // Camada externa, reconhecida por RESOLUÇÃO de caminho e não por texto:
      // casar a string "../servicos/" pegaria só as camadas que existem hoje.
      estatico('{ distribuirDoDia }', '../servicos/distribuicao', 'motor.ts'),
      estatico('{ logar }', '@/servidor/log', 'motor.ts', DIR_SUB),
      estatico('{ prisma }', '../../generated/prisma', 'motor.ts', DIR_SUB),
      { forma: 'efeito', especificador: '@/app/registrar', arquivo: 'motor.ts', dir: DIR_RAIZ },
      { forma: 'dinamico', especificador: '../adapters/email', arquivo: 'motor.ts', dir: DIR_RAIZ },
      { forma: 'require', especificador: '../ports/relogio', arquivo: 'motor.ts', dir: DIR_RAIZ },
      // Pacotes: o allowlist barra os suspeitos de sempre...
      estatico('{ PrismaClient }', '@prisma/client', 'motor.ts'),
      estatico('{ useState }', 'react', 'motor.ts'),
      estatico('{ NextResponse }', 'next/server', 'motor.ts'),
      // ...e sobretudo os que nenhum denylist teria previsto. O SDK de IA já
      // está instalado neste projeto: sob a regra antiga, este import passava
      // verde e o motor puro ganhava uma dependência de rede sem ninguém ver.
      estatico('Anthropic', '@anthropic-ai/sdk', 'motor.ts'),
      estatico('axios', 'axios', 'motor.ts'),
      // Builtin de rede e de processo — "sem banco, sem rede" tem de valer
      // também para o que vem embutido no Node, inclusive dentro de teste.
      estatico('{ get }', 'node:https', 'motor.ts'),
      estatico('{ execSync }', 'node:child_process', 'motor.test.ts', DIR_SUB),
      estatico('{ connect }', 'node:net', 'motor.test.ts', DIR_SUB),
      // `node:fs` e `vitest` são liberados só em `*.test.ts`; em produção, não.
      estatico('{ readFileSync }', 'node:fs', 'motor.ts', DIR_SUB),
      estatico('{ describe }', 'vitest', 'motor.ts', DIR_SUB),
      // Subcaminho de pacote liberado não é o pacote liberado.
      estatico('{ z }', 'zod/v4-mini', 'motor.ts'),
    ]

    for (const caso of proibidos) {
      const achadas = violacoesDe(caso)
      expect(achadas.length, `não detectou a violação: ${caso.especificador}`).toBeGreaterThan(0)
      // A mensagem precisa nomear arquivo, linha e import — sem isso o vermelho
      // só diz "algo está errado", e alguém apaga o teste em vez do defeito.
      const mensagem = montarMensagem(achadas)
      expect(mensagem).toContain(`${caso.arquivo}:1`)
      expect(mensagem).toContain(caso.especificador)
      expect(mensagem).toContain('por quê:')
    }
  })

  it('detecta fetch global mesmo sem import', () => {
    // `fetch` é a única dependência externa que entra sem deixar rastro no topo
    // do arquivo. Montado por interpolação para não acusar este arquivo.
    const usos = [`const r = await ${'fetch'}(url)`, `const r = globalThis.${'fetch'}(url)`]
    for (const uso of usos) {
      const achadas = analisarCodigo(uso, 'motor.ts', RAIZ_CORE)
      expect(
        achadas.map((v) => v.regra),
        uso,
      ).toContain(REGRA_REDE)
    }
  })

  it('não acusa import legítimo dentro do próprio núcleo', () => {
    // Falso positivo aqui é tão destrutivo quanto falso negativo: um guarda que
    // acusa o inocente é desligado na primeira semana, e aí não guarda nada.
    const legitimos: readonly Caso[] = [
      estatico('{ z }', 'zod', 'esquemas.ts'),
      estatico('{ somar }', '../util/numero', 'motor.ts', DIR_SUB),
      estatico('type { Categoria }', './tipos', 'config.ts'),
      estatico('{ criarElegivel }', '@/core/testes/fabricas', 'motor.test.ts', DIR_SUB),
      estatico('{ describe, it }', 'vitest', 'motor.test.ts', DIR_SUB),
      estatico('{ readFileSync }', 'node:fs', 'pureza.test.ts'),
      estatico('{ join }', 'node:path', 'pureza.test.ts'),
      estatico('{ fileURLToPath }', 'node:url', 'pureza.test.ts'),
    ]

    for (const caso of legitimos) {
      expect(violacoesDe(caso), `acusou import legítimo: ${caso.especificador}`).toEqual([])
    }
  })

  it('não confunde comentário, string nem literal de regex com código', () => {
    // Os dois primeiros casos: documentar a regra não pode quebrar a regra.
    // O terceiro é o defeito concreto que o estado `regex` do stripper previne —
    // uma regex de aspas ímpares deixava a máquina de estado presa em "string",
    // e daí em diante todo comentário do arquivo virava código aos olhos da
    // varredura. Sem este caso, a regressão volta calada na primeira regex de
    // apóstrofo que alguém escrever no núcleo.
    const fonte = [
      `// jamais ${'fetch'}( aqui dentro`,
      `/* nem ${montar(estatico('{ PrismaClient }', '@prisma/client', 'x.ts'))} */`,
      `const texto = 'react'`,
      `const APOSTROFO = /'/`,
      `// ${montar(estatico('Anthropic', '@anthropic-ai/sdk', 'x.ts'))} tampouco`,
      `const ASPAS = /"/`,
      `const DIVISAO = (a + b) / 2 / 3`,
      // Prosa que TERMINA na palavra import, seguida de outra aspa adiante: era
      // lida como import de efeito colateral de um especificador inventado.
      `it('detecta fetch global mesmo sem import', () => { const a = 'b' })`,
      `// ${montar({ forma: 'require', especificador: '../servicos/x', arquivo: 'x.ts', dir: RAIZ_CORE })}`,
    ].join('\n')

    expect(analisarCodigo(fonte, 'motor.ts', RAIZ_CORE)).toEqual([])
  })

  it('não deixa a heurística de regex esconder import da linha seguinte', () => {
    // O risco espelhado do caso acima: se a máquina de estado entrasse em modo
    // regex e não saísse, o import seguinte sumiria da varredura — falso
    // negativo, que é pior que falso positivo porque não faz barulho.
    const fonte = [
      `const razao = total / 2`,
      montar(estatico('Anthropic', '@anthropic-ai/sdk', 'motor.ts')),
    ].join('\n')

    const achadas = analisarCodigo(fonte, 'motor.ts', RAIZ_CORE)
    expect(achadas.map((v) => v.trecho)).toEqual(['@anthropic-ai/sdk'])
    expect(achadas[0]?.linha).toBe(2)
  })
})
