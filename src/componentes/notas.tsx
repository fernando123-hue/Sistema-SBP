'use client'

import { useCallback, useEffect, useState } from 'react'

import { api, mensagemDoErro } from './api'
import { Aviso, Botao, juntar } from './matrizes'

/**
 * Notas do setor — a matriz, instanciada nas quatro telas de trabalho.
 *
 * UMA matriz, não quatro blocos parecidos. Se a Fila, a Revisão, a Distribuição
 * e a Caixa cada uma tivesse a sua, a quinta tela nasceria com a quarta
 * variação da mesma marcação e as regras divergiriam em silêncio — que é
 * exatamente a dívida `H-D7` já registrada neste repositório.
 *
 * ═══ POR QUE A NOTA APARECE AQUI, E NÃO NUMA TELA PRÓPRIA ═══
 *
 * Memória que mora numa tela separada é memória que ninguém abre. A nota tem de
 * estar onde o trabalho acontece, no momento em que a decisão é tomada —
 * senão o aprendizado do setor vira um documento que todo mundo jura que vai
 * ler depois.
 *
 * ═══ O TEXTO É DE OUTRA PESSOA, E É TRATADO COMO TAL ═══
 *
 * Nota é escrita por gente da casa, o que a torna menos suspeita que corpo de
 * e-mail — não a torna confiável. Aqui ela é renderizada como TEXTO, nunca como
 * marcação: React escapa por padrão, e nenhum `dangerouslySetInnerHTML`
 * aparece neste arquivo. No dia em que a nota for para o prompt do modelo, ela
 * precisa passar pelas três camadas de `core/seguranca/conteudo-nao-confiavel`
 * no caminho de leitura — ver `core/notas.ts`.
 */

/**
 * ⚠️ ESTE TIPO É UMA INSTÂNCIA NOVA DA DÍVIDA `H-D7`, e está declarado aqui de
 * olhos abertos.
 *
 * Ele redigita à mão o que `servicos/notas.ts` já declara — a mesma divergência
 * silenciosa que fez `emAndamento` sumir e `Date` virar string em outras telas.
 * Repeti o padrão porque a correção da família inteira (derivar os tipos dos
 * esquemas Zod) atravessa a fronteira servidor/cliente e não é carona de uma
 * entrega de funcionalidade; começar por este arquivo deixaria o repositório
 * com dois jeitos de resolver o mesmo problema, que é pior que um jeito ruim.
 *
 * Duas divergências já são possíveis hoje: `criadoEm` e `arquivadaEm` são
 * `Date` no serviço e `string` aqui, porque JSON não tem data. É exatamente a
 * forma que o defeito assumiu da última vez.
 */
export interface NotaDoSetor {
  id: string
  texto: string
  categoriaCodigo: string | null
  categoriaRotulo: string | null
  ligaId: string | null
  ligaNome: string | null
  autorId: string
  autorNome: string
  criadoEm: string
  arquivadaEm: string | null
  motivoArquivo: string | null
}

export interface ContextoDaNota {
  categoriaId?: string | null
  ligaId?: string | null
  /** Código da categoria, para gravar a nota nova no mesmo vínculo em que ela foi lida. */
  categoriaCodigo?: string | null
}

interface PerfilDaSessao {
  autenticado: boolean
  colaborador: { id: string; papel: string } | null
}

/**
 * Quem pode arquivar, do ponto de vista da TELA.
 *
 * Espelha a regra do serviço (`servicos/notas.ts`: o autor, ou o gestor), e a
 * duplicação é deliberada — sem ela a tela oferece a todo mundo um botão que o
 * servidor recusa para quase todo mundo, e a pessoa recebe uma mensagem de
 * permissão negada como resposta a um clique que a interface convidou a dar.
 *
 * Esconder aqui NÃO é a defesa: a defesa é a checagem no serviço, dentro da
 * transação. Esta função só evita prometer o que não vai acontecer.
 */
function podeArquivar(perfil: PerfilDaSessao | null, nota: NotaDoSetor): boolean {
  const eu = perfil?.colaborador
  if (!eu) return false
  return eu.id === nota.autorId || eu.papel === 'gestor'
}

function alcance(nota: NotaDoSetor): { rotulo: string; especifica: boolean } {
  if (nota.ligaNome) return { rotulo: nota.ligaNome, especifica: true }
  if (nota.categoriaRotulo) return { rotulo: nota.categoriaRotulo, especifica: true }
  return { rotulo: 'Todo o setor', especifica: false }
}

function comoData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function consulta(contexto: ContextoDaNota): string {
  const parametros = new URLSearchParams()
  if (contexto.categoriaId) parametros.set('categoriaId', contexto.categoriaId)
  if (contexto.categoriaCodigo) parametros.set('categoriaCodigo', contexto.categoriaCodigo)
  if (contexto.ligaId) parametros.set('ligaId', contexto.ligaId)
  return parametros.toString()
}

/**
 * O bloco de memória de uma tela.
 *
 * `contexto` vazio devolve só as notas do setor inteiro — é o comportamento
 * correto na Caixa, onde ainda não se sabe de que categoria o trabalho é.
 */
