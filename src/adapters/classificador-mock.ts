import type { Resposta } from '../ports/classificador'
import type { ClienteDeClassificacao, PerfilDoClassificador } from './classificador-externo'

/**
 * Classificador simulado — sem rede, sem custo, determinístico.
 *
 * Existe para a tela e a suíte exercitarem o caminho INTEIRO da segunda
 * opinião — camada de defesa, delimitação, conferência da resposta — sem falar
 * com ninguém. Ele passa pela mesma `ClassificadorExterno` que o fornecedor de
 * verdade: um dublê que pulasse a política provaria a política por engano.
 *
 * Ele não opina de verdade, e não finge: responde sempre o PRIMEIRO rótulo
 * com certeza total, "não" com probabilidade zero e a nota mais baixa. Nada
 * nisso depende do texto — um mock que "acertasse" palavras-chave seria um
 * classificador de regra disfarçado, e alguém acabaria medindo-o.
 */

export const PERFIL_MOCK: PerfilDoClassificador = {
  nome: 'mock',
  modeloPadrao: 'mock-1',
  ehCredencialRecusada: () => false,
}

export function clienteMock(): ClienteDeClassificacao {
  return {
    async perguntar({ perguntas, modelo }) {
      const respostas: Record<string, Resposta> = {}
      for (const [nome, pergunta] of Object.entries(perguntas)) {
        if (pergunta.tipo === 'sim_ou_nao') {
          respostas[nome] = { tipo: 'sim_ou_nao', probabilidadeDeSim: 0 }
          continue
        }
        const rotulos =
          pergunta.tipo === 'escolha'
            ? Object.keys(pergunta.opcoes)
            : pergunta.niveis.map((_, indice) => String(indice))
        const probabilidades = Object.fromEntries(rotulos.map((rotulo, i) => [rotulo, i === 0 ? 1 : 0]))
        respostas[nome] =
          pergunta.tipo === 'escolha'
            ? { tipo: 'escolha', escolha: rotulos[0]!, confianca: 1, probabilidades }
            : { tipo: 'nota', nota: 0, confianca: 1, probabilidades }
      }
      return { respostas, modeloUsado: modelo }
    },
  }
}
