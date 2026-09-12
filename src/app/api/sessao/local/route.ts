import { cookies } from 'next/headers'
import { z } from 'zod'

import { PapelSchema } from '../../../../core/esquemas'
import { auditar } from '../../../../servicos/auditoria'
import {
  DOMINIO_SINTETICO,
  acessoLocalHabilitado,
  ehContaSintetica,
  ehPedidoDaPropriaTela,
  ehRequisicaoLocal,
} from '../../../../servidor/acesso-local'
import { corpoJson, limitarPorOrigem, responder, responderErro, rota } from '../../../../servidor/http'
import { novaCorrelacao } from '../../../../servidor/observabilidade'
import { obterPrisma } from '../../../../servidor/prisma'
import { montarCookie, OPCOES_DO_COOKIE } from '../../../../servidor/sessao'

/**
 * Acesso local sem senha — só desenvolvimento.
 *
 * As cinco travas estão em `servidor/acesso-local.ts`. Aqui, o que importa:
 *
 * - **Desligado, a rota não existe.** Responde 404, igual a um caminho que nunca
 *   foi criado — nem "desligado", nem "proibido". Quem varre o sistema publicado
 *   não descobre que a porta existe.
 * - **O corpo escolhe a CONTA, não a identidade.** É o mesmo papel do e-mail na
 *   entrada com senha: diz em quem se quer entrar. A identidade que as outras
 *   rotas usam continua vindo só do cookie assinado (invariante 5).
 * - **Conta real não entra.** E-mail fora de `@exemplo.test` recebe o mesmo 404,
 *   sem distinguir "não existe" de "não é sintética".
 */

const PedidoSchema = z
  .object({ email: z.string().trim().toLowerCase().email().max(254) })
  .strict()

function inexistente(): Response {
  return responderErro('Não encontrado.', 404)
}

/** Lista as contas sintéticas ativas, para a tela de entrada oferecer o acesso local. */
export async function GET(requisicao: Request): Promise<Response> {
  return rota(async () => {
    if (!acessoLocalHabilitado() || !ehRequisicaoLocal(requisicao)) return inexistente()

    const contas = await obterPrisma().colaborador.findMany({
      where: { ativo: true, email: { endsWith: DOMINIO_SINTETICO } },
      select: { nome: true, email: true, papel: true },
      orderBy: [{ papel: 'asc' }, { nome: 'asc' }],
    })

    return responder(contas)
  })
}

export async function POST(requisicao: Request): Promise<Response> {
  return rota(async () => {
    if (!acessoLocalHabilitado() || !ehRequisicaoLocal(requisicao)) return inexistente()

    // Antes de ler o corpo: formulário de outro site não chega nem a ser
    // interpretado. Mesmo 404 das outras recusas.
    if (!ehPedidoDaPropriaTela(requisicao)) return inexistente()

    const recusa = limitarPorOrigem(requisicao, 'sessao:local', 20, 60)
    if (recusa) return recusa

    const { email } = PedidoSchema.parse(await corpoJson(requisicao))
    if (!ehContaSintetica(email)) return inexistente()

    const banco = obterPrisma()
    const pessoa = await banco.colaborador.findUnique({
      where: { email },
      select: { id: true, nome: true, papel: true, ativo: true, senhaDefinidaEm: true },
    })
    if (!pessoa?.ativo) return inexistente()

    const papel = PapelSchema.parse(pessoa.papel)

    // Gravado ANTES de entregar o cookie: uma entrada que a trilha não conhece
    // não pode acontecer. Se a gravação falhar, a rota devolve erro e ninguém
    // entra.
    await banco.$transaction(async (tx) => {
      await auditar(tx, {
        entidade: 'Colaborador',
        entidadeId: pessoa.id,
        acao: 'entrada_local_sem_senha',
        depois: { papel },
        usuario: pessoa.id,
        correlacaoId: novaCorrelacao(),
      })
    })

    const armazem = await cookies()
    armazem.set({
      ...OPCOES_DO_COOKIE,
      value: montarCookie(pessoa.id, papel, pessoa.senhaDefinidaEm, { local: true }),
    })

    return responder({ nome: pessoa.nome, papel })
  })
}
