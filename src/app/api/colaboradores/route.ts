import { responder, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'

/**
 * Lista de colaboradores para a tela de entrada provisória.
 *
 * Expõe apenas nome e papel — nada de e-mail, senha ou dado pessoal. Quando a
 * autenticação real entrar (DECISOES.md § AT-08), esta rota sai.
 */
export async function GET(): Promise<Response> {
  return rota(async () => {
    const colaboradores = await obterPrisma().colaborador.findMany({
      where: { ativo: true },
      orderBy: [{ papel: 'asc' }, { nome: 'asc' }],
      select: { id: true, nome: true, papel: true },
    })

    return responder(colaboradores)
  })
}
