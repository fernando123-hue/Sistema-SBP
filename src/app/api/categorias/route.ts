import type { CategoriaDisponivel } from '../../../core/tipos'
import { responder, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { exigirAtor } from '../../../servidor/sessao'

/**
 * Categorias ativas do cadastro.
 *
 * Existe para a tela de habilitação ter o que oferecer. Poderia sair da
 * constante `CATEGORIAS_CADASTRO`, que é a mesma fonte do seed — mas a tabela
 * pode divergir dela (categoria desativada, rótulo ajustado), e oferecer ao
 * gestor uma categoria que o banco não tem produziria erro na hora de gravar.
 * A tela pergunta ao banco o que existe de verdade.
 *
 * Só leitura, como todo o resto do cadastro consultável.
 */
export async function GET(): Promise<Response> {
  return rota(async () => {
    await exigirAtor()

    // Tipada pelo contrato que as duas telas leem: mudar o `select` sem mudar
    // `CategoriaDisponivel` não compila mais, em vez de sumir com um campo da
    // Caixa em produção.
    const categorias: CategoriaDisponivel[] = await obterPrisma().categoria.findMany({
      where: { ativa: true },
      orderBy: { ordem: 'asc' },
      select: { codigo: true, rotulo: true, grupo: true, entraNoRateio: true },
    })

    return responder(categorias)
  })
}
