import { createHmac, timingSafeEqual } from 'node:crypto'

import { cookies } from 'next/headers'

import { PapelSchema, type Papel } from '../core/esquemas'
import { ambiente } from './ambiente'
import { atorDaSessao, type Ator } from './ator'
import { obterPrisma } from './prisma'

/**
 * Sessão.
 *
 * Divisão de trabalho: `servicos/autenticacao` PROVA quem a pessoa é (e-mail e
 * senha); este arquivo TRANSPORTA essa identidade pelo resto da requisição.
 * Manter os dois separados foi o que permitiu trocar a prova — antes era
 * "escolha um nome numa lista" — sem tocar em nenhum serviço.
 *
 * A identidade vem sempre de um COOKIE ASSINADO, nunca do corpo da requisição:
 * o cliente não forja `colaboradorId` sem o segredo do servidor.
 *
 * Cookie: `httpOnly`, `sameSite=lax`, `secure` fora de desenvolvimento.
 */

const NOME_DO_COOKIE = 'sbp_sessao'
const VALIDADE_SEGUNDOS = 60 * 60 * 12

interface Conteudo {
  colaboradorId: string
  papel: Papel
  expiraEm: number
  /**
   * `senhaDefinidaEm` de quando o cookie foi emitido.
   *
   * É o que torna a troca de senha uma REVOGAÇÃO. Sem isto, a pessoa que
   * desconfia de um acesso indevido troca a senha — a única reação que ela
   * conhece — e o cookie roubado continua valendo até 12h, justamente no
   * cenário em que o gesto precisava funcionar.
   */
  senhaEm: number | null
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

export function montarCookie(
  colaboradorId: string,
  papel: Papel,
  senhaDefinidaEm: Date | null,
): string {
  const conteudo: Conteudo = {
    colaboradorId,
    papel,
    expiraEm: Date.now() + VALIDADE_SEGUNDOS * 1000,
    senhaEm: senhaDefinidaEm?.getTime() ?? null,
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

export interface PerfilAtual {
  ator: Ator
  nome: string
  papel: Papel
  /** Senha ainda é a provisória entregue pelo gestor: nada além da troca é permitido. */
  precisaTrocarSenha: boolean
}

/**
 * Perfil completo da requisição atual.
 *
 * Uma única consulta traz identidade E nome. Antes, o layout raiz consultava
 * `colaborador` por conta própria — pulando a camada de serviço e repetindo a
 * mesma leitura que `atorAtual` já fazia, duas vezes por navegação.
 */
export async function perfilAtual(): Promise<PerfilAtual | null> {
  const armazem = await cookies()
  const conteudo = lerCookie(armazem.get(NOME_DO_COOKIE)?.value)
  if (!conteudo) return null

  // O papel é reconferido no banco a cada requisição: rebaixar alguém tem
  // efeito imediato, sem esperar o cookie expirar. Vale igual para
  // `precisaTrocarSenha` — o gestor redefinir uma senha volta a exigir a troca
  // na hora, mesmo em sessão já aberta.
  const colaborador = await obterPrisma().colaborador.findUnique({
    where: { id: conteudo.colaboradorId },
    select: {
      id: true,
      nome: true,
      papel: true,
      ativo: true,
      precisaTrocarSenha: true,
      senhaDefinidaEm: true,
    },
  })
  if (!colaborador?.ativo) return null

  // Senha mudou depois deste cookie: a sessão morre aqui. Vale para a troca
  // feita pelo dono e para a redefinição feita pelo gestor.
  if ((colaborador.senhaDefinidaEm?.getTime() ?? null) !== conteudo.senhaEm) return null

  const papel = PapelSchema.parse(colaborador.papel)
  return {
    ator: atorDaSessao({ colaboradorId: colaborador.id, papel }),
    nome: colaborador.nome,
    papel,
    precisaTrocarSenha: colaborador.precisaTrocarSenha,
  }
}

/** Ator da requisição atual, ou `null` quando não há sessão válida. */
export async function atorAtual(): Promise<Ator | null> {
  return (await perfilAtual())?.ator ?? null
}

export class SemSessaoError extends Error {
  readonly codigo = 'SEM_SESSAO'
  constructor() {
    super('Sessão ausente ou expirada.')
    this.name = 'SemSessaoError'
  }
}

export class SenhaProvisoriaError extends Error {
  readonly codigo = 'SENHA_PROVISORIA'
  constructor() {
    super('Defina uma senha própria antes de usar o sistema.')
    this.name = 'SenhaProvisoriaError'
  }
}

/**
 * Use nas rotas: devolve o ator ou interrompe.
 *
 * Recusa também quem ainda está com a senha provisória, e é aqui que essa
 * regra vive porque é o ÚNICO ponto por onde toda rota passa. Bloquear só na
 * navegação deixaria a API aberta: quem entregou a provisória a conhece, e
 * conhecer a senha é conseguir um cookie válido. A janela em que outra pessoa
 * pode agir em nome do dono termina no primeiro acesso dele, não em "confio
 * que ninguém vai chamar a API na mão".
 */
export async function exigirAtor(): Promise<Ator> {
  const perfil = await perfilAtual()
  if (!perfil) throw new SemSessaoError()
  if (perfil.precisaTrocarSenha) throw new SenhaProvisoriaError()
  return perfil.ator
}

/** Só para a rota de troca de senha: é a única operação permitida com a provisória. */
export async function exigirAtorParaTrocaDeSenha(): Promise<Ator> {
  const perfil = await perfilAtual()
  if (!perfil) throw new SemSessaoError()
  return perfil.ator
}
