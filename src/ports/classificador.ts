import { ErroOperacional } from '../core/erros'

/**
 * Porta de CLASSIFICAÇÃO — uma segunda opinião sobre um texto (`DECISOES.md § A62`).
 *
 * ═══ POR QUE NÃO É A `AiPort` ═══
 *
 * A `AiPort` INTERPRETA: devolve campos (nome, CPF, categoria) que viram item.
 * Um classificador não escreve nada — responde perguntas FECHADAS sobre o
 * texto, com probabilidade: "isto é sim ou não?", "qual destes rótulos?",
 * "que nota nesta escala?". É o formato do Jev (TypeSafe), e é o que torna a
 * resposta auditável: não há texto livre do modelo para validar, só números
 * e rótulos que NÓS escrevemos.
 *
 * ═══ O QUE ELE NUNCA FAZ ═══
 *
 * Decidir (invariante 2). A resposta é uma OPINIÃO que o serviço compara com
 * a da interpretação; discordância manda o item a uma pessoa. Nenhuma resposta
 * daqui cria item, escolhe responsável ou muda categoria sozinha.
 *
 * ═══ AS PERGUNTAS SÃO DO CÓDIGO ═══
 *
 * `instrucoes`, rótulos e níveis são literais escritos aqui no sistema — nunca
 * texto que veio de e-mail. O único conteúdo de fora é `texto`, e é ele que
 * passa pela camada de defesa do dado e pelas três camadas contra injeção
 * (`adapters/classificador-externo.ts`). Pergunta montada com texto de e-mail
 * seria instrução escrita pelo remetente.
 */

export type Pergunta =
  | {
      readonly tipo: 'sim_ou_nao'
      readonly instrucoes: string
      /** O que "sim" quer dizer, quando a pergunta sozinha não basta. */
      readonly seSim?: string
      readonly seNao?: string
    }
  | {
      readonly tipo: 'escolha'
      readonly instrucoes: string
      /** Rótulo → descrição (ou `null`, rótulo sem descrição). Pelo menos dois. */
      readonly opcoes: Readonly<Record<string, string | null>>
    }
  | {
      readonly tipo: 'nota'
      readonly instrucoes: string
      /** Descrição de cada nível, do 0 em diante. Pelo menos dois. */
      readonly niveis: readonly (string | null)[]
    }

export type Resposta =
  | {
      readonly tipo: 'sim_ou_nao'
      /** Probabilidade de "sim", de 0 a 1. */
      readonly probabilidadeDeSim: number
    }
  | {
      readonly tipo: 'escolha'
      readonly escolha: string
      readonly confianca: number
      readonly probabilidades: Readonly<Record<string, number>>
    }
  | {
      readonly tipo: 'nota'
      /** Nota esperada — pode cair entre dois níveis. */
      readonly nota: number
      readonly confianca: number
      readonly probabilidades: Readonly<Record<string, number>>
    }

export interface PedidoDeClassificacao {
  /** O texto de fora (assunto e corpo do e-mail, por exemplo). */
  readonly texto: string
  /** Perguntas por nome; a resposta vem com o mesmo nome. */
  readonly perguntas: Readonly<Record<string, Pergunta>>
}

export interface Classificacao {
  readonly respostas: Readonly<Record<string, Resposta>>
  /** Quem respondeu — `typesafe`, `mock`. Vai para a trilha. */
  readonly fornecedor: string
  readonly modeloUsado: string
  /**
   * O que a camada de defesa tirou do texto antes de ele sair, em CONTAGEM —
   * nunca o valor. Serve para a trilha dizer "saíram 3 números mascarados".
   */
  readonly mascarados: { readonly numero: number; readonly email: number; readonly link: number }
  /** O texto passou do limite e foi cortado antes de sair. */
  readonly cortado: boolean
  /**
   * A detecção de injeção achou padrão no texto ORIGINAL. É sinal, não
   * bloqueio: a pergunta foi feita, e quem usa a resposta decide o que fazer
   * com uma opinião dada sobre um texto suspeito.
   */
  readonly suspeito: boolean
}

export interface ClassificadorPort {
  readonly fornecedor: string
  classificar(pedido: PedidoDeClassificacao): Promise<Classificacao>
}

/**
 * Esta pergunta, sobre este texto, não teve resposta utilizável — falha de
 * transporte ou resposta fora da forma. Quem chamou segue SEM a segunda
 * opinião; o item não fica parado por causa dela.
 *
 * A mensagem nunca carrega o texto nem a resposta crua (invariante 11).
 */
export class FalhaDeClassificacao extends ErroOperacional {
  readonly codigo = 'FALHA_DE_CLASSIFICACAO'
  /** Este texto não teve opinião; o resto do sistema segue de pé. */
  readonly statusHttp = 422

  constructor(readonly causa: string) {
    super(`Falha ao classificar: ${causa}`)
  }
}

/**
 * O classificador está fora para TODOS os textos: credencial recusada, teto
 * diário ou disjuntor. Parar de perguntar é mais barato que fracassar um a um.
 */
export class ClassificadorIndisponivelError extends ErroOperacional {
  readonly codigo = 'CLASSIFICADOR_INDISPONIVEL'
  readonly statusHttp = 503

  constructor(readonly causa: string) {
    super(`Classificador indisponível: ${causa}`)
  }
}
