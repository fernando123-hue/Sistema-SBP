import { GoogleGenAI } from '@google/genai'
import { z } from 'zod'

import { InterpretadorEstruturado } from './ia-estruturada'
import { formaEsperadaEmTexto, type ClienteDeModelo, type PerfilDoFornecedor } from './fornecedor'
import { ambiente } from '../servidor/ambiente'

/**
 * Adapter de IA — Gemini (Google AI Studio).
 *
 * ═══ POR QUE ELE EXISTE ═══
 *
 * Entrou em 07/09/2026 por uma razão de prototipagem e uma de arquitetura.
 *
 * A de prototipagem: o Gemini tem camada gratuita, e o pipeline de IA deste
 * sistema — as três defesas contra injeção, a repetição única, a revisão
 * humana, a medida de acerto — nunca tinha sido exercitado contra um modelo
 * real porque isso custava dinheiro. Custo zero destrava a prova.
 *
 * A de arquitetura, que vale mais: **este sistema não pode depender de um
 * fornecedor de IA.** Acrescentar o segundo é o teste de que a fronteira
 * `AiPort` faz o que promete. O resultado está registrado: nenhum arquivo de
 * `servicos/`, `app/` ou `core/` foi tocado para o Gemini caber. O que mudou
 * foi uma linha em `criarAiPort()` e um valor a mais no enum de `IA_ADAPTER`.
 *
 * ═══ A DIFERENÇA HONESTA EM RELAÇÃO À ANTHROPIC ═══
 *
 * O SDK da Anthropic aceita um schema Zod e devolve objeto já validado contra
 * ele. O Gemini tem `responseJsonSchema`, mas aceita um SUBCONJUNTO do JSON
 * Schema — e o nosso não cabe nele. Medido em 07/09/2026: enviar o schema
 * derivado do Zod devolve `400 INVALID_ARGUMENT`, porque `campos` é um mapa
 * aberto (`propertyNames` + `additionalProperties`) e os campos anuláveis usam
 * `anyOf`.
 *
 * A saída NÃO foi redigitar um schema compatível à mão. Um segundo schema,
 * mantido em paralelo ao Zod, é a dívida `H-D7` na camada onde ela custaria
 * mais caro: as duas formas divergiriam em silêncio e a validação passaria a
 * aceitar o que o prompt não pediu. Em vez disso, o schema derivado do MESMO
 * Zod vai para o modelo como TEXTO, dentro das instruções — fonte única, e
 * sem depender de o fornecedor suportar a forma inteira.
 *
 * A garantia que vale continua sendo a NOSSA: quem decide se a resposta serve
 * é `RespostaDoModeloSchema.parse`, no núcleo compartilhado. Isso não é
 * remendo — é a razão de a revalidação existir lá desde o começo. O comentário
 * original dizia "o SDK já valida, mas revalidamos aqui"; com um segundo
 * fornecedor, aquela linha deixou de ser cinto de segurança e passou a ser a
 * validação. A política do sistema não muda com o fornecedor; muda só quanto
 * do trabalho a API do fornecedor adianta.
 */

export type { ClienteDeModelo } from './fornecedor'

/**
 * Teto de saída.
 *
 * Mesmo raciocínio da Anthropic: estourar não pode ser truncado em silêncio.
 * Um e-mail de liga com trinta ligantes gera trinta itens, e uma lista cortada
 * na metade gravada como se fosse inteira é carga que some sem erro — o
 * defeito da planilha reconstruído aqui dentro.
 */
const MAXIMO_DE_TOKENS = 16_000

/**
 * `0` porque a tarefa é classificar, não redigir.
 *
 * A Anthropic tem `effort: 'low'` para dizer a mesma coisa; o Gemini expõe
 * temperatura. Nenhum dos dois pertence ao núcleo — são ajustes do fornecedor,
 * e é justamente por isso que este arquivo existe separado.
 */
const TEMPERATURA = 0

/**
 * Motivos de parada que invalidam a resposta.
 *
 * `STOP` é o único fim aceitável. Os demais devolvem texto — às vezes texto
 * plausível — sobre uma geração que não terminou, e aceitá-los seria gravar
 * meia resposta como se fosse inteira.
 */
const FINS_ACEITAVEIS = new Set(['STOP'])

