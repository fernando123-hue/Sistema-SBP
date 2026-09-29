import { ehNomeDeModelo } from '../core/ia/nome-de-modelo'
import { analisarConteudo, delimitar } from '../core/seguranca/conteudo-nao-confiavel'
import {
  LIMITE_PARA_FORNECEDOR_EXTERNO,
  protegerParaFornecedorExterno,
} from '../core/seguranca/protecao-para-fornecedor-externo'
import { resumoDeTransporte } from '../core/seguranca/resumo-de-transporte'
import { resumoDeValidacao } from '../core/seguranca/resumo-de-validacao'
import {
  ClassificadorIndisponivelError,
  FalhaDeClassificacao,
  type Classificacao,
  type ClassificadorPort,
  type PedidoDeClassificacao,
  type Pergunta,
  type Resposta,
} from '../ports/classificador'
import { LimiteDeConsumoAtingido } from '../ports/consumo'
import { registrarLog } from '../servidor/observabilidade'
import { especieDoErro } from './fornecedor'

/**
 * A política de classificação — igual para todo fornecedor (`A62`).
 *
 * O mesmo desenho de `ia-estruturada.ts`: o que é DESTE sistema mora aqui, e
 * cada fornecedor é um arquivo `classificador-<nome>.ts` com duas coisas —
 * como falar com a API dele e um `PerfilDoClassificador`. Acrescentar um
 * fornecedor não toca `servicos/`, `app/` nem `core/`.
 *
 * O que é deste sistema:
 *
 *   1. **A camada de defesa do dado** (`protegerParaFornecedorExterno`) antes
 *      de o texto sair. Não há fornecedor de classificação que receba o texto
 *      cru: o fornecedor é externo por definição, e a camada é a condição do
 *      dono para ele existir.
 *   2. **As três camadas contra injeção** (invariante 6): o corte é o da camada
 *      de defesa; a detecção roda no texto ORIGINAL (o mascarado perderia
 *      padrões) e vira o sinal `suspeito`; e o texto vai delimitado.
 *   3. **A resposta é conferida contra a pergunta**: cada pergunta respondida,
 *      do tipo pedido, com rótulo que existe e probabilidade de 0 a 1. Um
 *      rótulo que nós não escrevemos é resposta inventada, e não segue.
 *   4. **O erro sai resumido**: nem o texto nem a resposta crua entram na
 *      mensagem (invariante 11).
 *
 * O que NÃO há aqui, de propósito: segunda tentativa. A resposta é uma
 * opinião a mais, não o caminho do item; sem ela o item segue pela
 * interpretação, e repetir custaria uma chamada para ganhar pouco.
 */

export interface PerfilDoClassificador {
  /** Vai para `Classificacao.fornecedor`, para a trilha e para o `UsoDaIa`. */
  readonly nome: string
  readonly modeloPadrao: string
  /** Credencial recusada é o sistema mal configurado — para de perguntar. */
  ehCredencialRecusada(erro: unknown): boolean
}

/** Como falar com UMA API. Recebe o texto já protegido e delimitado. */
export interface ClienteDeClassificacao {
  perguntar(pedido: {
    readonly estado: string
    readonly perguntas: Readonly<Record<string, Pergunta>>
    readonly modelo: string
  }): Promise<{ readonly respostas: Readonly<Record<string, Resposta>>; readonly modeloUsado: string }>
}

export class ClassificadorExterno implements ClassificadorPort {
  readonly fornecedor: string
  private readonly modelo: string

  constructor(
    private readonly perfil: PerfilDoClassificador,
    private readonly cliente: ClienteDeClassificacao,
    modelo?: string,
  ) {
    this.fornecedor = perfil.nome
    this.modelo = modelo || perfil.modeloPadrao
  }

  async classificar(pedido: PedidoDeClassificacao): Promise<Classificacao> {
    conferirPerguntas(pedido.perguntas)

    const { suspeito } = analisarConteudo(pedido.texto, LIMITE_PARA_FORNECEDOR_EXTERNO)
    const protegido = protegerParaFornecedorExterno(pedido.texto)

    let bruto: Awaited<ReturnType<ClienteDeClassificacao['perguntar']>>
    try {
      bruto = await this.cliente.perguntar({
        estado: delimitar(protegido.texto),
        perguntas: pedido.perguntas,
        modelo: this.modelo,
      })
    } catch (erro) {
      // Forma errada na resposta (o Zod do fornecedor recusou) e transporte
      // saem por resumos diferentes, os mesmos da interpretação.
      const causa =
        especieDoErro(erro) === 'validacao'
          ? resumoDeValidacao(erro)
          : resumoDeTransporte(erro instanceof Error ? erro.message : String(erro))
      if (erro instanceof LimiteDeConsumoAtingido) throw new ClassificadorIndisponivelError(causa, erro.motivo)
      if (this.perfil.ehCredencialRecusada(erro)) throw new ClassificadorIndisponivelError(causa, 'credencial')
      registrarLog('aviso', 'chamada ao classificador falhou', { fornecedor: this.fornecedor, erro: causa })
      throw new FalhaDeClassificacao(causa)
    }

    const problema = problemaNasRespostas(pedido.perguntas, bruto.respostas)
    if (problema) {
      registrarLog('aviso', 'classificador respondeu fora da forma', { fornecedor: this.fornecedor, erro: problema })
      throw new FalhaDeClassificacao(problema)
    }

    // O nome do modelo vem do fornecedor e vai para a trilha, que é para
    // sempre. A forma é conferida AQUI, para todo fornecedor — não só no
    // adaptador que lembrou de conferir (revisão de segurança do #143).
    const modeloUsado = ehNomeDeModelo(bruto.modeloUsado) ? bruto.modeloUsado : this.modelo
    if (modeloUsado !== bruto.modeloUsado) {
      registrarLog('aviso', 'classificador devolveu um nome de modelo fora da forma; vale o pedido', {
        fornecedor: this.fornecedor,
        tamanho: bruto.modeloUsado.length,
      })
    }

    return {
      respostas: copiaConferida(pedido.perguntas, bruto.respostas),
      fornecedor: this.fornecedor,
      modeloUsado,
      mascarados: protegido.mascarados,
      cortado: protegido.cortado,
      suspeito,
    }
  }
}

