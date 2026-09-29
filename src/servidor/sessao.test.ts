import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { limparCacheDeAmbiente } from './ambiente'
import { PermissaoNegadaError, atorDaSessao, ehOProprio, exigirPapel } from './ator'
import { lerCookie, montarCookie } from './sessao'
import { verificarLimite } from './limite-de-taxa'

/**
 * Testes da superfície que autentica e autoriza.
 *
 * Era a única camada sem nenhuma rede de segurança: se alguém trocasse a
 * comparação em tempo constante por `===`, ou esquecesse a checagem de
 * expiração, nenhum teste falharia — e a identidade viraria forjável.
 */

const COLABORADOR = 'ckabc123'

/**
 * `ambiente()` cacheia a configuração na primeira leitura — de propósito, para
 * validar uma vez só na inicialização. Isso significa que trocar a variável em
 * tempo de execução não tem efeito sem limpar o cache, o que também é a
 * resposta a "como rotacionar o segredo": exige reinício do processo.
 */
function definirSegredo(valor: string): void {
  // Atribuir vazio, não apagar: `process.loadEnvFile()` repõe a chave a partir
  // do `.env` do repositório quando ela some, e o teste deixaria de isolar.
  process.env['SESSAO_SECRET'] = valor
  limparCacheDeAmbiente()
}

function definirAnterior(valor: string): void {
  process.env['SESSAO_SECRET_ANTERIOR'] = valor
  limparCacheDeAmbiente()
}

