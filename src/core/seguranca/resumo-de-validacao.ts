import { z } from 'zod'

/**
 * O que se pode contar ao modelo — e ao log — sobre uma resposta malformada.
 *
 * ═══ O DEFEITO QUE ISTO CONSERTA ═══
 *
 * A repetição da chamada montava as instruções assim:
 *
 *     `${INSTRUCOES}\n\nA tentativa anterior foi rejeitada pela validação: ${erro.message}`
 *
 * `erro.message` de um `ZodError` é `JSON.stringify(issues)`, e os `issues`
 * carregam texto que veio DE FORA. Medido neste repositório, com o zod
 * instalado, por dois caminhos independentes:
 *
 *   (a) O adapter Gemini fabricava um `ZodError` com `input: texto`, onde
 *       `texto` era a resposta CRUA do modelo — até 16 mil tokens derivados do
 *       corpo do e-mail. O campo sobrevive em `message`: nome, CPF e CRM
 *       extraídos do associado apareciam inteiros.
 *
 *   (b) Sem depender de fornecedor: `campos` é um mapa cujas CHAVES o modelo
 *       escolhe. Uma chave acima de 60 caracteres gera `invalid_key`, e o
 *       `path` da issue traz a chave LITERAL. Uma chave de 77 caracteres
 *       escrita como ordem — confirmado — atravessava inteira.
 *
 * Em ambos, o texto do remetente terminava colado na região de INSTRUÇÕES da
 * segunda chamada: **fora** dos marcadores `<<<CONTEUDO_NAO_CONFIAVEL>>>`, no
 * mesmo bloco que as regras do sistema, e ainda seguido de "devolva o mesmo
 * conteúdo corrigido". É a fresta exata que as três camadas existem para não
 * deixar existir (invariantes 6 e 12): uma injeção que a delimitação continha
 * saía do bloco de dados e voltava com autoridade de sistema.
 *
 * O mesmo `message` ia para `registrarLog`. `redigir()` redige por NOME de
 * chave, e aqui o conteúdo é um blob de string sob a chave `causa` — nada era
 * redigido, e log não tem política de retenção (invariante 11).
 *
 * ═══ A REGRA ═══
 *
 * Para corrigir o FORMATO, o modelo precisa saber o que estava errado na
 * forma — não o que ele respondeu. Este resumo devolve apenas isso: o código do
 * defeito e o caminho até o campo, com todo segmento que o modelo possa ter
 * escolhido substituído por um marcador. Nunca `input`, nunca a mensagem crua,
 * nunca uma chave de mapa.
 */

/**
 * Nomes de campo que o NOSSO esquema declara.
 *
 * Um segmento de caminho só sai daqui verbatim se for um identificador simples
 * — que é a forma de todo campo nosso (`itens`, `confianca`, `categoriaCodigo`)
 * — ou um índice. Tudo mais é chave escolhida pelo modelo, e vira marcador.
 *
 * A checagem é por FORMA e não por lista fechada de propósito: uma lista
 * envelheceria a cada campo novo do esquema, e envelhecer aqui significa voltar
 * a vazar.
 */
const IDENTIFICADOR_SIMPLES = /^[A-Za-z][A-Za-z0-9_]{0,39}$/

function segmentoSeguro(segmento: PropertyKey): string {
  if (typeof segmento === 'number') return String(segmento)
  const texto = String(segmento)
  return IDENTIFICADOR_SIMPLES.test(texto) ? texto : '<chave-recusada>'
}

/** Teto do resumo inteiro. Dez defeitos já dizem tudo; mil seriam um novo canal. */
const MAXIMO_DE_PROBLEMAS = 10
const MAXIMO_DE_CARACTERES = 600

/**
 * Descrição do defeito de forma, segura para entrar em prompt e em log.
 *
 * Para erro que não é de validação devolve só o nome da classe: a mensagem crua
 * de um erro de transporte é do fornecedor, não do remetente, mas também não
 * tem por que entrar num prompt — e transporte nunca gera nova tentativa.
 */
export function resumoDeValidacao(erro: unknown): string {
  if (!(erro instanceof z.ZodError)) {
    return erro instanceof Error ? erro.name : 'erro inesperado'
  }

  const problemas = erro.issues.slice(0, MAXIMO_DE_PROBLEMAS).map((problema) => {
    const caminho = problema.path.map(segmentoSeguro).join('.') || '(raiz)'
    // Só o CÓDIGO, nunca `problema.message`: a mensagem do Zod interpola
    // valores recebidos ("Invalid option: expected one of ...") e é justamente
    // por onde o conteúdo de fora voltaria a passar.
    return `${caminho}: ${problema.code}`
  })

  const restantes = erro.issues.length - problemas.length
  const cauda = restantes > 0 ? `; e mais ${restantes}` : ''

  return `${problemas.join('; ')}${cauda}`.slice(0, MAXIMO_DE_CARACTERES)
}
