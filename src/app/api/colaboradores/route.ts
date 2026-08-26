import { limitar, origemDaRequisicao, responder, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'

/**
 * Lista de colaboradores para a tela de entrada provisória.
 *
 * RISCO CONHECIDO E ACEITO NESTE ESTÁGIO: esta rota é pública por necessidade
 * — é ela que popula a tela de entrada, e a entrada ainda não tem senha
 * (DECISOES.md § AT-08). Junto com `POST /api/sessao`, isso significa que
 * qualquer pessoa que alcance o servidor pode assumir qualquer identidade,
 * inclusive a de gestor.
 *
 * O limite de taxa abaixo só encarece a varredura automatizada; NÃO resolve o
 * problema. A correção real é a autenticação com senha, e ela precisa entrar
 * antes de qualquer dado real de associado — e antes de o sistema ser exposto
 * fora da rede local.
 */
export async function GET(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const recusa = limitar(`colaboradores:${origemDaRequisicao(requisicao)}`, 30, 60)
    if (recusa) return recusa

    const colaboradores = await obterPrisma().colaborador.findMany({
      where: { ativo: true },
      orderBy: [{ papel: 'asc' }, { nome: 'asc' }],
      select: { id: true, nome: true, papel: true },
    })

    return responder(colaboradores)
  })
}