/**
 * Pergunta malformada é defeito de quem a escreveu — no código —, não falha do
 * fornecedor. Sobe como `Error` comum: é para a suíte pegar, não para a tela.
 */
function conferirPerguntas(perguntas: Readonly<Record<string, Pergunta>>): void {
  const nomes = Object.keys(perguntas)
  if (nomes.length === 0) throw new Error('classificação sem pergunta')
  for (const nome of nomes) {
    const pergunta = perguntas[nome]!
    if (pergunta.tipo === 'escolha' && Object.keys(pergunta.opcoes).length < 2) {
      throw new Error(`a pergunta "${nome}" precisa de pelo menos duas opções`)
    }
    if (pergunta.tipo === 'nota' && pergunta.niveis.length < 2) {
      throw new Error(`a pergunta "${nome}" precisa de pelo menos dois níveis`)
    }
  }
}

const ehProbabilidade = (valor: number) => Number.isFinite(valor) && valor >= 0 && valor <= 1

/**
 * Folga das contas de coerência. As probabilidades podem vir arredondadas pelo
 * fornecedor; 0,02 aceita o arredondamento e recusa a contradição (uma soma 2,
 * uma escolha com 1% contra 99% do outro rótulo).
 */
const FOLGA = 0.02

/**
 * Na SOMA, o arredondamento se acumula: n rótulos arredondados a duas casas
 * desviam até n × 0,005 — seis rótulos de 1/6 escritos 0,17 somam 1,02, e as
 * oito categorias de `core/config.ts` podem desviar 0,04 (revisão técnica,
 * rodada 2 do #142). Uma folga fixa recusaria justamente a distribuição
 * espalhada, que é resposta boa.
 *
 * E tem TETO: sem ele, com 200 rótulos uma soma 0 passaria, e "soma 0 é
 * contradição" deixaria de valer (rodada 3 do #142). 0,1 cobre 20 rótulos
 * arredondados — mais do que qualquer pergunta de hoje.
 */
const folgaDaSoma = (rotulos: number) => Math.min(Math.max(FOLGA, 0.005 * rotulos), 0.1)

/** Ponto flutuante: `Math.abs(1.02 - 1)` é 0,020000000000000018. */
const RESIDUO_DE_CONTA = 1e-9

/**
 * O que está errado na resposta, em palavras NOSSAS — ou `null`.
 *
 * A frase cita o nome da pergunta e o tipo do defeito, nunca o valor que veio:
 * um rótulo inventado pelo modelo pode ser um trecho do e-mail.
 *
 * Forma e faixa não bastam: uma resposta pode ter cada número entre 0 e 1 e
 * ainda assim se contradizer — "anuidade" escolhida com 1% de probabilidade,
 * rótulos que somam 2. A fase 3 compara a `escolha` com a interpretação; uma
 * escolha que as próprias probabilidades desmentem viraria concordância ou
 * discordância falsa. Incoerente é forma errada, e forma errada falha alto
 * (invariante 7), nunca vira opinião.
 *
 * A `confianca` só é conferida na faixa: o que ela mede na TypeSafe (a
 * probabilidade do escolhido? outra conta?) não está confirmado (`A62`), e
 * inventar a regra aqui recusaria toda resposta boa se o palpite errasse.
 */