export const PERFIL_GEMINI: PerfilDoFornecedor = {
  nome: 'gemini',
  // O prefixo é o fornecedor porque a MESMA redação rende resultados
  // diferentes em modelos diferentes: sem ele, a medida de acerto somaria duas
  // populações distintas sob um rótulo só, e a comparação entre fornecedores —
  // que é a razão de existir um segundo — ficaria impossível sobre o histórico.
  versaoPrompt: 'gemini-1.0.0',
  /**
   * Modelo padrão: o `flash` da camada gratuita.
   *
   * Trocar é uma variável de ambiente (`IA_MODELO`), nunca uma alteração de
   * código — e essa é metade do ponto de ter dois fornecedores.
   *
   * ESTE VALOR ENVELHECE, e o Google avisa antes de quebrar: a primeira
   * tentativa desta entrega usou `gemini-2.5-flash` e recebeu um 404 dizendo
   * *"no longer available to new users, please update to models/gemini-3.6-flash"*.
   * Quando repetir, o erro diz o nome novo — troque aqui, ou fixe `IA_MODELO`
   * sem esperar por uma nova versão do código.
   */
  modeloPadrao: 'gemini-3.6-flash',
  /**
   * Credencial recusada é sistema mal configurado, nunca defeito deste e-mail
   * — precisa subir acima do laço de ingestão e parar o lote.
   *
   * O SDK do Google não exporta classes de erro por status como o da
   * Anthropic, então a checagem é sobre o texto e o código HTTP que ele
   * carrega. Deliberadamente ESTREITA: `401` e `403` são credencial; `429` é
   * cota, que é problema transitório e não deve derrubar o lote inteiro.
   */
  ehCredencialRecusada: (erro) => {
    if (typeof erro !== 'object' || erro === null) return false
    const status = (erro as { status?: unknown }).status
    if (status === 401 || status === 403) return true
    const mensagem = erro instanceof Error ? erro.message : ''
    return /API key not valid|API_KEY_INVALID|PERMISSION_DENIED|UNAUTHENTICATED/i.test(mensagem)
  },
}

export function clienteGemini(): ClienteDeModelo {
  const chave = ambiente().GOOGLE_AI_KEY
  // `ambiente()` já recusa `IA_ADAPTER=gemini` sem chave; esta é a segunda
  // tranca, para o caso de alguém construir o adapter direto.
  if (!chave) throw new Error('GOOGLE_AI_KEY ausente: o adapter Gemini não pode subir.')

  const cliente = new GoogleGenAI({ apiKey: chave })

  return {
    async gerar({ instrucoes, conteudo, modelo, esquema }) {
      const resposta = await cliente.models.generateContent({
        model: modelo,
        contents: conteudo,
        config: {
          // A forma vai anexada às instruções, não em `responseJsonSchema` —
          // ver o cabeçalho. `application/json` continua valendo: garante que
          // a resposta não venha embrulhada em prosa ou em cerca de código.
          systemInstruction: `${instrucoes}${formaEsperadaEmTexto(esquema)}`,
          responseMimeType: 'application/json',
          maxOutputTokens: MAXIMO_DE_TOKENS,
          temperature: TEMPERATURA,
        },
      })

      const fim = resposta.candidates?.[0]?.finishReason
      if (fim && !FINS_ACEITAVEIS.has(String(fim))) {
        // Mensagem por motivo, não uma genérica: "MAX_TOKENS" e "SAFETY" pedem
        // ações opostas de quem lê o log, e um texto só mandaria a pessoa
        // investigar a coisa errada.
        throw new Error(
          String(fim) === 'MAX_TOKENS'
            ? `resposta truncada em ${MAXIMO_DE_TOKENS} tokens`
            : `o modelo interrompeu a geração (${String(fim)})`,
        )
      }

      const texto = resposta.text
      if (!texto) {
        // Sem texto e sem motivo de parada é a pior resposta possível: parece
        // sucesso e não tem conteúdo. Vira falha explícita em vez de "e-mail
        // sem item nenhum", que passaria pela validação e sumiria com o
        // trabalho.
        throw new Error('o modelo devolveu resposta vazia')
      }

      // `JSON.parse` aqui, `RespostaDoModeloSchema.parse` no núcleo. O erro de
      // sintaxe precisa ser distinguível do erro de forma: os dois viram nova
      // tentativa, mas só o segundo tem o que dizer ao modelo sobre o que
      // corrigir.
      let objeto: unknown
      try {
        objeto = JSON.parse(texto)
      } catch {
        // SEM `input: texto`, e isto é segurança, não economia.
        //
        // `ZodError.message` é `JSON.stringify(issues)`, e o replacer do Zod só
        // remove `input` dos issues que ele mesmo cria — um issue escrito à mão
        // preserva o campo. Com `input: texto`, a resposta CRUA do modelo (até
        // `MAXIMO_DE_TOKENS`, derivada do corpo do e-mail, com nome e CPF do
        // associado) entrava na mensagem do erro. Dali ela ia para o log, que
        // não tem retenção, e — pior — era colada nas INSTRUÇÕES da segunda
        // tentativa, fora dos marcadores de conteúdo não confiável.
        //
        // Para corrigir o formato, o modelo precisa saber que a resposta não
        // era JSON. Não precisa que a devolvam a ele.
        throw new z.ZodError([
          {
            code: 'custom',
            path: [],
            message: `a resposta não é JSON válido (${texto.length} caracteres)`,
          },
        ])
      }

      // `modelVersion` é o que o serviço de fato usou, que pode ser mais
      // específico que o apelido pedido (`gemini-2.5-flash` → a versão datada).
      // Gravar o apelido faria a trilha dizer que dois modelos diferentes eram
      // o mesmo.
      return { objeto, modeloUsado: resposta.modelVersion ?? modelo }
    },
  }
}

export class IaGemini extends InterpretadorEstruturado {
  constructor(cliente: ClienteDeModelo = clienteGemini()) {
    super(PERFIL_GEMINI, cliente)
  }
}
