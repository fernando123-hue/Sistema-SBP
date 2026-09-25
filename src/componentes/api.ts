'use client'

/**
 * Cliente da API.
 *
 * As telas conversam com o sistema pelos MESMOS endpoints que o sistema legado
 * do cliente vai usar. Nenhuma tela fala com o banco direto — é o que garante
 * que a integração não vira um caminho paralelo com regras próprias.
 */

export interface Envelope<T> {
  sucesso: boolean
  dados: T | null
  erro: string | null
  correlacaoId?: string
}

export class ErroDaApi extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
    readonly correlacaoId?: string,
    causa?: unknown,
  ) {
    // `cause`: a frase da tela é genérica de propósito, e o motivo real não
    // pode sumir com ela — `fetch` rejeita com `TypeError` também por defeito
    // de código (cabeçalho inválido, URL malformada), não só por rede caída.
    super(mensagem, causa === undefined ? undefined : { cause: causa })
    this.name = 'ErroDaApi'
  }
}

/**
 * Quantas requisições estão em voo agora, e quem quer saber disso.
 *
 * ═══ POR QUE AQUI ═══
 *
 * Este arquivo já é a porta ÚNICA por onde toda tela fala com o sistema —
 * nenhuma delas chama `fetch` por conta própria. Isso o torna o único lugar
 * capaz de responder "o sistema está trabalhando agora?" sem que cada tela
 * precise avisar, e sem inventar um estado global paralelo.
 *
 * Existe para a marca poder respirar enquanto há trabalho em voo: um indicador
 * que É a identidade, em vez de um genérico ao lado dela. Não é métrica, não é
 * gravado e não vira número de painel — é o fato mais efêmero que existe no
 * sistema, e morre no instante em que a resposta chega.
 *
 * Contador e não booleano: duas requisições simultâneas terminando em ordens
 * diferentes zerariam o sinal cedo demais se fosse um `true`/`false`.
 */
let emVoo = 0
const ouvintes = new Set<(ocupado: boolean) => void>()

function avisar(): void {
  const ocupado = emVoo > 0
  for (const ouvinte of ouvintes) ouvinte(ocupado)
}

/** Assina o sinal de atividade. Devolve a função que cancela a assinatura. */
export function observarAtividade(ouvinte: (ocupado: boolean) => void): () => void {
  ouvintes.add(ouvinte)
  // Avisa o estado ATUAL na hora de assinar: quem monta no meio de uma
  // requisição precisa começar já sabendo, senão o indicador só aparece na
  // requisição seguinte.
  ouvinte(emVoo > 0)
  return () => {
    ouvintes.delete(ouvinte)
  }
}

/**
 * O que a pessoa lê quando o sistema não respondeu com uma frase própria.
 *
 * Antes era "Falha na requisição (404)." — engenharia na tela de quem atende
 * associado. Os casos reais: a página HTML de 404 do servidor de telas no lugar
 * do envelope (pendência 16), resposta vazia, e a rede fora do ar, que chegava
 * como "Failed to fetch", em inglês. O status não some: fica em
 * `ErroDaApi.status` (a tela de entrada o lê), vai ao fim da frase como código
 * (`mensagemDoErro`) e ao console do navegador com a causa — sem isso, um 500
 * de verdade e o Wi-Fi caindo ficariam iguais para todo mundo.
 */
export const SEM_RESPOSTA_LEGIVEL = 'Não foi possível falar com o sistema. Atualize a tela e tente de novo.'

