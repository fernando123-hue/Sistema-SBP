import { cookies } from 'next/headers'

import { autenticar } from '../../../servicos/autenticacao'
import { atorAtual, montarCookie, OPCOES_DO_COOKIE } from '../../../servidor/sessao'
import {
  corpoJson,
  limitar,
  origemDaRequisicao,
  responder,
  rota,
} from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'

/**
 * Sessão.
 *
 * A identidade é PROVADA por e-mail e senha (`servicos/autenticacao`) e depois
 * TRANSPORTADA por um cookie HMAC. O corpo da requisição nunca diz quem você é
 * — nem aqui, nem em nenhuma outra rota.
 *
 * Dois limites de taxa, porque protegem coisas diferentes:
 *
 * - por origem, aqui, contra varredura de e-mails a partir de uma máquina;
 * - por conta, no serviço, contra força bruta distribuída sobre uma pessoa.
 *
 * Nenhum dos dois sozinho cobre os dois casos.
 */

export async function GET(): Promise<Response> {
  return rota(async () => {
    const ator = await atorAtual()
    if (!ator) return responder({ autenticado: false, colaborador: null })

    const colaborador = await obterPrisma().colaborador.findUnique({
      where: { id: ator.colaboradorId },
      select: { id: true, nome: true, papel: true, email: true, precisaTrocarSenha: true },
    })

    return responder({ autenticado: true, colaborador })
  })
}

export async function POST(requisicao: Request): Promise<Response> {
  return rota(async () => {
    // Chave POR ORIGEM. Uma chave fixa aqui era um DoS trivial: 21 requisições
    // de qualquer pessoa, sem autenticação, travavam a entrada da equipe
    // inteira até a janela reiniciar.
    const recusa = limitar(`sessao:entrar:${origemDaRequisicao(requisicao)}`, 20, 60)
    if (recusa) return recusa

    const entrada = await autenticar(obterPrisma(), await corpoJson(requisicao))

    const armazem = await cookies()
    armazem.set({
      ...OPCOES_DO_COOKIE,
      value: montarCookie(entrada.colaboradorId, entrada.papel, entrada.senhaDefinidaEm),
    })

    return responder({
      id: entrada.colaboradorId,
      nome: entrada.nome,
      papel: entrada.papel,
      precisaTrocarSenha: entrada.precisaTrocarSenha,
    })
  })
}

export async function DELETE(): Promise<Response> {
  return rota(async () => {
    const armazem = await cookies()
    armazem.set({ ...OPCOES_DO_COOKIE, value: '', maxAge: 0 })
    return responder({ encerrada: true })
  })
}
