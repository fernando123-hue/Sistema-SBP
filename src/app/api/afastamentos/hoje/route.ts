import { quemEstaFora } from '../../../../servicos/afastamentos'
import { responder, rota } from '../../../../servidor/http'
import { obterPrisma } from '../../../../servidor/prisma'
import { exigirAtor } from '../../../../servidor/sessao'

/**
 * Quem está fora hoje — para o Painel (`A10`).
 *
 * SEM checagem de papel, e isso é deliberado: o que a resposta diz já vem
 * redigido pelo papel de quem pediu. Gestor recebe o motivo; todo mundo mais
 * recebe "de férias" ou "indisponível". O que protege aqui é o conteúdo, não a
 * porta — a operação inteira precisa saber quem não vai receber trabalho hoje.
 */
export async function GET(): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    return responder(await quemEstaFora(obterPrisma(), ator))
  })
}
