import { createHmac, timingSafeEqual } from 'node:crypto'

import { cookies } from 'next/headers'

import { PapelSchema, type Papel } from '../core/esquemas'
import { ambiente } from './ambiente'
import { atorDaSessao, type Ator } from './ator'
import { obterPrisma } from './prisma'

/**
 * Sessão.
 *
 * PROVISÓRIA E DECLARADA COMO TAL — ver DECISOES.md § AT-08. Não há senha
 * ainda: o operador escolhe quem é numa tela de desenvolvimento.
 *
 * O que já é definitivo, e é o que importa: a identidade vem de um COOKIE
 * ASSINADO, nunca do corpo da requisição. O cliente não consegue forjar
 * `colaboradorId` sem o segredo do servidor. Quando a autenticação real entrar,
 * troca-se a forma de PROVAR a identidade; a forma de TRANSPORTÁ-LA para os
 * serviços (`Ator`) continua a mesma.
 *
 * Cookie: `httpOnly`, `sameSite=lax`, `secure` fora de desenvolvimento.
 */

const NOME_DO_COOKIE = 'sbp_sessao'
const VALIDADE_SEGUNDOS = 60 * 60 * 12

interface Conteudo {
  colaboradorId: string
  papel: Papel
  expiraEm: number
}

function segredo(): string {
  const valor = ambiente().SESSAO_SECRET
  // Sem segredo não existe assinatura: assinar com string vazia daria a
  // aparência de proteção enquanto qualquer um forjaria o cookie.
  if (!valor || valor.length < 16) {
    throw new Error(
      'SESSAO_SECRET ausente ou curto demais (mínimo 16 caracteres). ' +
        'Gere um com: node -e "console.log(crypto.randomUUID())"',
    )
  }
  return valor
}

function assinar(carga: string): string {
  return createHmac('sha256', segredo()).update(carga).digest('base64url')
}

function conferirAssinatura(carga: string, assinatura: string): boolean {
  const esperada = Buffer.from(assinar(carga))
  const recebida = Buffer.from(assinatura)
  // Comparação em tempo constante: evita descobrir a assinatura byte a byte.
  if (esperada.length !== recebida.length) return false
  return timingSafeEqual(esperada, recebida)
}

export function montarCookie(colaboradorId: string, papel: Papel): string {
  const conteudo: Conteudo = {
    colaboradorId,
    papel,
    expiraEm: Date.now() + VALIDADE_SEGUNDOS * 1000,
  }
  const carga = Buffer.from(JSON.stringify(conteudo)).toString('base64url')
  return `${carga}.${assinar(carga)}`
}

export function lerCookie(valor: string | undefined): Conteudo | null {
  if (!valor) return null

  const separador = valor.lastIndexOf('.')
  if (separador <= 0) return null

  const carga = valor.slice(0, separador)
  const assinatura = valor.slice(separador + 1)
  if (!conferirAssinatura(carga, assinatura)) return null

  try {
    const conteudo = JSON.parse(Buffer.from(carga, 'base64url').toString()) as Conteudo
    if (typeof conteudo.expiraEm !== 'number' || conteudo.expiraEm < Date.now()) return null
    return { ...conteudo, papel: PapelSchema.parse(conteudo.papel) }
  } catch {
    return null
  }
}

export const OPCOES_DO_COOKIE = {
  name: NOME_DO_COOKIE,
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: process.env['NODE_ENV'] === 'production',
  maxAge: VALIDADE_SEGUNDOS,
} as const

/** Ator da requisição atual, ou `null` quando não há sessão válida. */
export async function atorAtual(): Promise<Ator | null> {
  const armazem = await cookies()
  const conteudo = lerCookie(armazem.get(NOME_DO_COOKIE)?.value)
  if (!conteudo) return null

  // O papel é reconferido no banco a cada requisição: rebaixar alguém tem
  // efeito imediato, sem esperar o cookie expirar.
  const colaborador = await obterPrisma().colaborador.findUnique({
    where: { id: conteudo.colaboradorId },
    select: { id: true, papel: true, ativo: true },
  })
  if (!colaborador?.ativo) return null

  return atorDaSessao({ colaboradorId: colaborador.id, papel: colaborador.papel })
}

export class SemSessaoError extends Error {
  readonly codigo = 'SEM_SESSAO'
  constructor() {
    super('Sessão ausente ou expirada.')
    this.name = 'SemSessaoError'
  }
}

/** Use nas rotas: devolve o ator ou interrompe. */
export async function exigirAtor(): Promise<Ator> {
  const ator = await atorAtual()
  if (!ator) throw new SemSessaoError()
  return ator
}
