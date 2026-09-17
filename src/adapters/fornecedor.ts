import { z } from 'zod'

/**
 * A fronteira do fornecedor de IA — e SÓ ela.
 *
 * ═══ POR QUE ESTE ARQUIVO EXISTE ═══
 *
 * Até 07/09/2026 esta fronteira morava dentro de `ia-estruturada.ts` com o
 * nome `ClienteDeInterpretacao`, e o nome dizia a verdade da época: havia uma
 * única tarefa de IA no sistema — ler e-mail e devolver item. Quando entrou o
 * assistente, ficou visível que a fronteira nunca foi sobre interpretar
 * e-mail. Ela sempre foi sobre UMA coisa: **como se fala com a API deste
 * fornecedor**.
 *
 * Deixá-la onde estava obrigaria o assistente a importar o módulo de
 * interpretação de e-mail para conseguir falar com um modelo — ou, pior, a
 * escrever a própria chamada ao SDK. A segunda saída é a que mata a
 * independência de fornecedor: no dia em que entrasse um terceiro modelo,
 * seriam dois lugares para acrescentá-lo, e o segundo seria esquecido.
 *
 * ═══ A REGRA QUE ESTE ARQUIVO PROTEGE ═══
 *
 * Nenhum fornecedor de IA é premissa deste sistema. Cada um é um arquivo
 * `ia-<nome>.ts` com exatamente duas coisas: como falar com a API dele
 * (`ClienteDeModelo`) e como ele se descreve (`PerfilDoFornecedor`). Quem
 * escolhe é a fábrica, a partir de `IA_ADAPTER`. Ninguém mais importa uma
 * implementação concreta.
 *
 * Se acrescentar um fornecedor exigir tocar em `servicos/`, `app/` ou `core/`,
 * a fronteira quebrou — conserte a fronteira, não o chamador.
 */

/**
 * Como se fala com a API de um fornecedor.
 *
 * UMA função, e nenhuma política dentro dela. Truncar, detectar injeção,
 * delimitar, repetir, validar, distinguir falha de transporte de falha de
 * formato — nada disso mora aqui: é política DESTE sistema e vale igual para
 * qualquer modelo. Aqui só cabe o que muda de fornecedor para fornecedor.
 *
 * O `esquema` viaja junto porque cada fornecedor o aproveita de um jeito: a
 * Anthropic aceita o Zod direto e devolve objeto já validado; o Gemini recebe
 * a forma como texto nas instruções (o `responseJsonSchema` dele não aceita o
 * nosso schema — ver `ia-gemini.ts`). Nos dois casos a FONTE é a mesma, e é
 * isso que impede duas descrições da mesma forma divergirem em silêncio.
 */
export interface ClienteDeModelo {
  gerar(entrada: {
    instrucoes: string
    conteudo: string
    modelo: string
    /** A forma esperada. Fonte única — nunca redigite um schema por fornecedor. */
    esquema: z.ZodType
  }): Promise<{ objeto: unknown; modeloUsado: string }>
}

/**
 * O que cada fornecedor precisa dizer sobre si.
 *
 * Três coisas, e nenhuma delas é lógica: como se chama, que modelo usa quando
 * ninguém escolhe, e como reconhecer uma credencial recusada no SDK dele.
 */
