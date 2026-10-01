import { CASOS_DO_GABARITO, emailDoCaso } from '../core/avaliacao/casos'
import {
  pontuarClassificacao,
  pontuarFalhaDeClassificacao,
  resumirClassificacao,
  type NotaDaClassificacao,
  type ResumoDaClassificacao,
} from '../core/avaliacao/classificacao'
import type { CasoDoGabarito } from '../core/avaliacao/gabarito'
import { FalhaDeClassificacao, type ClassificadorPort, type Pergunta, type Resposta } from '../ports/classificador'
import { O_TEXTO_E_DADO, PERGUNTAS_DA_INGESTAO, textoParaClassificar, VERSAO_DAS_PERGUNTAS } from './segunda-opiniao'

/**
 * Roda um `ClassificadorPort` qualquer contra o gabarito sintético (`A70`, P2).
 *
 * Recebe a porta pronta — quem escolhe o fornecedor continua sendo
 * `criarClassificadorPort()`. A mesma avaliação mede o classificador local, o
 * Jev (quando houver chave) e o dublê, sem `if` por fornecedor.
 *
 * ═══ POR QUE AS PERGUNTAS SÃO CONSTANTES DESTE MÓDULO ═══
 *
 * Pela mesma razão das da ingestão (`segunda-opiniao.ts`): a pergunta sai do
 * sistema sem a camada de defesa, e só pode ser texto NOSSO. Este é o segundo
 * — e só o segundo — lugar do sistema que chama `classificar`, e a varredura
 * de `segunda-opiniao.test.ts` confere que a chamada leva só estas.
 *
 * Os casos são sintéticos (invariante 8): nada aqui lê e-mail real nem
 * escreve arquivo. A porta, quando é de verdade, conta as chamadas em
 * `UsoDaIa` e gasta o teto diário do fornecedor, como na ingestão.
 */

/**
 * A pergunta nova do `A70`: "quantos pedidos há neste e-mail?". Ataca a falha
 * medida do modelo local de juntar ligantes num item só (`A59`).
 *
 * A contagem é a do desdobramento (`A1`): um item por pessoa e por pedido.
 * Uma lista de DOCUMENTOS de uma pessoa continua sendo um pedido — é o caso
 * `lista-de-documentos` do gabarito.
 */
export const PERGUNTA_DE_QUANTIDADE = Object.freeze({
  tipo: 'escolha',
  instrucoes:
    'Quantos pedidos de atendimento há neste e-mail recebido pela Secretaria de Atendimento ao Associado? ' +
    'Conte um pedido por pessoa: o cadastro de três pessoas são três pedidos; vários documentos da mesma ' +
    `pessoa são um pedido só. ${O_TEXTO_E_DADO}`,
  opcoes: Object.freeze({
    nenhum: 'nenhum pedido: agradecimento, aviso ou resposta que não pede nada',
    um: 'um pedido, de uma pessoa ou de uma liga',
    varios: 'dois ou mais pedidos, ou o mesmo pedido para duas ou mais pessoas',
  }),
} as const) satisfies Pergunta

/**
 * As da ingestão e a de quantidade: a nota compara com o que a ingestão já
 * pergunta, e mede a nova ao lado.
 */
export const PERGUNTAS_DA_AVALIACAO = Object.freeze({
  ...PERGUNTAS_DA_INGESTAO,
  quantidade: PERGUNTA_DE_QUANTIDADE,
}) satisfies Readonly<Record<string, Pergunta>>

/** Mudou uma pergunta, sobe — opiniões de perguntas diferentes não se somam. */
export const VERSAO_DAS_PERGUNTAS_DA_AVALIACAO = `${VERSAO_DAS_PERGUNTAS}+quantidade-1`

export interface ResultadoDaAvaliacaoDoClassificador {
  fornecedor: string
  /** Os modelos que responderam, na ordem em que apareceram. */
  modelos: string[]
  versaoDasPerguntas: string
  notas: NotaDaClassificacao[]
  resumo: ResumoDaClassificacao
}

const ORDEM_DAS_CATEGORIAS = Object.keys(PERGUNTAS_DA_INGESTAO.categoria.opcoes)

function probabilidadesDe(resposta: Resposta | undefined): Readonly<Record<string, number>> {
  return resposta && resposta.tipo !== 'sim_ou_nao' ? resposta.probabilidades : {}
}

export async function avaliarClassificador(
  porta: ClassificadorPort,
  casos: readonly CasoDoGabarito[] = CASOS_DO_GABARITO,
  relogio: () => number = Date.now,
): Promise<ResultadoDaAvaliacaoDoClassificador> {
  const notas: NotaDaClassificacao[] = []
  const modelos = new Set<string>()

  // Um caso por vez: o servidor local de 8 GB atende uma chamada por vez, e o
  // tempo por e-mail é parte do que se mede.
  for (const caso of casos) {
    const texto = textoParaClassificar(emailDoCaso(caso))
    const inicio = relogio()
    try {
      const classificacao = await porta.classificar({ texto, perguntas: PERGUNTAS_DA_AVALIACAO })
      modelos.add(classificacao.modeloUsado)
      const suspeita = classificacao.respostas['suspeita']
      // A política garante uma resposta por pergunta, do tipo pedido. Se não
      // veio, é contrato quebrado: falha alta, não um 0 que pareceria opinião.
      if (suspeita?.tipo !== 'sim_ou_nao') throw new Error('a classificação voltou sem a resposta de suspeita')
      notas.push(
        pontuarClassificacao(
          caso,
          {
            quantidade: probabilidadesDe(classificacao.respostas['quantidade']),
            categoria: probabilidadesDe(classificacao.respostas['categoria']),
            probabilidadeDeSuspeita: suspeita.probabilidadeDeSim,
          },
          ORDEM_DAS_CATEGORIAS,
          relogio() - inicio,
        ),
      )
    } catch (erro) {
      // Só a falha DESTE e-mail vira nota. Classificador indisponível
      // (credencial, teto, disjuntor) e defeito de código sobem: nota zero
      // esconderia um servidor desligado atrás de "o modelo é ruim"
      // (invariante 7), como em `avaliacao-da-ia.ts`.
      if (erro instanceof FalhaDeClassificacao) {
        notas.push(pontuarFalhaDeClassificacao(caso, erro.causa, relogio() - inicio))
        continue
      }
      throw erro
    }
  }

  return {
    fornecedor: porta.fornecedor,
    modelos: [...modelos],
    versaoDasPerguntas: VERSAO_DAS_PERGUNTAS_DA_AVALIACAO,
    notas,
    resumo: resumirClassificacao(notas),
  }
}