async function requisitar<T>(
  caminho: string,
  opcoes: { metodo?: string; corpo?: unknown } = {},
): Promise<T> {
  const inicializacao: RequestInit = {
    method: opcoes.metodo ?? 'GET',
    // O cookie de sessão é httpOnly; precisa ir junto.
    credentials: 'same-origin',
  }

  if (opcoes.corpo !== undefined) {
    inicializacao.headers = { 'Content-Type': 'application/json' }
    inicializacao.body = JSON.stringify(opcoes.corpo)
  }

  emVoo += 1
  avisar()

  // `finally` e não decremento no fim do corpo: requisição que estoura — rede
  // caída, aborto — precisa liberar o contador do mesmo jeito. Sem isto, uma
  // falha de rede deixaria a marca respirando para sempre, afirmando um
  // trabalho que não existe mais.
  try {
    // Status 0 é a convenção do próprio navegador para "não houve resposta".
    const resposta = await fetch(`/api${caminho}`, inicializacao).catch((causa: unknown) => {
      console.error('Sem resposta do sistema', { caminho, causa })
      throw new ErroDaApi(SEM_RESPOSTA_LEGIVEL, 0, undefined, causa)
    })

    const envelope = (await resposta.json().catch(() => null)) as Envelope<T> | null

    if (!resposta.ok || !envelope?.sucesso) {
      // 401 é sessão ausente ou expirada, e SÓ isso: entrada com senha errada
      // é `ErroDeNegocio` (422), então não há risco de laço na tela de entrada.
      //
      // Sem este desvio, o cookie vencendo com uma tela aberta deixava a pessoa
      // presa: o layout só desenha a navegação quando há perfil, então a barra
      // inteira sumia — nenhum link, nenhum "entrar" —, a tarja de erro ficava,
      // e o único caminho de volta era digitar /entrar na barra de endereços.
      // Recarregar a página, que é o que qualquer um tenta, piorava.
      if (resposta.status === 401 && typeof window !== 'undefined') {
        if (window.location.pathname !== '/entrar') {
          window.location.assign('/entrar')
        }
      }

      // `typeof` e não `??`: envelope com `erro: ''` viraria tarja vazia.
      const frase = typeof envelope?.erro === 'string' && envelope.erro.trim() !== '' ? envelope.erro : null
      if (frase === null) {
        console.error('Resposta do sistema sem erro legível', {
          caminho,
          status: resposta.status,
          tipo: resposta.headers.get('content-type'),
          correlacaoId: envelope?.correlacaoId,
        })
      }
      throw new ErroDaApi(frase ?? SEM_RESPOSTA_LEGIVEL, resposta.status, envelope?.correlacaoId)
    }

    return envelope.dados as T
  } finally {
    emVoo -= 1
    avisar()
  }
}

export const api = {
  buscar: <T,>(caminho: string) => requisitar<T>(caminho),
  enviar: <T,>(caminho: string, corpo?: unknown) => requisitar<T>(caminho, { metodo: 'POST', corpo }),
  atualizar: <T,>(caminho: string, corpo?: unknown) => requisitar<T>(caminho, { metodo: 'PUT', corpo }),
  /** `PATCH`: muda UM campo, sem afirmar nada sobre o resto do registro. */
  ajustar: <T,>(caminho: string, corpo?: unknown) => requisitar<T>(caminho, { metodo: 'PATCH', corpo }),
  /** Corpo opcional: arquivar nota leva o motivo; sair e cancelar afastamento, não. */
  remover: <T,>(caminho: string, corpo?: unknown) =>
    requisitar<T>(caminho, { metodo: 'DELETE', corpo }),
}

export function mensagemDoErro(erro: unknown): string {
  if (erro instanceof ErroDaApi) {
    if (erro.correlacaoId) return `${erro.message} (ref. ${erro.correlacaoId.slice(0, 8)})`
    // Sem referência do servidor, o código é o único número que a pessoa pode
    // repassar a quem investiga: "deu 500" e "deu 404" são defeitos diferentes.
    // Status 0 (nada respondeu) não tem código a mostrar.
    if (erro.message === SEM_RESPOSTA_LEGIVEL && erro.status > 0) return `${erro.message} (código ${erro.status})`
    return erro.message
  }
  if (erro instanceof Error) return erro.message
  return 'Erro inesperado.'
}
