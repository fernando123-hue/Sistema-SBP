import { normalizarCpf } from './chave-de-busca'
import { nomeDeCampoGravavel } from './nome-de-campo'

/**
 * Conferência do que a IA extraiu, contra o texto do e-mail — domínio puro
 * (pendência 17, `DECISOES.md § H.4` item 40).
 *
 * ═══ O PROBLEMA ═══
 *
 * O prompt manda extrair "apenas o que estiver LITERALMENTE no texto", e nada
 * conferia isso depois. O modelo local escolhido tem literalidade 0,69 no
 * gabarito (`A59`): reescreve em vez de copiar. Um nome reescrito, um CPF com
 * um dígito a menos, com confiança acima do limiar, entravam APROVADOS — e o
 * item ia para a fila de alguém com o dado errado. A confiança é a própria IA
 * que dá; ela não prova nada sobre o valor.
 *
 * ═══ A REGRA (aprovada pelo dono em 29/09/2026) ═══
 *
 * O valor precisa aparecer no e-mail ignorando maiúsculas, espaços e acentos;
 * número se compara só pelos dígitos. Concretamente, os dois lados viram uma
 * sequência de "átomos" — palavras e números, sem acento, em minúsculas, com
 * pontuação e espaço descartados — e o valor precisa ser uma sequência
 * CONTÍGUA de átomos do texto:
 *
 *   - palavra casa com palavra INTEIRA: "Ana Souza" não passa dentro de
 *     "Mariana Souza" (um "includes" de texto deixaria passar, e é justamente
 *     a reescrita que se quer pegar);
 *   - número casa com um ou mais números SEGUIDOS do texto, juntos por
 *     inteiro: "12345678909" casa com "123.456.789-09" e "11987654321" com
 *     "(11) 98765-4321" — mas "1234567890", o CPF sem o último dígito, não
 *     casa com nada, porque cortaria um grupo ao meio.
 *
 * A pontuação é tratada como espaço, e isto vai um passo além da letra do
 * critério aprovado: "Silva," no texto é "Silva" no valor. E um passo mais
 * apertado: "ignorar espaços" vira "palavra por palavra", então "MariaSouza"
 * e "Maria Souza" não casam — é o preço de barrar "Ana Souza" dentro de
 * "Mariana Souza". Endereço de e-mail é exceção: comparado inteiro.
 *
 * ═══ O QUE ELA NÃO FAZ ═══
 *
 * Decidir. Devolve o PRIMEIRO problema achado, e quem chama manda o item para
 * a Revisão com esse motivo. Não corrige o valor, não escolhe outro trecho do
 * texto, não descarta o item: quem revisa vê a sugestão da IA e decide.
 */

/**
 * `conferencia_incompleta`: o orçamento do e-mail acabou antes de a conta
 * terminar. O item vai para uma pessoa do mesmo jeito (falha fechada), mas
 * dizer "dado não encontrado no e-mail" de um valor que pode estar lá seria
 * mentir para quem revisa (invariante 7; 2ª rodada de segurança do #150).
 */
export type MotivoDaConferencia = 'cpf_invalido' | 'valor_fora_do_texto' | 'conferencia_incompleta'

export interface ProblemaNaExtracao {
  readonly motivo: MotivoDaConferencia
  /** O nome do campo como a IA o escreveu, ou `CAMPO_DA_LIGA` para a liga mencionada. */
  readonly campo: string
}

/**
 * Abaixo disto, "estar no e-mail" não prova nada: "de" e "da" estão em
 * qualquer texto. O valor curto não é conferido — nem acusado. Mesmo corte do
 * gabarito (`core/avaliacao/gabarito.ts`), contado em letras e dígitos.
 */
export const TAMANHO_MINIMO_CONFERIDO = 3

/**
 * Quantos números seguidos do texto podem se juntar para casar com um número
 * do valor. CPF formatado são 4 grupos, telefone com DDD até 4, data 3; 6 dá
 * folga e põe teto no custo.
 */
