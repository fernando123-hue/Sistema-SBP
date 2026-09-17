import { ambiente } from '../servidor/ambiente'
import {
  formaEsperadaEmTexto,
  lerRespostaJson,
  type ClienteDeModelo,
  type PerfilDoFornecedor,
} from './fornecedor'
import { InterpretadorEstruturado } from './ia-estruturada'

/**
 * Adapter de IA — servidor de modelo local, compatível com OpenAI (`A56`).
 *
 * ═══ POR QUE ELE EXISTE ═══
 *
 * O dono quer IA local desde o início da implantação (`A51`): o e-mail do
 * associado não sai da associação, e o custo por chamada some. A decisão
 * `A56 (b)` diz COMO: o SBP fala com **qualquer servidor compatível com
 * OpenAI** — Ollama, llama.cpp, vLLM, LM Studio ou o que o Odysseus servir —,
 * e trocar de servidor é trocar um endereço. Nenhum SDK novo, nenhuma
 * dependência: `fetch` e o caminho `/chat/completions`, que é o que todos eles
 * implementam.
 *
 * É por isso que este arquivo NÃO se chama `ia-ollama.ts`. Amarrar o nome a um
 * servidor convidaria um `if` por servidor no dia seguinte; o contrato é o
 * protocolo, não o programa.
 *
 * ═══ O QUE ELE AINDA NÃO É ═══
 *
 * A máquina da IA local ainda não chegou (`A56 (d)`: garantida, fraca, 8 GB).
 * Então aqui existe estrutura, testada contra um servidor falso — nenhum
 * modelo foi medido, e `IA_PARA_DADO_REAL.local` nasce `false` em
 * `servidor/ambiente.ts`: **este adapter não recebe e-mail de associado**
 * enquanto o dono não decidir, com a nota do gabarito na mão
 * (`npm run ia:avaliar`).
 *
 * ═══ A DIFERENÇA HONESTA EM RELAÇÃO AOS OUTROS ═══
 *
 * Anthropic e Gemini são empresas com SDK; aqui é um servidor que alguém subiu.
 * Três consequências, todas assumidas:
 *
 *   1. **Não há modelo padrão.** Cada servidor serve o que baixaram nele, e
 *      inventar um padrão daria 404 do servidor com a pessoa procurando o
 *      defeito no endereço. `IA_MODELO` é obrigatório com este adapter, e a
 *      exigência falha na partida.
 *   2. **A forma vai como texto**, como no Gemini: `response_format` com
 *      esquema varia de servidor para servidor, e o que vale é a nossa
 *      revalidação no núcleo. Modelo pequeno ainda embrulha JSON em cerca de
 *      código — a cerca é retirada aqui, na borda, e não vira exceção de
 *      política.
 *   3. **O tempo é generoso.** Um modelo de 1 a 4 bilhões de parâmetros em CPU
 *      leva minutos, não segundos. O teto existe para que "pendurado para
 *      sempre" vire falha de transporte, que o sistema já sabe tratar.
 */

export type { ClienteDeModelo } from './fornecedor'

/**
 * Teto de tempo por chamada.
 *
 * Cinco minutos porque a máquina prometida é fraca e o modelo roda em CPU:
 * apertar isso transformaria operação normal em falha, e o e-mail iria à fila
 * humana por lentidão, não por dúvida. O que ele impede é a chamada que nunca
 * volta e segura o laço de ingestão sem prazo.
 */
const TEMPO_LIMITE_MS = 300_000

/**
 * Teto de saída.
 *
 * Mesmo raciocínio dos outros: estourar não pode ser truncado em silêncio. Uma
 * lista de trinta ligantes cortada na metade, gravada como se fosse inteira, é
 * carga que some sem erro.
 */
const MAXIMO_DE_TOKENS = 16_000

/** Classificar, não redigir. */
const TEMPERATURA = 0

/** Único fim aceitável no protocolo OpenAI. `length` é resposta cortada. */
const FINS_ACEITAVEIS = new Set(['stop'])

export const PERFIL_LOCAL: PerfilDoFornecedor = {
  nome: 'local',
  // Prefixo do fornecedor: a mesma redação rende resultados diferentes em
  // modelos diferentes, e sem ele a medida de acerto somaria populações
  // distintas sob um rótulo só.
  versaoPrompt: 'local-1.0.0',
  /**
   * **Vazio de propósito.** Não existe modelo que todo servidor local tenha;
   * `ambiente.ts` exige `IA_MODELO` quando `IA_ADAPTER="local"`, e é de lá que
   * vem o nome. Um padrão aqui seria um palpite disfarçado de configuração.
   */
  modeloPadrao: '',
  /**
   * Credencial recusada é sistema mal configurado — sobe acima do laço de
   * ingestão e para o lote, em vez de condenar mil e-mails um a um.
   *
   * `401` e `403`, nada mais: `500` e `503` são o servidor em apuros (modelo
   * carregando, memória estourada), que é falha transitória deste e-mail.
   */
  ehCredencialRecusada: (erro) => {
    if (typeof erro !== 'object' || erro === null) return false
    const status = (erro as { status?: unknown }).status
    return status === 401 || status === 403
  },
}

