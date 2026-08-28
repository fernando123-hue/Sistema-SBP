import { exigirPapel } from '../../../../servidor/ator'
import { origemDaRequisicao, responder, rota } from '../../../../servidor/http'
import { exigirAtor } from '../../../../servidor/sessao'

/**
 * O que o servidor entende como a origem DESTA requisição.
 *
 * Existe porque a configuração de proxy erra em silêncio. Medido: um proxy que
 * não reescreve `x-forwarded-for` faz o Next preencher o cabeçalho com o
 * endereço do próprio proxy, e todos os clientes colapsam num balde de limite
 * de taxa só — a equipe inteira trancada a cada 20 entradas por minuto, com o
 * servidor achando que está separando as pessoas corretamente.
 *
 * Sem esta rota, o jeito de descobrir isso é a equipe parar de conseguir
 * entrar. Com ela, o operador confere uma vez depois de publicar:
 *
 *   - abra de dois dispositivos diferentes e compare `chave`
 *   - `chave` igual nos dois = todo mundo no mesmo balde: `PROXIES_CONFIAVEIS`
 *     não corresponde ao que o proxy realmente manda
 *   - `confiavel: false` = o limite por origem está desligado, e é o esperado
 *     em rede local
 *
 * Só gestor, e devolve apenas a origem de quem chamou — não é listagem de
 * ninguém.
 */
export async function GET(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    exigirPapel(ator, 'consultar diagnóstico de origem', 'gestor')

    const origem = origemDaRequisicao(requisicao)

    return responder({
      chave: origem.chave,
      confiavel: origem.confiavel,
      // Os cabeçalhos crus de encaminhamento, para comparar com o que o proxy
      // foi configurado para enviar. Nenhum outro cabeçalho sai daqui.
      recebido: {
        xForwardedFor: requisicao.headers.get('x-forwarded-for'),
        xRealIp: requisicao.headers.get('x-real-ip'),
      },
    })
  })
}