export function NotasDoSetor({
  contexto = {},
  titulo = 'O que o setor já aprendeu',
}: {
  contexto?: ContextoDaNota
  titulo?: string
}) {
  const [notas, definirNotas] = useState<NotaDoSetor[] | null>(null)
  const [perfil, definirPerfil] = useState<PerfilDaSessao | null>(null)
  const [erro, definirErro] = useState<string | null>(null)
  const [escrevendo, definirEscrevendo] = useState(false)
  const [texto, definirTexto] = useState('')
  const [salvando, definirSalvando] = useState(false)
  /** Id da nota aguardando confirmação de arquivamento. */
  const [confirmando, definirConfirmando] = useState<string | null>(null)

  const chave = consulta(contexto)

  const carregar = useCallback(async () => {
    try {
      definirErro(null)
      definirNotas(await api.buscar<NotaDoSetor[]>(`/notas${chave ? `?${chave}` : ''}`))
    } catch (falha) {
      // Falhar alto, nunca degradar em silêncio: uma lista vazia por erro de
      // rede seria indistinguível de "o setor não aprendeu nada ainda", e a
      // pessoa seguiria confiando numa memória que não carregou.
      definirErro(mensagemDoErro(falha))
      definirNotas([])
    }
  }, [chave])

  useEffect(() => {
    void carregar()
  }, [carregar])

  useEffect(() => {
    // Falha aqui não é erro de tela: sem perfil o botão de arquivar apenas não
    // aparece, e a leitura das notas — que é o que a pessoa veio fazer —
    // continua funcionando.
    void api
      .buscar<PerfilDaSessao>('/sessao')
      .then(definirPerfil)
      .catch(() => definirPerfil(null))
  }, [])

  async function registrar() {
    if (texto.trim().length < 3 || salvando) return

    definirSalvando(true)
    try {
      definirErro(null)
      await api.enviar('/notas', {
        texto,
        // A nota nasce no mesmo vínculo em que foi escrita. Sem isto, quem
        // anota algo específico da liga acabaria criando uma nota geral que
        // aparece em toda tela do setor — ruído que ensina a equipe a ignorar
        // o bloco inteiro.
        categoriaCodigo: contexto.categoriaCodigo ?? null,
        ligaId: contexto.ligaId ?? null,
      })
      definirTexto('')
      definirEscrevendo(false)
      await carregar()
    } catch (falha) {
      definirErro(mensagemDoErro(falha))
    } finally {
      definirSalvando(false)
    }
  }

  async function arquivar(nota: NotaDoSetor) {
    try {
      definirErro(null)
      definirConfirmando(null)
      await api.remover(`/notas/${nota.id}`)
      await carregar()
    } catch (falha) {
      definirErro(mensagemDoErro(falha))
    }
  }

  return (
    <section className="rounded-[var(--radius-cartao)] border border-borda bg-papel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-borda px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{titulo}</h2>
          <p className="mt-0.5 text-xs text-tinta-suave">
            Escrito pela equipe, para a equipe. Não altera distribuição nem carga.
          </p>
        </div>
        <Botao
          tamanho="pequeno"
          onClick={() => definirEscrevendo((antes) => !antes)}
          variante={escrevendo ? 'secundario' : 'principal'}
        >
          {escrevendo ? 'Cancelar' : 'Anotar'}
        </Botao>
      </div>

      {escrevendo ? (
        <div className="flex flex-col gap-2 border-b border-borda px-4 py-3">
          <label className="text-xs font-medium text-tinta-suave" htmlFor="nota-nova">
            O que você aprendeu? Escreva como falaria para um colega.
          </label>
          <textarea
            id="nota-nova"
            rows={3}
            value={texto}
            onChange={(evento) => definirTexto(evento.target.value)}
            maxLength={1000}
            placeholder="Ex.: pedido de segunda via quase sempre vem sem o comprovante — vale conferir antes de aprovar."
            className="w-full rounded-md border border-borda-forte bg-papel-fundo px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-2">
            <Botao
              tamanho="pequeno"
              variante="principal"
              onClick={() => void registrar()}
              desabilitado={texto.trim().length < 3 || salvando}
            >
              {salvando ? 'Registrando…' : 'Registrar'}
            </Botao>
            <span className="text-xs text-tinta-suave">
              {contexto.ligaId
                ? 'Fica ligada a esta liga.'
                : contexto.categoriaCodigo
                  ? 'Fica ligada a esta categoria.'
                  : 'Vale para o setor inteiro.'}
            </span>
          </div>
        </div>
      ) : null}

      {erro ? (
        <div className="px-4 py-3">
          <Aviso>{erro}</Aviso>
        </div>
      ) : null}

      {notas === null ? (
        <p className="px-4 py-6 text-center text-xs text-tinta-suave" role="status" aria-live="polite">
          Carregando notas…
        </p>
      ) : notas.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-tinta-suave">
          Nada anotado ainda para este contexto. A primeira nota costuma ser a que mais economiza tempo.
        </p>
      ) : (
        <ul className="divide-y divide-borda">
          {notas.map((nota) => {
            const onde = alcance(nota)
            return (
              <li key={nota.id} className="flex flex-col gap-1.5 px-4 py-3">
                <p className="text-sm leading-relaxed">{nota.texto}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tinta-suave">
                  <span
                    className={juntar(
                      'rounded border px-1.5 py-0.5',
                      onde.especifica ? 'border-acento/40 text-acento' : 'border-borda',
                    )}
                  >
                    {onde.rotulo}
                  </span>
                  <span>{nota.autorNome}</span>
                  <span>{comoData(nota.criadoEm)}</span>
                  {podeArquivar(perfil, nota) ? (
                    // Dois cliques, sem caixa de diálogo. Arquivar tira a nota
                    // da vista de todo o setor e não há desfazer na interface —
                    // um clique acidental num link de uma linha custaria a
                    // memória de outra pessoa.
                    <button
                      type="button"
                      onClick={() =>
                        confirmando === nota.id
                          ? void arquivar(nota)
                          : definirConfirmando(nota.id)
                      }
                      onBlur={() => definirConfirmando((atual) => (atual === nota.id ? null : atual))}
                      className="ml-auto min-h-9 underline decoration-dotted underline-offset-2 hover:text-tinta"
                    >
                      {confirmando === nota.id ? 'Confirmar: tirar da vista' : 'Não vale mais'}
                    </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
