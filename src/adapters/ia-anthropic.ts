import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'

import {
  InterpretadorEstruturado,
  RespostaDoModeloSchema,
  type ClienteDeInterpretacao,
  type PerfilDoFornecedor,
} from './ia-estruturada'
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

export type { ClienteDeInterpretacao } from './ia-estruturada'

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
  versaoPrompt: 'anthropic-1.0.0',
  modeloPadrao: 'claude-sonnet-5',
  ehCredencialRecusada: (erro) =>
    erro instanceof Anthropic.AuthenticationError ||
    erro instanceof Anthropic.PermissionDeniedError,
}

export function clienteAnthropic(): ClienteDeInterpretacao {
  const chave = ambiente().ANTHROPIC_API_KEY
  // `ambiente()` já recusa `IA_ADAPTER=anthropic` sem chave; esta é a segunda
  // tranca, para o caso de alguém construir o adapter direto.
  if (!chave) throw new Error('ANTHROPIC_API_KEY ausente: o adapter Anthropic não pode subir.')

  const cliente = new Anthropic({ apiKey: chave })

  return {
    async interpretar({ instrucoes, conteudo, modelo }) {
      const resposta = await cliente.messages.parse({
        model: modelo,
        max_tokens: MAXIMO_DE_TOKENS,
        system: instrucoes,
        messages: [{ role: 'user', content: conteudo }],
        output_config: {
          format: zodOutputFormat(RespostaDoModeloSchema),
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

      return { objeto: resposta.parsed_output, modeloUsado: resposta.model }
    },
  }
}

export class IaAnthropic extends InterpretadorEstruturado {
  constructor(cliente: ClienteDeInterpretacao = clienteAnthropic()) {
    super(PERFIL_ANTHROPIC, cliente)
  }
}
