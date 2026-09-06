import { listar, registrar } from '../../../servicos/afastamentos'
import { corpoJson, responder, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { exigirAtor } from '../../../servidor/sessao'

/**
 * Afastamentos — férias, atestado, falta (`A10`).
 *
 * Quem está afastado sai do rateio automaticamente em `carregarElegiveis`, sem
 * ninguém precisar desmarcar a escala dia a dia.
 */

export async function GET(): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    return responder(await listar(obterPrisma(), ator))
  })
}

export async function POST(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    return responder(await registrar(obterPrisma(), await corpoJson(requisicao), ator))
  })
}