function problemaNasRespostas(
  perguntas: Readonly<Record<string, Pergunta>>,
  respostas: Readonly<Record<string, Resposta>>,
): string | null {
  // Resposta a pergunta que ninguém fez: a chave é do fornecedor, e pode ser
  // um trecho do e-mail ou uma ordem. Não segue — e a frase não a cita.
  if (Object.keys(respostas).some((nome) => !Object.hasOwn(perguntas, nome))) {
    return 'veio resposta a uma pergunta que não foi feita'
  }

  for (const [nome, pergunta] of Object.entries(perguntas)) {
    const resposta = Object.hasOwn(respostas, nome) ? respostas[nome] : undefined
    if (!resposta) return `a pergunta "${nome}" ficou sem resposta`
    if (resposta.tipo !== pergunta.tipo) return `a pergunta "${nome}" voltou com outro tipo de resposta`

    if (resposta.tipo === 'sim_ou_nao') {
      if (!ehProbabilidade(resposta.probabilidadeDeSim)) return `a pergunta "${nome}" voltou com probabilidade fora de 0 a 1`
      continue
    }

    if (!ehProbabilidade(resposta.confianca)) return `a pergunta "${nome}" voltou com confiança fora de 0 a 1`
    const esperadas =
      pergunta.tipo === 'escolha'
        ? Object.keys(pergunta.opcoes)
        : pergunta.tipo === 'nota'
          ? pergunta.niveis.map((_, indice) => String(indice))
          : []
    const recebidas = Object.keys(resposta.probabilidades)
    if (recebidas.length !== esperadas.length || recebidas.some((chave) => !esperadas.includes(chave))) {
      return `a pergunta "${nome}" voltou com rótulos diferentes dos perguntados`
    }
    const probabilidades = esperadas.map((rotulo) => resposta.probabilidades[rotulo]!)
    if (probabilidades.some((valor) => !ehProbabilidade(valor))) {
      return `a pergunta "${nome}" voltou com probabilidade fora de 0 a 1`
    }
    const soma = probabilidades.reduce((total, valor) => total + valor, 0)
    if (Math.abs(soma - 1) > folgaDaSoma(esperadas.length) + RESIDUO_DE_CONTA) return `a pergunta "${nome}" voltou com probabilidades que não somam 1`

    if (resposta.tipo === 'escolha') {
      if (!esperadas.includes(resposta.escolha)) {
        return `a pergunta "${nome}" voltou com um rótulo que não foi perguntado`
      }
      // Empate aceito: dois rótulos com a mesma probabilidade, qualquer um serve.
      const maior = Math.max(...probabilidades)
      if (resposta.probabilidades[resposta.escolha]! < maior - FOLGA - RESIDUO_DE_CONTA) {
        return `a pergunta "${nome}" voltou com uma escolha que as probabilidades desmentem`
      }
    }
    if (resposta.tipo === 'nota') {
      const maior = esperadas.length - 1
      if (!Number.isFinite(resposta.nota) || resposta.nota < 0 || resposta.nota > maior) {
        return `a pergunta "${nome}" voltou com nota fora da escala`
      }
      // A nota é a ESPERADA (`ports/classificador.ts`): a média dos níveis
      // pesada pelas probabilidades. Folga proporcional à escala.
      const esperada = probabilidades.reduce((total, valor, nivel) => total + valor * nivel, 0)
      if (Math.abs(resposta.nota - esperada) > FOLGA * maior + RESIDUO_DE_CONTA) {
        return `a pergunta "${nome}" voltou com uma nota que as probabilidades desmentem`
      }
    }
  }
  return null
}

/**
 * A resposta refeita campo a campo, só com o que foi perguntado e conferido.
 *
 * `problemaNasRespostas` já recusou pergunta a mais; copiar em vez de
 * repassar é a segunda tranca, e a que vale se alguém um dia afrouxar a
 * primeira: o que sai daqui para a fase 3 (e dali para a trilha, que é
 * append-only e sem retenção) são nomes que NÓS escrevemos, rótulos que NÓS
 * escrevemos e números — nenhum campo que o fornecedor tenha acrescentado.
 */
function copiaConferida(
  perguntas: Readonly<Record<string, Pergunta>>,
  respostas: Readonly<Record<string, Resposta>>,
): Record<string, Resposta> {
  const copia: Record<string, Resposta> = {}
  for (const [nome, pergunta] of Object.entries(perguntas)) {
    const resposta = respostas[nome]!
    if (resposta.tipo === 'sim_ou_nao') {
      copia[nome] = { tipo: 'sim_ou_nao', probabilidadeDeSim: resposta.probabilidadeDeSim }
      continue
    }
    const rotulos =
      pergunta.tipo === 'escolha'
        ? Object.keys(pergunta.opcoes)
        : pergunta.tipo === 'nota'
          ? pergunta.niveis.map((_, indice) => String(indice))
          : []
    const probabilidades = Object.fromEntries(rotulos.map((rotulo) => [rotulo, resposta.probabilidades[rotulo]!]))
    copia[nome] =
      resposta.tipo === 'escolha'
        ? {
            tipo: 'escolha',
            // O rótulo NOSSO, não a string que veio: são iguais (já conferido),
            // mas assim nenhuma string do fornecedor sai daqui.
            escolha: rotulos.find((rotulo) => rotulo === resposta.escolha)!,
            confianca: resposta.confianca,
            probabilidades,
          }
        : { tipo: 'nota', nota: resposta.nota, confianca: resposta.confianca, probabilidades }
  }
  return copia
}
