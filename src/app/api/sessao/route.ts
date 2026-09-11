import { cookies } from 'next/headers'

import { autenticar } from '../../../servicos/autenticacao'
import { atorAtual, montarCookie, OPCOES_DO_COOKIE } from '../../../servidor/sessao'
import { corpoJson, limitarPorOrigem, responder, rota } from '../../../servidor/http'
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
    const recusa = limitarPorOrigem(requisicao, 'sessao:entrar', 20, 60)
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

/**
 * Sair — e sair de verdade.
 *
 * Apagar o cookie do navegador NÃO era revogação: o valor de `sbp_sessao`
 * continuava assinado e válido por até 12h, então uma cópia levada da máquina
 * compartilhada seguia autenticando por mais que o dono clicasse em "sair". A
 * revogação de verdade é o carimbo em `sessoesInvalidasAntes`, conferido em
 * `perfilAtual` a cada requisição.
 *
 * ISTO ENCERRA AS SESSÕES DA PESSOA EM TODOS OS DISPOSITIVOS, e é deliberado.
 * Encerrar só este navegador exigiria identificar cada cookie individualmente —
 * uma tabela de sessões que este sistema não tem — e deixaria de pé justamente
 * a cópia que o gesto existe para matar. Para quem opera, "saí do sistema"
 * significar "saí do sistema" é o comportamento esperado; o custo é reentrar no
 * celular, e ele é pequeno perto de um acesso indevido que dura meio dia.
 *
 * `atorAtual`, e não `exigirAtor`: quem está com a senha provisória também
 * precisa conseguir sair, e `exigirAtor` recusa justamente essa pessoa. Sem
 * sessão válida, apagar o cookie e responder sucesso é a resposta certa — não
 * há nada a revogar, e devolver erro faria a saída falhar para quem já estava
 * fora, que é o caso em que a tela mais precisa que ela funcione.
 */
export async function DELETE(): Promise<Response> {
  return rota(async () => {
    const ator = await atorAtual()

    if (ator) {
      await obterPrisma().colaborador.update({
        where: { id: ator.colaboradorId },
        data: { sessoesInvalidasAntes: new Date() },
      })
    }

    const armazem = await cookies()
    armazem.set({ ...OPCOES_DO_COOKIE, value: '', maxAge: 0 })
    return responder({ encerrada: true })
  })
}
