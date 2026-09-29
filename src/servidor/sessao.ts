import { createHmac, timingSafeEqual } from 'node:crypto'

import { cookies } from 'next/headers'

import { PapelSchema, type Papel } from '../core/esquemas'
import { acessoLocalHabilitado, ehContaSintetica } from './acesso-local'
import { ambiente } from './ambiente'
import { atorDaSessao, type Ator } from './ator'
import { registrarLog } from './observabilidade'
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
   * Quando este cookie foi emitido.
   *
   * É o que permite a `sessoesInvalidasAntes` revogar sessões: sem saber a
   * idade do cookie, não há como dizer se ele é anterior ao "sair". Mesmo papel
   * que `senhaEm`, para o outro gesto de revogação.
   */
  emitidoEm: number
  /**
   * `senhaDefinidaEm` de quando o cookie foi emitido.
   *
   * É o que torna a troca de senha uma REVOGAÇÃO. Sem isto, a pessoa que
   * desconfia de um acesso indevido troca a senha — a única reação que ela
   * conhece — e o cookie roubado continua valendo até 12h, justamente no
   * cenário em que o gesto precisava funcionar.
   */
  senhaEm: number | null
  /**
   * Sessão aberta pelo acesso local sem senha (`servidor/acesso-local.ts`).
   *
   * Vai DENTRO da carga assinada: sem o segredo, ninguém acrescenta nem retira
   * a marca. É ela que permite derrubar essas sessões no instante em que o
   * acesso local é desligado, sem tocar nas sessões abertas com senha.
   */
  local?: true
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

/**
 * A chave de antes da troca (`SESSAO_SECRET_ANTERIOR`, achado C-25), enquanto
 * ela ainda pode ser necessária.
 *
 * Todo cookie legítimo assinado com ela foi emitido ANTES de este processo
 * subir com a chave nova, e vale 12h: passado esse prazo, contado da subida
 * do processo, nenhum cookie legítimo depende dela. Um forjado com a chave
 * vazada depende — e ele escolhe o próprio `expiraEm`. Por isso o prazo é do
 * processo, não do cookie.
 *
 * `performance.now()` é o tempo desde a subida pelo relógio MONOTÔNICO: um
 * relógio de parede corrigido para trás (relógio de hardware errado na
 * subida) não estica a janela (revisões do #146). A janela fecha pelo
 * PRIMEIRO dos dois relógios: o monotônico, aqui, e o de parede, pela trava
 * de forma de `lerCookie` (`expiraEm` preso a `timeOrigin + 12h`). Numa VM
 * pausada o monotônico não anda — é o de parede que fecha (2ª rodada do #146).
 *
 * Cada reinício reabre a janela, inclusive os automáticos (deploy, queda,
 * `Restart=always`). Por isso a rotação em curso aparece no log, e apagar a
 * variável continua sendo o passo final da troca.
 */
function segredoAnterior(): string | undefined {
  const config = ambiente()
  const valor = config.SESSAO_SECRET_ANTERIOR
  if (valor === undefined) return undefined
  if (performance.now() >= VALIDADE_SEGUNDOS * 1000) {
    avisarJanelaFechada(config)
    return undefined
  }
  avisarJanelaAberta(config)
  return valor
}

/**
 * Avisa, NA SUBIDA do processo, que há uma troca de chave em curso — e agenda
 * o aviso de janela fechada para o instante em que ela fecha.
 *
 * O aviso preguiçoso em `segredoAnterior` não bastava: ele só sai quando
 * chega um cookie que a chave atual não confere. No caso que motivou o aviso
 * — a variável esquecida e o processo reiniciando sozinho —, todo cookie é da
 * chave atual, a anterior nunca é consultada, e o log ficava calado
 * (2ª rodada de revisão do #146). Chamado uma vez por `instrumentation-node.ts`.
 *
 * O `setTimeout` é `unref`: não segura o processo vivo ao parar. Ele também
 * corrige o `valeAte` impresso na subida, que é o horário PREVISTO pelo
 * relógio de parede: o aviso de fechada sai quando o monotônico fecha a janela.
 */
