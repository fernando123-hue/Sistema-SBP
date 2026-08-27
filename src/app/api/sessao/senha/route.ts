import { cookies } from 'next/headers'

import { trocarSenha } from '../../../../servicos/autenticacao'
import { corpoJson, limitar, origemDaRequisicao, responder, rota } from '../../../../servidor/http'
import { obterPrisma } from '../../../../servidor/prisma'
import {
  OPCOES_DO_COOKIE,
  exigirAtorParaTrocaDeSenha,
  montarCookie,
  perfilAtual,
} from '../../../../servidor/sessao'

/**
 * Troca da própria senha.
 *
 * O corpo NÃO carrega de quem é a senha: quem troca é sempre o dono da sessão.
 * Trocar a senha de outra pessoa é operação de gestor e vive em
 * `/api/colaboradores/senha`.
 */
export async function POST(requisicao: Request): Promise<Response> {
  return rota(async () => {
    // Única rota que aceita sessão com senha provisória — é o caminho de saída
    // desse estado.
    const ator = await exigirAtorParaTrocaDeSenha()
    const perfil = await perfilAtual()

    // Confere a senha atual, então é oráculo de senha igual à entrada. O limite
    // por origem encarece a varredura; a trava que de fato segura é a de conta,
    // dentro do serviço.
    const recusa = limitar(`sessao:senha:${origemDaRequisicao(requisicao)}`, 10, 60)
    if (recusa) return recusa

    const { senhaDefinidaEm } = await trocarSenha(obterPrisma(), await corpoJson(requisicao), ator)

    // A troca revoga TODA sessão anterior desta pessoa, incluindo esta. Sem
    // reemitir o cookie aqui, quem acabou de definir a própria senha cairia na
    // tela de entrada no clique seguinte — e aprenderia que trocar a senha
    // quebra o sistema.
    const armazem = await cookies()
    armazem.set({
      ...OPCOES_DO_COOKIE,
      value: montarCookie(ator.colaboradorId, perfil!.papel, senhaDefinidaEm),
    })

    return responder({ trocada: true })
  })
}