const MAIOR_JUNCAO_DE_NUMEROS = 6

/**
 * Quanto trabalho a conferência pode fazer por e-mail, em comparações de átomo.
 *
 * O texto é do remetente. "1 " repetido cem mil vezes, com uma lista de
 * pessoas que a IA desdobra sozinha, levava dezenas de segundos de CPU
 * síncrona e parava o servidor para todo mundo (revisões do #150). Dois
 * milhões de passos são dezenas de milissegundos. Estourou, o valor conta como
 * NÃO achado e o item vai para uma pessoa: falha fechada, nunca aprovação.
 */
export const PASSOS_POR_EMAIL = 2_000_000

interface Atomo {
  readonly digitos: boolean
  readonly valor: string
}

/**
 * Sem acento, sem forma de compatibilidade, e em minúsculas que dobram de
 * verdade. A caixa vem ANTES de tirar os acentos: "ẞ" só vira "ss" passando
 * por minúscula e maiúscula ("ẞ" → "ß" → "SS"), e "İ" em minúscula traz um
 * ponto combinante que a limpeza de acentos precisa ver depois (2ª rodada do
 * #150). A minúscula do fim é porque a forma de compatibilidade pode devolver
 * maiúscula ("ᴬ" → "A"). O "°" (grau) escrito no lugar do "º" (ordinal) vira
 * "o": no teclado, são o mesmo gesto.
 */
function dobrar(texto: string): string {
  return texto
    .toLowerCase()
    .toUpperCase()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/°/g, 'o')
    .toLowerCase()
}

/**
 * Palavras, números e o "@". O "@" é átomo próprio, e não pontuação: sem
 * ele, "ana @souza.exemplo.test" virava os mesmos átomos de
 * "ana.souza@exemplo.test" e passava como o endereço do texto (3ª rodada do
 * #150).
 */
function atomos(texto: string): Atomo[] {
  const lista: Atomo[] = []
  for (const achado of dobrar(texto).matchAll(/\p{L}+|\p{Nd}+|@/gu)) {
    lista.push({ digitos: /^\p{Nd}/u.test(achado[0]), valor: achado[0] })
  }
  return lista
}

/** Números seguidos no VALOR viram um só: "123.456.789-09" é "12345678909". */
function atomosDoValor(valor: string): Atomo[] {
  const juntos: Atomo[] = []
  for (const atomo of atomos(valor)) {
    const anterior = juntos.at(-1)
    if (atomo.digitos && anterior?.digitos) {
      juntos[juntos.length - 1] = { digitos: true, valor: anterior.valor + atomo.valor }
    } else {
      juntos.push(atomo)
    }
  }
  return juntos
}

/**
 * Endereço de e-mail é comparado INTEIRO, com a pontuação dele. Tratando
 * pontuação como espaço, "ana@souza.exemplo.test" casava com
 * "ana.souza@exemplo.test" — outro endereço, e alguém vai responder para ele
 * (revisão técnica do #150).
 *
 * Os endereços saem por SEPARAÇÃO, e não por uma expressão `[^…]+@[^…]+`:
 * aquela voltava atrás a cada posição de um trecho longo sem `@`, e 200 mil
 * letras seguidas levavam 45 s, fora de qualquer orçamento (2ª rodada do
 * #150). Separar é linear.
 */