export function avisarTrocaDaChaveEmCurso(): void {
  const config = ambiente()
  if (config.SESSAO_SECRET_ANTERIOR === undefined) return
  const restanteMs = VALIDADE_SEGUNDOS * 1000 - performance.now()
  if (restanteMs <= 0) {
    avisarJanelaFechada(config)
    return
  }
  avisarJanelaAberta(config)
  setTimeout(() => {
    const atual = ambiente()
    if (atual.SESSAO_SECRET_ANTERIOR !== undefined) avisarJanelaFechada(atual)
  }, restanteMs).unref()
}

function avisarJanelaAberta(config: object): void {
  avisarUmaVez(config, 'aberta', 'SESSAO_SECRET_ANTERIOR definida: troca da chave de sessão em curso', {
    valeAte: new Date(performance.timeOrigin + VALIDADE_SEGUNDOS * 1000),
    passo: 'depois desse horário, apague a variável e reinicie',
  })
}

function avisarJanelaFechada(config: object): void {
  avisarUmaVez(config, 'fechada', 'SESSAO_SECRET_ANTERIOR ainda definida, e não confere mais nenhum cookie', {
    passo: 'apague a variável e reinicie: cada reinício reabre a janela por 12h',
  })
}

/**
 * Um aviso de cada tipo por configuração carregada — na prática, por processo.
 * Um por cookie encheria o log durante as 12h da troca. A chave é o objeto do
 * ambiente, e o valor do segredo nunca vai ao log.
 */
const avisosDaTroca = new WeakMap<object, Set<'aberta' | 'fechada'>>()

function avisarUmaVez(
  config: object,
  tipo: 'aberta' | 'fechada',
  mensagem: string,
  contexto: Record<string, unknown>,
): void {
  const dados = avisosDaTroca.get(config) ?? new Set()
  if (dados.has(tipo)) return
  dados.add(tipo)
  avisosDaTroca.set(config, dados)
  registrarLog('aviso', mensagem, contexto)
}

/** Assina SEMPRE com a chave atual: a anterior só confere. */
function assinar(carga: string, chave: string = segredo()): string {
  return createHmac('sha256', chave).update(carga).digest('base64url')
}

function confere(carga: string, assinatura: string, chave: string): boolean {
  const esperada = Buffer.from(assinar(carga, chave))
  const recebida = Buffer.from(assinatura)
  // Comparação em tempo constante: evita descobrir a assinatura byte a byte.
  if (esperada.length !== recebida.length) return false
  return timingSafeEqual(esperada, recebida)
}

/** Qual chave conferiu a assinatura — a anterior pede conferências a mais em `lerCookie`. */
function conferirAssinatura(carga: string, assinatura: string): 'atual' | 'anterior' | null {
  if (confere(carga, assinatura, segredo())) return 'atual'
  const anterior = segredoAnterior()
  return anterior !== undefined && confere(carga, assinatura, anterior) ? 'anterior' : null
}

