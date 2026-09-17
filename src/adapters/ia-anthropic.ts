import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'

import { InterpretadorEstruturado } from './ia-estruturada'
import { lerRespostaJson, type ClienteDeModelo, type PerfilDoFornecedor } from './fornecedor'
import { ambiente } from '../servidor/ambiente'

/**
 * Adapter de IA — Anthropic.
 *
 * Sobrou POUCO neste arquivo, e a redução é o resultado que interessa. Em
 * 07/09/2026, quando entrou o segundo fornecedor, ficou visível que de 253
 * linhas apenas estas eram sobre a Anthropic: a chamada ao SDK, a leitura do
 * motivo de parada, e como o SDK sinaliza credencial recusada.
 *
 * Todo o resto — as três camadas contra injeção, a repetição única e só por
 * erro de formato, o sinal duplo de suspeita, a revalidação — é política deste
 * sistema e mora em `ia-estruturada.ts`, valendo igual para qualquer modelo.
 *
 * Quem escolhe qual fornecedor sobe é `criarAiPort()`, a partir de
 * `IA_ADAPTER`. Nenhum serviço, rota ou tela sabe da diferença.
 */

export type { ClienteDeModelo } from './fornecedor'

/**
 * Esforço de raciocínio.
 *
 * `low` porque classificar um e-mail curto é tarefa mecânica, o volume é diário
 * e contínuo, e o custo de errar é baixo: item mal classificado cai na fila de
 * revisão, que existe justamente para isso. Se a taxa de acerto medida não
 * satisfizer, este é o primeiro botão a girar.
 *
 * Não tem equivalente no Gemini, e por isso é ajuste DAQUI — não do núcleo.
 */
const ESFORCO = 'low' as const

/** Teto de saída. Estourar não é truncado em silêncio — vira falha e revisão humana. */
const MAXIMO_DE_TOKENS = 16_000

/** Teto de tempo por chamada. Igual ao do Gemini, para os dois falharem no mesmo prazo. */
const TEMPO_LIMITE_MS = 120_000

/**
 * Perfil do fornecedor.
 *
 * A versão do prompt leva o nome do fornecedor porque a MESMA redação rende
 * resultados diferentes em modelos diferentes: sem o prefixo, a medida de
 * acerto somaria duas populações distintas sob um rótulo só, e a comparação
 * entre fornecedores — que é a razão de existir um segundo — ficaria impossível
 * de fazer sobre o histórico.
 */
export const PERFIL_ANTHROPIC: PerfilDoFornecedor = {
  nome: 'anthropic',
  versaoPrompt: 'anthropic-1.1.0',
  modeloPadrao: 'claude-sonnet-5',
  ehCredencialRecusada: (erro) =>
    erro instanceof Anthropic.AuthenticationError ||
    erro instanceof Anthropic.PermissionDeniedError,
}

/**
 * `chave` e `fetch` só existem para o teste exercitar o SDK de verdade sem
 * rede (`forma-na-saida-estruturada.test.ts`). Em produção nada é passado, e a
 * chave vem de `ambiente()`.
 */
export function clienteAnthropic(
  opcoes: { chave?: string; fetch?: typeof fetch } = {},
): ClienteDeModelo {
  const chave = opcoes.chave ?? ambiente().ANTHROPIC_API_KEY
  // `ambiente()` já recusa `IA_ADAPTER=anthropic` sem chave; esta é a segunda
  // tranca, para o caso de alguém construir o adapter direto.
  if (!chave) throw new Error('ANTHROPIC_API_KEY ausente: o adapter Anthropic não pode subir.')

  // `maxRetries` e `timeout` EXPLÍCITOS, mesmo coincidindo com o padrão do SDK.
  //
  // O núcleo justifica não repetir falha de transporte dizendo que "o SDK já
  // tentou de novo por conta própria". Enquanto isso ficou implícito, a frase
  // valia aqui e era falsa no Gemini — e ninguém tinha como saber lendo o
  // código. Declarar em cada adapter o que ele de fato faz é o que torna a
  // afirmação do núcleo verificável nos dois.
  const cliente = new Anthropic({
    apiKey: chave,
    maxRetries: 2,
    timeout: TEMPO_LIMITE_MS,
    ...(opcoes.fetch ? { fetch: opcoes.fetch } : {}),
  })

  return {
    async gerar({ instrucoes, conteudo, modelo, esquema }) {
      // `create`, não `parse`: o `parse` do SDK valida a resposta por conta
      // própria e lança `AnthropicError`, que `especieDoErro` lê como
      // transporte — a nova tentativa por erro de forma nunca acontecia, e a
      // causa crua (com trecho do que o modelo escreveu) ia para o log
      // (revisão do PR #58). A forma continua indo no pedido, para a
      // decodificação restrita; quem LÊ e valida a resposta é o nosso código,
      // igual ao Gemini.
      const resposta = await cliente.messages.create({
        model: modelo,
        max_tokens: MAXIMO_DE_TOKENS,
        system: instrucoes,
        messages: [{ role: 'user', content: conteudo }],
        output_config: {
          // O esquema vem de quem chama, não fixo aqui: é o que permite este
          // mesmo cliente atender a interpretação de e-mail e o assistente sem
          // uma segunda cópia da chamada ao SDK.
          format: { type: 'json_schema', schema: zodOutputFormat(esquema).schema },
          effort: ESFORCO,
        },
      })

      // Resposta cortada no meio é resposta incompleta. Aceitá-la seria gravar
      // uma lista de ligantes pela metade como se fosse a lista inteira — carga
      // perdida em silêncio, que é exatamente o defeito da planilha.
      if (resposta.stop_reason === 'max_tokens') {
        throw new Error(`resposta truncada em ${MAXIMO_DE_TOKENS} tokens`)
      }
      if (resposta.stop_reason === 'refusal') {
        throw new Error('o modelo recusou a requisição por política de segurança')
      }

      const texto = resposta.content
        .flatMap((bloco) => (bloco.type === 'text' ? [bloco.text] : []))
        .join('')
      if (!texto) {
        // Sem texto é a pior resposta: parece sucesso e não tem conteúdo.
        throw new Error('o modelo devolveu resposta vazia')
      }

      return { objeto: lerRespostaJson(texto), modeloUsado: resposta.model }
    },
  }
}

export class IaAnthropic extends InterpretadorEstruturado {
  constructor(cliente: ClienteDeModelo = clienteAnthropic()) {
    super(PERFIL_ANTHROPIC, cliente)
  }
}