// Sem apóstrofo: ele é válido no endereço ("joana.d'avila@…"), e cortar ali
// fazia "avila@…", OUTRO endereço, passar (2ª rodada de segurança do #150).
// Aspas simples em volta do endereço saem pela limpeza das pontas.
const SEPARADOR_DE_ENDERECO = /[\s<>()[\],;:"“”«»/|!?]+/u

const LETRA_OU_DIGITO = /[\p{L}\p{Nd}]/u

/**
 * Tira das pontas o que não é letra nem dígito (o ponto final da frase).
 * Por laço, e não por `[^…]+$`: essa expressão volta atrás em cada ponto de
 * "a.....a" e fica quadrática no pedaço que o remetente escolher. E por
 * PONTO DE CÓDIGO: a metade de um par substituto não é letra, e uma letra
 * fora do plano básico ("𐐨ana@x.test") era cortada da ponta (3ª rodada).
 */
function limparEndereco(endereco: string): string {
  const pontos = Array.from(endereco)
  let inicio = 0
  let fim = pontos.length
  while (inicio < fim && !LETRA_OU_DIGITO.test(pontos[inicio]!)) inicio += 1
  while (fim > inicio && !LETRA_OU_DIGITO.test(pontos[fim - 1]!)) fim -= 1
  return pontos.slice(inicio, fim).join('')
}

const ENDERECO_UNICO = /^[^@]+@[^@]+$/u

/** Os pedaços com cara de endereço: algo antes e algo depois do `@`. */
function enderecosEm(textoDobrado: string): string[] {
  return textoDobrado
    .split(SEPARADOR_DE_ENDERECO)
    .map(limparEndereco)
    .filter((pedaco) => ENDERECO_UNICO.test(pedaco))
}

/**
 * O perfil ("@liga.pediatria") de um pedaço: um "@" só, na frente, sem letra
 * nem dígito antes, e algo depois. Sem o "@". Qualquer outra forma, `null`.
 */
function perfilDoPedaco(pedaco: string): string | null {
  const arroba = pedaco.indexOf('@')
  if (arroba < 0 || arroba !== pedaco.lastIndexOf('@')) return null
  if (limparEndereco(pedaco.slice(0, arroba)) !== '') return null
  const perfil = limparEndereco(pedaco.slice(arroba + 1))
  return perfil === '' ? null : perfil
}

/** Os perfis que o texto cita, para conferir os do valor contra eles. */
function perfisEm(textoDobrado: string): string[] {
  const perfis: string[] = []
  for (const pedaco of textoDobrado.split(SEPARADOR_DE_ENDERECO)) {
    const perfil = pedaco.includes('@') ? perfilDoPedaco(pedaco) : null
    if (perfil !== null) perfis.push(perfil)
  }
  return perfis
}

/**
 * Todo pedaço do valor com "@" tem de estar INTEIRO no texto: o endereço,
 * entre os endereços do texto; o "@perfil", entre os perfis do texto. Barra
 * o que os átomos sozinhos deixam passar:
 * - endereço truncado ("ana.souza@", com "ana.souza@exemplo.test" no texto);
 * - endereço reescrito com espaço antes do "@" ("ana-souza @exemplo.test"),
 *   em que o domínio viraria um "perfil" com os mesmos átomos (4ª rodada);
 * - qualquer outra forma com "@" ("ana@souza@…", "ana@@…").
 */
function arrobasConferem(texto: TextoParaConferir, dobrado: string): boolean {
  for (const pedaco of dobrado.split(SEPARADOR_DE_ENDERECO)) {
    if (!pedaco.includes('@')) continue
    const limpo = limparEndereco(pedaco)
    if (ENDERECO_UNICO.test(limpo)) {
      if (!texto.enderecos.has(limpo)) return false
      continue
    }
    const perfil = perfilDoPedaco(pedaco)
    if (perfil === null || !texto.perfis.has(perfil)) return false
  }
  return true
}

/**
 * O texto do e-mail preparado uma vez para conferir todos os valores dele.
 * Carrega o orçamento de passos e a memória do e-mail: é por e-mail.
 */
export interface TextoParaConferir {
  readonly atomos: readonly Atomo[]
  /** Onde cada palavra aparece — o ponto de partida de um valor que começa por palavra. */
  readonly porPalavra: ReadonlyMap<string, readonly number[]>
  /** Onde cada número aparece, pelo valor dele. */
  readonly porNumero: ReadonlyMap<string, readonly number[]>
  readonly enderecos: ReadonlySet<string>
  readonly perfis: ReadonlySet<string>
  /** Resultado por valor já conferido neste e-mail: listas repetem valores. */
  readonly memoria: Map<string, Achado>
  /**
   * Os comprimentos de número que existem no texto, em ordem. Só um prefixo
   * desses comprimentos pode estar em `porNumero`: recortar os outros era
   * trabalho sem passo (2ª e 3ª rodadas do #150).
   */
  readonly comprimentosDeNumero: readonly number[]
  orcamento: number
}

export function prepararTextoParaConferir(texto: string): TextoParaConferir {
  const lista = atomos(texto)
  const porPalavra = new Map<string, number[]>()
  const porNumero = new Map<string, number[]>()
  lista.forEach((atomo, posicao) => {
    const indice = atomo.digitos ? porNumero : porPalavra
    const posicoes = indice.get(atomo.valor)
    if (posicoes) posicoes.push(posicao)
    else indice.set(atomo.valor, [posicao])
  })
  const textoDobrado = dobrar(texto)
  const enderecos = new Set(enderecosEm(textoDobrado))
  const perfis = new Set(perfisEm(textoDobrado))
  const comprimentosDeNumero = [...new Set(lista.filter((atomo) => atomo.digitos).map((atomo) => atomo.valor.length))].sort(
    (a, b) => a - b,
  )
  return {
    atomos: lista,
    porPalavra,
    porNumero,
    enderecos,
    perfis,
    memoria: new Map(),
    comprimentosDeNumero,
    orcamento: PASSOS_POR_EMAIL,
  }
}

/**
 * O valor casa a partir do átomo `inicio` do texto? Cada comparação gasta um
 * passo do orçamento; sem orçamento, "não casa".
 *
 * Linear: o número do valor casa com UMA junção de números seguidos do texto
 * — a que tem o mesmo comprimento —, então não há escolha a explorar.
 */
function casaAPartirDe(texto: TextoParaConferir, valor: readonly Atomo[], inicio: number, juntar: boolean): boolean {
  let i = inicio
  for (const alvo of valor) {
    if (!alvo.digitos) {
      texto.orcamento -= 1
      const atual = texto.atomos[i]
      if (texto.orcamento < 0 || !atual || atual.digitos || atual.valor !== alvo.valor) return false
      i += 1
      continue
    }
    // Compara no lugar, sem concatenar, e cobra o tamanho de cada número: um
    // número de 100 dígitos repetido custava 100 vezes o passo que pagava
    // (3ª rodada do #150).
    let deslocamento = 0
    let casou = false
    const maximo = juntar ? MAIOR_JUNCAO_DE_NUMEROS : 1
    for (let n = 0; n < maximo; n += 1) {
      const atual = texto.atomos[i + n]
      if (!atual?.digitos) break
      texto.orcamento -= atual.valor.length
      if (texto.orcamento < 0) break
      if (deslocamento + atual.valor.length > alvo.valor.length) break
      if (!alvo.valor.startsWith(atual.valor, deslocamento)) break
      deslocamento += atual.valor.length
      if (deslocamento === alvo.valor.length) {
        i += n + 1
        casou = true
        break
      }
    }
    if (!casou) return false
  }
  return true
}

/**
 * Onde um valor pode começar: as posições da primeira palavra, ou as do número
 * que é começo do primeiro número do valor ("111" em "111.444.777-35").
 * Gerador, e não lista: com cem mil "1" no texto, copiar as posições para
 * cada valor já custava segundos, fora do orçamento (revisões do #150).
 */
function* inicios(texto: TextoParaConferir, primeiro: Atomo, juntar: boolean): Generator<number> {
  if (!primeiro.digitos) {
    yield* texto.porPalavra.get(primeiro.valor) ?? []
    return
  }
  if (!juntar) {
    texto.orcamento -= primeiro.valor.length
    yield* texto.porNumero.get(primeiro.valor) ?? []
    return
  }
  // Só os comprimentos que existem no texto, e cada prefixo recortado custa
  // o seu tamanho: com um número de 200 mil dígitos no texto, 4 mil prefixos
  // de um valor longo somavam segundos sem gastar passo (2ª e 3ª rodadas).
  for (const tamanho of texto.comprimentosDeNumero) {
    if (tamanho > primeiro.valor.length) return
    texto.orcamento -= tamanho
    if (texto.orcamento < 0) return
    yield* texto.porNumero.get(primeiro.valor.slice(0, tamanho)) ?? []
  }
}

/** O valor aparece no texto? Valor curto demais conta como "aparece": não há o que provar. */
export function valorEstaNoTexto(texto: TextoParaConferir, valor: string): boolean {
  return lembrar(texto, valor, false) === 'sim'
}

/**
 * Três respostas, e não duas: "não está" e "não deu para procurar" são
 * coisas diferentes para quem revisa, e a memória guarda qual foi. Deduzir
 * pelo orçamento no momento do rótulo chamava de incompleta uma conta que
 * tinha terminado antes do estouro (3ª rodada do #150).
 */
type Achado = 'sim' | 'nao' | 'incompleto'

function lembrar(texto: TextoParaConferir, valor: string, semIsencao: boolean): Achado {
  // Chaves distintas para as duas regras, com prefixo dos DOIS lados: "SP"
  // isento como campo não vale como liga conferida, e nenhum valor de campo
  // escreve na chave de uma liga (3ª rodada do #150).
  const chave = `${semIsencao ? 'L' : 'C'}${valor}`
  const lembrado = texto.memoria.get(chave)
  if (lembrado !== undefined) return lembrado
  const resultado = conferirValor(texto, valor, semIsencao)
  texto.memoria.set(chave, resultado)
  return resultado
}

function conferirValor(texto: TextoParaConferir, valor: string, semIsencao: boolean): Achado {
  // O próprio valor custa o seu tamanho, antes e depois de dobrar: dobrar,
  // separar e recortar são lineares nele, e a forma de compatibilidade
  // multiplica ("ﷺ" vira 18 caracteres). 1.800 valores longos somavam
  // segundos sem tocar no orçamento (2ª e 3ª rodadas do #150).
  texto.orcamento -= valor.length
  if (texto.orcamento < 0) return 'incompleto'
  const dobrado = dobrar(valor)
  texto.orcamento -= dobrado.length
  if (texto.orcamento < 0) return 'incompleto'

  // Duas conferências, e as duas valem: o endereço tem de estar INTEIRO no
  // texto, e o valor todo — com o endereço dentro, porque o "@" é átomo — tem
  // de aparecer seguido. Tirar o endereço do valor fazia "Ana x@y.test Souza"
  // casar com "Ana Souza" (3ª rodada do #150). O "mailto:" só sai quando vem
  // colado a um endereço; em qualquer outro lugar, é palavra do valor.
  if (!arrobasConferem(texto, dobrado)) return 'nao'
  // A classe exclui os separadores de endereço: "mailto:" atravessando uma
  // vírgula ou um "<" não está colado a endereço nenhum (4ª rodada).
  const semMailto = dobrado.replace(/mailto:(?=[^\s@<>()[\],;:"“”«»/|!?]{1,254}@)/gu, ' ')

  // A liga vira identidade: nela, número casa com número INTEIRO. Juntando,
  // "Liga 12" passava com "Liga 1, 2 e 3" no texto (3ª rodada do #150).
  const juntar = !semIsencao
  const alvo = juntar ? atomosDoValor(semMailto) : atomos(semMailto)
  const tamanho = alvo.reduce((total, atomo) => total + atomo.valor.length, 0)
  // Sem letra nem dígito ("-", "") não há o que conferir: é o modelo dizendo
  // "nenhuma", e nem como liga isso vira identidade (`teto-de-ligas-novas`).
  if (tamanho === 0) return 'sim'
  if (tamanho < TAMANHO_MINIMO_CONFERIDO && !semIsencao) return 'sim'

  for (const inicio of inicios(texto, alvo[0]!, juntar)) {
    // Cada início tentado custa um passo, mesmo o que falha na primeira
    // comparação: é o que dá teto a "cem mil lugares onde poderia começar".
    texto.orcamento -= 1
    if (texto.orcamento < 0) return 'incompleto'
    if (casaAPartirDe(texto, alvo, inicio, juntar)) return 'sim'
  }
  // O último início, ou os prefixos, podem ter parado por falta de orçamento.
  return texto.orcamento < 0 ? 'incompleto' : 'nao'
}

/**
 * O nome do "campo" quando é a liga citada que não bate. Tem mais de 60
 * caracteres DE PROPÓSITO: é o teto do nome de campo que a IA pode devolver
 * (`CamposExtraidosSchema`), então nenhum campo dela colide com ele. `liga`
 * e depois `liga citada` colidiam (2ª e 3ª rodadas do #150). A tela mostra
 * `ROTULO_DO_CAMPO_DA_LIGA`.
 */
export const CAMPO_DA_LIGA = 'liga citada pela IA — conferida à parte, não é um dos campos extraídos'
export const ROTULO_DO_CAMPO_DA_LIGA = 'liga citada'

/**
 * A liga citada está no texto? Conferida SEMPRE, à parte do primeiro
 * problema: se outro campo falhasse antes, a liga inventada seguia para
 * `resolverLiga` e nascia no banco (2ª rodada do #150). Sem liga, `true`.
 *
 * Sem a isenção de valor curto: a liga vira IDENTIDADE, e "LX" ausente do
 * texto nascia como liga "lx" (2ª rodada de segurança do #150).
 */
export function ligaEstaNoTexto(texto: TextoParaConferir, ligaMencionada: string | null): boolean {
  return ligaMencionada === null || lembrar(texto, ligaMencionada, true) === 'sim'
}

/**
 * O primeiro problema do que a IA extraiu para UM item, ou `null`.
 *
 * Ordem: CPF que não confere vem antes de valor fora do texto — um CPF com
 * dígito errado copiado LITERALMENTE do e-mail (quem escreveu errou) também
 * precisa de uma pessoa (`A40`, resposta 26), e o motivo certo para ela é
 * "o CPF não confere", não "o valor não está no e-mail". Um "CPF" sem nenhum
 * dígito ("não informado") não é tentativa de CPF: a conferência de texto
 * cuida dele (revisão técnica do #150).
 *
 * A liga mencionada entra na conferência de texto: ela vira IDENTIDADE
 * (`resolverLiga`), e a ingestão não liga o item a uma liga que o e-mail não
 * cita.
 *
 * O que ela prova é "aparece no texto", não "está completo nem é o certo":
 * "(11) 98765" passa com "(11) 98765-4321" no e-mail, e um CPF de outra pessoa
 * citada no texto também passa. Não é controle contra injeção — contra ela
 * valem a suspeita e a Revisão (revisões do #150).
 */
export function conferirExtracao(
  texto: TextoParaConferir,
  campos: Readonly<Record<string, string>>,
  ligaMencionada: string | null,
): ProblemaNaExtracao | null {
  for (const [campo, valor] of Object.entries(campos)) {
    if (nomeDeCampoGravavel(campo) === 'cpf' && /\d/.test(valor) && normalizarCpf(valor) === null) {
      return { motivo: 'cpf_invalido', campo }
    }
  }
  // "Não deu para procurar" (orçamento esgotado) não é "não está no e-mail":
  // o motivo diz qual dos dois foi.
  const motivo = (achado: Achado): MotivoDaConferencia =>
    achado === 'incompleto' ? 'conferencia_incompleta' : 'valor_fora_do_texto'
  for (const [campo, valor] of Object.entries(campos)) {
    const achado = lembrar(texto, valor, false)
    if (achado !== 'sim') return { motivo: motivo(achado), campo }
  }
  if (ligaMencionada !== null) {
    const achado = lembrar(texto, ligaMencionada, true)
    if (achado !== 'sim') return { motivo: motivo(achado), campo: CAMPO_DA_LIGA }
  }
  return null
}