beforeEach(() => {
  // `segredo()` lê do ambiente e exige no mínimo 16 caracteres.
  definirSegredo('segredo-de-teste-com-tamanho-suficiente')
  definirAnterior('')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('cookie de sessão', () => {
  it('ida e volta preserva identidade e papel', () => {
    const conteudo = lerCookie(montarCookie(COLABORADOR, 'operador', null))

    expect(conteudo).not.toBeNull()
    expect(conteudo!.colaboradorId).toBe(COLABORADOR)
    expect(conteudo!.papel).toBe('operador')
  })

  it('recusa carga adulterada mantendo a assinatura antiga', () => {
    const original = montarCookie(COLABORADOR, 'colaborador', null)
    const [carga, assinatura] = original.split('.') as [string, string]

    // O ataque óbvio: promover-se a gestor reescrevendo a carga.
    const adulterada = JSON.parse(Buffer.from(carga, 'base64url').toString()) as Record<
      string,
      unknown
    >
    adulterada['papel'] = 'gestor'
    const forjada = Buffer.from(JSON.stringify(adulterada)).toString('base64url')

    expect(lerCookie(`${forjada}.${assinatura}`)).toBeNull()
  })

  it('recusa assinatura trocada', () => {
    const [carga] = montarCookie(COLABORADOR, 'operador', null).split('.') as [string, string]
    expect(lerCookie(`${carga}.assinaturaInventada`)).toBeNull()
  })

  it('recusa cookie expirado', () => {
    const expirado = {
      colaboradorId: COLABORADOR,
      papel: 'operador',
      expiraEm: Date.now() - 1000,
    }
    const carga = Buffer.from(JSON.stringify(expirado)).toString('base64url')

    // Assinatura VÁLIDA para uma carga expirada: a expiração tem de ser
    // verificada por si, não pode depender da assinatura.
    const valido = montarCookie(COLABORADOR, 'operador', null)
    const separador = valido.lastIndexOf('.')
    const cargaValida = valido.slice(0, separador)
    expect(lerCookie(`${cargaValida}.${valido.slice(separador + 1)}`)).not.toBeNull()
    expect(lerCookie(`${carga}.qualquer`)).toBeNull()
  })

  it('recusa cookie malformado sem lançar', () => {
    const malformados = ['', '.', 'semponto', '.semcarga', 'carga.', 'não-base64!.assinatura']
    for (const valor of malformados) {
      expect(() => lerCookie(valor)).not.toThrow()
      expect(lerCookie(valor)).toBeNull()
    }
    expect(lerCookie(undefined)).toBeNull()
  })

  it('recusa papel fora do domínio', () => {
    const conteudo = { colaboradorId: COLABORADOR, papel: 'administrador', expiraEm: Date.now() + 60_000 }
    const carga = Buffer.from(JSON.stringify(conteudo)).toString('base64url')
    expect(lerCookie(`${carga}.assinaturaQualquer`)).toBeNull()
  })

  it('segredo vazio faz a assinatura falhar em vez de fingir proteção', () => {
    definirSegredo('')
    // Assinar com string vazia daria aparência de proteção com zero proteção:
    // qualquer um recalcularia o HMAC e forjaria o cookie.
    expect(() => montarCookie(COLABORADOR, 'operador', null)).toThrow(/SESSAO_SECRET/)
  })

  it('segredo curto demais é recusado', () => {
    definirSegredo('curto')
    expect(() => montarCookie(COLABORADOR, 'operador', null)).toThrow(/16 caracteres/)
  })

  it('carrega a data da senha, que é o gatilho de revogação', () => {
    const senhaEm = new Date('2026-08-26T12:00:00.000Z')
    const conteudo = lerCookie(montarCookie(COLABORADOR, 'operador', senhaEm))

    // `perfilAtual` compara este valor com o do banco e mata a sessão quando
    // diferem. Sem o campo no cookie, trocar a senha — a reação de quem
    // desconfia de acesso indevido — deixaria o cookie roubado vivo por 12h.
    expect(conteudo!.senhaEm).toBe(senhaEm.getTime())
  })

  it('segredo diferente invalida cookies existentes', () => {
    const cookie = montarCookie(COLABORADOR, 'operador', null)
    definirSegredo('outro-segredo-completamente-diferente')
    expect(lerCookie(cookie)).toBeNull()
  })
})

describe('rotação do segredo de sessão com duas chaves (C-25)', () => {
  /**
   * Sem a chave anterior, trocar `SESSAO_SECRET` derruba todo mundo no meio do
   * expediente — e o gesto de rotina fica caro o bastante para ninguém fazer.
   * Com ela, o cookie emitido antes da troca continua valendo até expirar, e
   * todo cookie novo sai com a chave nova.
   */
  const ANTIGO = 'segredo-de-teste-antigo-da-sessao'
  const NOVO = 'segredo-de-teste-novo-da-sessao'

  it('cookie assinado com a chave anterior segue valendo depois da troca', () => {
    definirSegredo(ANTIGO)
    const emitidoAntes = montarCookie(COLABORADOR, 'gestor', null)

    definirSegredo(NOVO)
    definirAnterior(ANTIGO)

    expect(lerCookie(emitidoAntes)?.papel).toBe('gestor')
  })

  it('cookie novo sai com a chave nova, nunca com a anterior', () => {
    definirSegredo(NOVO)
    definirAnterior(ANTIGO)
    const emitidoDepois = montarCookie(COLABORADOR, 'operador', null)

    // Tirar a anterior não pode derrubar quem entrou depois da troca...
    definirAnterior('')
    expect(lerCookie(emitidoDepois)).not.toBeNull()
    // ...e a chave anterior sozinha não confere o cookie novo.
    definirSegredo(ANTIGO)
    expect(lerCookie(emitidoDepois)).toBeNull()
  })

  it('sem a chave anterior, a troca derruba os cookies antigos — o gesto certo depois de um vazamento', () => {
    definirSegredo(ANTIGO)
    const emitidoAntes = montarCookie(COLABORADOR, 'operador', null)

    definirSegredo(NOVO)

    expect(lerCookie(emitidoAntes)).toBeNull()
  })

  it('a chave anterior não confere carga adulterada', () => {
    definirSegredo(ANTIGO)
    const original = montarCookie(COLABORADOR, 'colaborador', null)
    definirSegredo(NOVO)
    definirAnterior(ANTIGO)

    const [carga, assinatura] = original.split('.') as [string, string]
    const adulterada = JSON.parse(Buffer.from(carga, 'base64url').toString()) as Record<string, unknown>
    adulterada['papel'] = 'gestor'
    const forjada = Buffer.from(JSON.stringify(adulterada)).toString('base64url')

    expect(lerCookie(`${forjada}.${assinatura}`)).toBeNull()
  })

  it('a chave anterior deixa de valer sozinha 12h depois de o processo subir, mesmo esquecida no ambiente', () => {
    const DOZE_HORAS = 12 * 60 * 60 * 1000
    vi.useFakeTimers({ toFake: ['Date'] })

    // Um cookie da chave anterior, emitido perto do fim da janela: a validade
    // dele passa do prazo da chave, e é o prazo da chave que tem de valer.
    vi.setSystemTime(performance.timeOrigin + DOZE_HORAS - 60_000)
    definirSegredo(ANTIGO)
    const tardio = montarCookie(COLABORADOR, 'operador', null)
    definirSegredo(NOVO)
    definirAnterior(ANTIGO)
    expect(lerCookie(tardio)).not.toBeNull()

    // Todo cookie legítimo da chave anterior foi emitido antes de o processo
    // subir com a nova, e vale 12h: passado isso, ninguém precisa dela. Um
    // cookie forjado com a chave vazada, sim — e ele escolhe o próprio
    // `expiraEm`. Por isso o prazo é contado do processo, não do cookie.
    vi.setSystemTime(performance.timeOrigin + DOZE_HORAS + 1000)
    expect(lerCookie(tardio)).toBeNull()

    // O cookie novo não tem prazo além da própria validade.
    expect(lerCookie(montarCookie(COLABORADOR, 'operador', null))).not.toBeNull()
  })
})

describe('autorização por papel', () => {
  const operador = atorDaSessao({ colaboradorId: 'op1', papel: 'operador' })
  const colaborador = atorDaSessao({ colaboradorId: 'col1', papel: 'colaborador' })
  const gestor = atorDaSessao({ colaboradorId: 'ge1', papel: 'gestor' })

  it('permite o papel listado', () => {
    // Operação real do sistema, não um nome inventado: `Operacao` é uma união
    // fechada, e o compilador recusaria um valor que não existe de verdade.
    expect(() => exigirPapel(operador, 'definir escala', 'operador', 'gestor')).not.toThrow()
    expect(() => exigirPapel(gestor, 'definir escala', 'operador', 'gestor')).not.toThrow()
  })

  it('recusa papel não listado, e guarda papel e operação para o rastro — não na frase da tela (N-28)', () => {
    expect(() => exigirPapel(colaborador, 'confirmar distribuição', 'operador', 'gestor')).toThrow(
      PermissaoNegadaError,
    )

    try {
      exigirPapel(colaborador, 'confirmar distribuição', 'operador', 'gestor')
    } catch (erro) {
      expect(erro).toMatchObject({ papel: 'colaborador', operacao: 'confirmar distribuição' })
      expect((erro as Error).message).not.toContain('operador')
    }
  })

  it('ehOProprio distingue o dono de terceiros', () => {
    expect(ehOProprio(colaborador, 'col1')).toBe(true)
    expect(ehOProprio(colaborador, 'col2')).toBe(false)
  })

  it('recusa papel inválido na construção do ator', () => {
    expect(() => atorDaSessao({ colaboradorId: 'x', papel: 'administrador' })).toThrow()
  })

  it('recusa ator sem identificador', () => {
    expect(() => atorDaSessao({ colaboradorId: '   ', papel: 'operador' })).toThrow(/identificador/i)
  })
})

describe('limite de taxa', () => {
  it('permite até o máximo e recusa o excedente', () => {
    const chave = `teste-${Math.floor(performance.now() * 1000)}`

    for (let tentativa = 0; tentativa < 3; tentativa += 1) {
      expect(verificarLimite(chave, 3, 60).permitido).toBe(true)
    }

    const recusado = verificarLimite(chave, 3, 60)
    expect(recusado.permitido).toBe(false)
    expect(recusado.restante).toBe(0)
    expect(recusado.reiniciaEmSegundos).toBeGreaterThan(0)
  })

  it('chaves diferentes não compartilham contagem', () => {
    const base = Math.floor(performance.now() * 1000)
    const primeira = `a-${base}`
    const segunda = `b-${base}`

    verificarLimite(primeira, 1, 60)
    expect(verificarLimite(primeira, 1, 60).permitido).toBe(false)
    // Esta é a regressão que importa: a chave global em `/api/sessao` deixava
    // um visitante travar a entrada de toda a equipe.
    expect(verificarLimite(segunda, 1, 60).permitido).toBe(true)
  })

  it('reinicia depois que a janela passa', () => {
    const chave = `janela-${Math.floor(performance.now() * 1000)}`
    // Janela de 0 segundo: a próxima chamada já encontra a janela vencida.
    expect(verificarLimite(chave, 1, 0).permitido).toBe(true)
    expect(verificarLimite(chave, 1, 0).permitido).toBe(true)
  })
})