/**
 * O erro que o servidor local devolveu — **sem o corpo da resposta**.
 *
 * Servidor local costuma ecoar o pedido na mensagem de erro, e o pedido leva o
 * corpo do e-mail: nome, CPF, CRM. Copiar essa mensagem para o nosso erro a
 * levaria ao log, que não tem retenção (invariante 11), e à trilha. Quem
 * precisa consertar um `500` do próprio servidor lê o log DELE; daqui basta
 * saber que status veio.
 */
class FalhaDoServidorLocal extends Error {
  constructor(readonly status: number) {
    super(`o servidor de modelo respondeu ${status} (veja o log do próprio servidor)`)
  }
}

/**
 * Modelo pequeno devolve ```json … ``` mesmo mandado não devolver.
 *
 * A cerca é ruído de formatação da borda, não conteúdo: tirá-la aqui evita que
 * cada resposta assim vire uma ida à fila humana. O que está dentro continua
 * passando pelo `JSON.parse` e, depois, pelo Zod do núcleo — nada é aceito por
 * ser "quase" JSON.
 */
function semCercaDeCodigo(texto: string): string {
  const cercado = /^\s*```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/.exec(texto)
  return (cercado?.[1] ?? texto).trim()
}

interface RespostaOpenAI {
  model?: string
  choices?: { finish_reason?: string; message?: { content?: string } }[]
}

export function clienteLocal(): ClienteDeModelo {
  const base = ambiente().IA_LOCAL_URL
  // `ambiente()` já recusa `IA_ADAPTER=local` sem endereço; esta é a segunda
  // tranca, para o caso de alguém construir o adapter direto.
  if (!base) throw new Error('IA_LOCAL_URL ausente: o adapter local não pode subir.')

  const chave = ambiente().IA_LOCAL_CHAVE
  const alvo = `${base.replace(/\/+$/, '')}/chat/completions`

  return {
    async gerar({ instrucoes, conteudo, modelo, esquema }) {
      const resposta = await fetch(alvo, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(chave ? { authorization: `Bearer ${chave}` } : {}),
        },
        body: JSON.stringify({
          model: modelo,
          messages: [
            { role: 'system', content: `${instrucoes}${formaEsperadaEmTexto(esquema)}` },
            { role: 'user', content: conteudo },
          ],
          temperature: TEMPERATURA,
          max_tokens: MAXIMO_DE_TOKENS,
          // Pedido, não garantia: servidor que não conhece o campo o ignora, e
          // quem decide se a resposta serve é o Zod do núcleo.
          response_format: { type: 'json_object' },
        }),
        // `AbortSignal.timeout` porque aqui não há SDK com teto próprio: sem
        // ele, uma chamada pendurada segura o laço de ingestão para sempre.
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      })

      if (!resposta.ok) {
        // `status` no objeto para `ehCredencialRecusada` reconhecer 401 e 403
        // sem ler texto de erro, que varia de servidor para servidor.
        throw Object.assign(new FalhaDoServidorLocal(resposta.status), { status: resposta.status })
      }

      // `resposta.json()` estoura quando o corpo não é JSON — acontece com
      // proxy que devolve HTML de erro com status 200. Sem este `catch`, a
      // mensagem do runtime subiria no lugar do que houve de fato.
      let corpo: RespostaOpenAI
      try {
        corpo = (await resposta.json()) as RespostaOpenAI
      } catch {
        throw new Error('a resposta do servidor não é JSON')
      }
      const escolha = corpo.choices?.[0]

      const fim = escolha?.finish_reason
      if (fim && !FINS_ACEITAVEIS.has(fim)) {
        throw new Error(
          fim === 'length'
            ? `resposta truncada em ${MAXIMO_DE_TOKENS} tokens`
            : `o modelo interrompeu a geração (${fim})`,
        )
      }

      const texto = escolha?.message?.content
      if (!texto) {
        // Parece sucesso e não tem conteúdo: a pior resposta possível. Sem
        // isto, viraria "e-mail sem item nenhum" e o trabalho sumiria.
        throw new Error('o modelo devolveu resposta vazia')
      }

      // `modelo` na volta é o que o servidor diz ter usado — pode ser o nome
      // completo do arquivo carregado, e é ele que a trilha precisa guardar.
      return { objeto: lerRespostaJson(semCercaDeCodigo(texto)), modeloUsado: corpo.model || modelo }
    },
  }
}

export class IaLocal extends InterpretadorEstruturado {
  constructor(cliente: ClienteDeModelo = clienteLocal()) {
    super(PERFIL_LOCAL, cliente)
  }
}
