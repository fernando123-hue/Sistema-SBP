import { cookies } from 'next/headers'
import { z } from 'zod'

import { atorAtual, montarCookie, OPCOES_DO_COOKIE } from '../../../servidor/sessao'
import { corpoJson, limitar, responder, responderErro, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { PapelSchema } from '../../../core/esquemas'

/**
 * Sessão.
 *
 * PROVISÓRIO — ver DECISOES.md § AT-08. Não há senha: escolhe-se quem é numa
 * lista. O que já está no lugar certo é a assinatura: a identidade viaja num
 * cookie HMAC e o cliente não consegue forjá-la.
 *
 * O limite de taxa existe para que a troca de identidade não vire ferramenta
 * de enumeração de colaboradores.
 */

const EntrarSchema = z.object({ colaboradorId: z.string().min(1) })

export async function GET(): Promise<Response> {
  return rota(async () => {
    const ator = await atorAtual()
    if (!ator) return responder({ autenticado: false, colaborador: null })

    const colaborador = await obterPrisma().colaborador.findUnique({
      where: { id: ator.colaboradorId },
      select: { id: true, nome: true, papel: true, email: true },
    })

    return responder({ autenticado: true, colaborador })
  })
}

export async function POST(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const recusa = limitar('sessao:entrar', 20, 60)
    if (recusa) return recusa

    const dados = EntrarSchema.parse(await corpoJson(requisicao))

    const colaborador = await obterPrisma().colaborador.findUnique({
      where: { id: dados.colaboradorId },
      select: { id: true, nome: true, papel: true, ativo: true },
    })

    // Mensagem deliberadamente igual para "não existe" e "inativo": não confirma
    // a existência de um identificador para quem estiver sondando.
    if (!colaborador?.ativo) return responderErro('Colaborador indisponível.', 404)

    const armazem = await cookies()
    armazem.set({
      ...OPCOES_DO_COOKIE,
      value: montarCookie(colaborador.id, PapelSchema.parse(colaborador.papel)),
    })

    return responder({ id: colaborador.id, nome: colaborador.nome, papel: colaborador.papel })
  })
}

export async function DELETE(): Promise<Response> {
  return rota(async () => {
    const armazem = await cookies()
    armazem.set({ ...OPCOES_DO_COOKIE, value: '', maxAge: 0 })
    return responder({ encerrada: true })
  })
}