export interface PerfilDoFornecedor {
  /** Vai para `Item.modeloIa` e para o log. É o mesmo valor de `IA_ADAPTER`. */
  readonly nome: string
  /**
   * Muda quando o prompt de INTERPRETAÇÃO muda.
   *
   * O prefixo é o fornecedor porque a mesma redação rende resultados
   * diferentes em modelos diferentes: sem ele, a medida de acerto somaria duas
   * populações distintas sob um rótulo só, e a comparação entre fornecedores —
   * que é a razão de existir um segundo — ficaria impossível sobre o histórico.
   */
  readonly versaoPrompt: string
  /** Modelo usado quando `IA_MODELO` não diz nada. Cada fornecedor tem o seu. */
  readonly modeloPadrao: string
  /**
   * Credencial recusada é sistema mal configurado, nunca defeito desta chamada.
   *
   * Cada SDK sinaliza isso à sua maneira, e é a única parte do tratamento de
   * erro que não dá para escrever uma vez só.
   */
  ehCredencialRecusada(erro: unknown): boolean
  /**
   * Conta sem crédito ou cota do dia esgotada — também é sistema fora, não
   * defeito desta chamada (achado C-06).
   *
   * Separado de `ehCredencialRecusada` porque a causa e o conserto são
   * outros: uma se resolve trocando a chave, a outra pagando ou esperando o
   * dia virar. E porque a forma de reconhecer é frágil — a Anthropic manda
   * `400` com texto, e o Gemini manda `429`, que também é usado para limite
   * por minuto. Um perfil que não saiba reconhecer nada simplesmente não
   * implementa: o erro segue como falha de transporte, e o disjuntor cuida.
   */
  ehSemCredito?(erro: unknown): boolean
}

/**
 * Que tipo de problema aconteceu.
 *
 * A distinção decide se vale repetir. Antes havia um `catch` só, e um timeout
 * virava "rejeitada pela validação" no log e — pior — no PRÓPRIO PROMPT da
 * segunda tentativa, pedindo ao modelo que corrigisse um erro de rede. Log que
 * mente é log que ninguém usa quando o sistema quebra.
 */
export type EspecieDeFalha = 'validacao' | 'transporte'

export function especieDoErro(erro: unknown): EspecieDeFalha {
  // Só erro de FORMATO vale repetir: dito qual campo saiu do esquema, o modelo
  // costuma acertar na segunda. Timeout, 429, 500, resposta truncada e recusa
  // por política não se resolvem reescrevendo o pedido — repetir seria gastar
  // uma segunda chamada já condenada.
  return erro instanceof z.ZodError ? 'validacao' : 'transporte'
}

/**
 * O texto do modelo, lido como JSON — com a falha virando erro de FORMA.
 *
 * Erro de sintaxe precisa ser distinguível de falha de transporte: os dois
 * são falha, mas só o de formato vale uma nova tentativa (`especieDoErro`).
 *
 * SEM `input: texto` no issue, e isto é segurança, não economia.
 * `ZodError.message` é `JSON.stringify(issues)`, e o replacer do Zod só remove
 * `input` dos issues que ele mesmo cria — um issue escrito à mão preserva o
 * campo. Com `input: texto`, a resposta CRUA do modelo (derivada do corpo do
 * e-mail, com nome e CPF do associado) entrava na mensagem do erro, dali no
 * log, que não tem retenção, e nas INSTRUÇÕES da segunda tentativa, fora dos
 * marcadores de conteúdo não confiável. Para corrigir o formato, o modelo
 * precisa saber que a resposta não era JSON; não precisa que a devolvam a ele.
 */
export function lerRespostaJson(texto: string): unknown {
  try {
    return JSON.parse(texto)
  } catch {
    throw new z.ZodError([
      {
        code: 'custom',
        path: [],
        message: `a resposta não é JSON válido (${texto.length} caracteres)`,
      },
    ])
  }
}

/**
 * A forma esperada, dita ao modelo em texto.
 *
 * Para fornecedor cujo suporte a JSON Schema não cobre a forma inteira. A
 * derivação é do MESMO Zod que valida a resposta depois — não uma segunda
 * descrição redigitada à mão, que é a dívida `H-D7` na camada onde ela custaria
 * mais caro: as duas formas divergiriam em silêncio e a validação passaria a
 * aceitar o que o prompt não pediu.
 *
 * `$schema` sai porque é metadado do documento, não parte da forma, e só
 * gastaria tokens.
 */
export function formaEsperadaEmTexto(esquema: z.ZodType): string {
  const { $schema: _ignorado, ...forma } = z.toJSONSchema(esquema, {
    io: 'output',
  }) as Record<string, unknown>

  return `\n\nFORMATO DA RESPOSTA\nResponda com UM objeto JSON, sem texto em volta, sem cercas de código, obedecendo exatamente a este JSON Schema:\n${JSON.stringify(forma)}`
}