export function montarCookie(
  colaboradorId: string,
  papel: Papel,
  senhaDefinidaEm: Date | null,
  opcoes: { local?: boolean } = {},
): string {
  const agora = Date.now()
  const conteudo: Conteudo = {
    colaboradorId,
    papel,
    expiraEm: agora + VALIDADE_SEGUNDOS * 1000,
    emitidoEm: agora,
    senhaEm: senhaDefinidaEm?.getTime() ?? null,
    ...(opcoes.local ? { local: true as const } : {}),
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
  const chave = conferirAssinatura(carga, assinatura)
  if (chave === null) return null

  try {
    const conteudo = JSON.parse(Buffer.from(carga, 'base64url').toString()) as Conteudo
    if (typeof conteudo.expiraEm !== 'number' || conteudo.expiraEm < Date.now()) return null
    // Cookie sem `emitidoEm` é anterior à revogação por logout e não dá para
    // situar no tempo — então não dá para saber se um "sair" já o invalidou.
    // Recusar custa uma reentrada a cada pessoa, uma única vez, na subida da
    // versão; aceitar manteria de pé exatamente os cookies que a mudança
    // existe para poder derrubar.
    if (typeof conteudo.emitidoEm !== 'number') return null
    // Pela chave anterior, só a forma de um cookie legítimo: emitido antes de
    // este processo subir com a chave nova, e com a validade exata. Um forjado
    // com a chave vazada podia pôr `emitidoEm` no futuro e escapar de todo
    // "sair" (`sessoesInvalidasAntes`) feito durante a troca (revisão de
    // segurança do #146). Com um processo só (`A61`), nenhum cookie legítimo
    // paga nada por isso; com o relógio corrigido para trás entre os dois
    // processos, ou instâncias sobrepostas na troca, a pessoa entra de novo
    // uma vez (2ª rodada do #146).
    if (
      chave === 'anterior' &&
      !(
        conteudo.emitidoEm < performance.timeOrigin &&
        conteudo.expiraEm - conteudo.emitidoEm === VALIDADE_SEGUNDOS * 1000
      )
    ) {
      return null
    }
    // `local` só vale como `true` exato; qualquer outro valor é tratado como
    // sessão comum, que é a que recebe MENOS permissão, não mais.
    const { local, ...resto } = conteudo
    return {
      ...resto,
      papel: PapelSchema.parse(conteudo.papel),
      ...(local === true ? { local: true as const } : {}),
    }
  } catch {
    return null
  }
}

export const OPCOES_DO_COOKIE = {
  name: NOME_DO_COOKIE,
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  // Secure SEMPRE, menos em desenvolvimento (achado C-12): "só em production"
  // deixava o cookie de sessão sem Secure num servidor publicado com NODE_ENV
  // herdado. Getter para valer o ambiente da hora, não o do carregamento.
  // Colchetes DE PROPÓSITO: o Next troca `process.env.NODE_ENV` (com ponto)
  // pelo valor do build; com colchetes a leitura é a do processo.
  get secure(): boolean {
    return process.env['NODE_ENV'] !== 'development'
  },
  maxAge: VALIDADE_SEGUNDOS,
} as const

export interface PerfilAtual {
  ator: Ator
  nome: string
  papel: Papel
  /** Senha ainda é a provisória entregue pelo gestor: nada além da troca é permitido. */
  precisaTrocarSenha: boolean
  /** Sessão aberta pelo acesso local sem senha. A tela mostra uma faixa enquanto for `true`. */
  acessoLocal: boolean
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
      email: true,
      papel: true,
      ativo: true,
      precisaTrocarSenha: true,
      senhaDefinidaEm: true,
      sessoesInvalidasAntes: true,
    },
  })
  if (!colaborador?.ativo) return null

  // SESSÃO DO ACESSO LOCAL SEM SENHA: vale só enquanto o acesso estiver ligado,
  // e só para conta sintética. Desligar `ACESSO_LOCAL_SEM_SENHA` derruba todas
  // estas sessões aqui, na próxima requisição — um cookie emitido em
  // desenvolvimento não vira credencial em lugar nenhum depois.
  const sessaoLocal = conteudo.local === true
  if (sessaoLocal && !(acessoLocalHabilitado() && ehContaSintetica(colaborador.email))) {
    return null
  }

  // Senha mudou depois deste cookie: a sessão morre aqui. Vale para a troca
  // feita pelo dono e para a redefinição feita pelo gestor.
  if ((colaborador.senhaDefinidaEm?.getTime() ?? null) !== conteudo.senhaEm) return null

  // A pessoa saiu depois que este cookie foi emitido: ele morre aqui, esteja
  // em que navegador estiver. É o que faz "sair" valer também para uma cópia
  // do cookie que alguém tenha levado da máquina compartilhada.
  const revogadasAte = colaborador.sessoesInvalidasAntes?.getTime()
  if (revogadasAte !== undefined && conteudo.emitidoEm < revogadasAte) return null

  const papel = PapelSchema.parse(colaborador.papel)
  return {
    ator: atorDaSessao({ colaboradorId: colaborador.id, papel }),
    nome: colaborador.nome,
    papel,
    // A troca de senha provisória protege a janela em que OUTRA pessoa conhece
    // a senha. Na sessão local ninguém usou senha nenhuma — e as contas
    // sintéticas do seed nascem todas com provisória, então exigir a troca aqui
    // tornaria o acesso local inútil sem proteger nada.
    precisaTrocarSenha: sessaoLocal ? false : colaborador.precisaTrocarSenha,
    acessoLocal: sessaoLocal,
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
