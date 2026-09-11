'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { hojeIso } from '../../core/util/datas'
import { api, mensagemDoErro } from '../../componentes/api'
import {
  Aviso,
  Botao,
  CabecalhoDeSecao,
  Cartao,
  Carregando,
  Metrica,
  Selo,
  Vazio,
  juntar,
} from '../../componentes/matrizes'
import { NotasDoSetor } from '../../componentes/notas'
import type { LinhaDaEscala, NaRede, ResumoIngestao } from '../../core/tipos'

/**
 * O servidor já redigiu conforme o papel de quem pediu (decisão de 06/09/2026).
 *
 * Operador e colaborador só recebem `ferias` ou `indisponivel` — o motivo
 * médico não sai do servidor para eles. Os outros rótulos só chegam aqui
 * quando quem está olhando é gestor.
 */
const AFASTAMENTO: Record<string, string> = {
  ferias: 'de férias',
  indisponivel: 'indisponível',
  atestado: 'de atestado',
  falta: 'ausente',
  licenca: 'de licença',
  outro: 'afastada',
}

interface Fatia {
  colaboradorId: string
  quantidade: number
  creditoAntes: number
  creditoDepois: number
}

interface LinhaDaPrevia {
  categoriaCodigo: string
  rotulo: string
  grupo: string
  quantidade: number
  criterio: string | null
  base: number
  resto: number
  cotaJusta: number
  erro: string | null
  fatias: Fatia[]
}


interface Narrativa {
  categoriaCodigo: string
  rotulo: string
  linhas: string[]
}

interface Resumo {
  data: string
  totalDistribuido: number
  rodadasGravadas: number
  linhas: LinhaDaPrevia[]
  narrativas: Narrativa[]
  /** Categorias com cadastro inválido no banco, que ficaram fora da rodada. */
  categoriasInvalidas: { codigo: string; motivo: string }[]
}

// `hojeIso` vem do núcleo puro (pode ser importado no cliente) e resolve no
// fuso da operação. Com `toISOString()`, a tela abria em amanhã depois das 21h.
const hoje = hojeIso

/** As frases da rodada de uma categoria. Vazio quando não houve rodada. */
function narrativaDe(resumo: Resumo | null, categoriaCodigo: string): string[] {
  return resumo?.narrativas.find((n) => n.categoriaCodigo === categoriaCodigo)?.linhas ?? []
}

const CRITERIO: Record<string, { texto: string; explicacao: string }> = {
  resto_maior: {
    texto: 'resto maior',
    explicacao: 'Piso igual para todos; as unidades que sobram vão para quem tem mais crédito.',
  },
  indivisivel: {
    texto: 'lote inteiro',
    explicacao: 'Volume baixo: o lote vai inteiro para uma pessoa em vez de fragmentar.',
  },
  // Faltava, e o buraco aparecia na tela: toda rodada de LIGANTE ou EMAIL_LIGA
  // usa este critério, então o operador via o identificador interno cru
  // (`por_grupo`) sem nenhuma explicação — justamente na categoria em que a
  // regra é menos óbvia e mais precisa ser explicada.
  por_grupo: {
    texto: 'liga inteira',
    explicacao:
      'Cada liga vai inteira para uma pessoa, a que estiver com mais crédito no momento. ' +
      'Ligas diferentes podem ir para pessoas diferentes.',
  },
  sem_demanda: { texto: 'sem demanda', explicacao: 'Nada a distribuir nesta categoria.' },
}

export default function Distribuicao() {
  const [data, setData] = useState(hoje)
  const [escala, setEscala] = useState<NaRede<LinhaDaEscala>[] | null>(null)
  const [previa, setPrevia] = useState<Resumo | null>(null)
  const [confirmado, setConfirmado] = useState<Resumo | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ingestao, setIngestao] = useState<NaRede<ResumoIngestao> | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  /**
   * Número da carga de escala mais recente. Só ela escreve na tela.
   *
   * Trocar a data duas vezes seguidas disparava duas buscas; se a primeira
   * chegasse por último, a tela mostrava o plantão de um dia com outra data no
   * campo. Revisão do PR #35.
   */
  const ultimaCargaDeEscala = useRef(0)

  const carregarEscala = useCallback(async (dia: string) => {
    ultimaCargaDeEscala.current += 1
    const estaCarga = ultimaCargaDeEscala.current
    setEscala(null)
    try {
      const resposta = await api.buscar<NaRede<LinhaDaEscala>[]>(`/escala?data=${dia}`)
      if (estaCarga !== ultimaCargaDeEscala.current) return
      setEscala(resposta)
    } catch (causa) {
      if (estaCarga !== ultimaCargaDeEscala.current) return
      // Estado neutro, e não `null`: `null` é a condição que desenha
      // "Carregando…", então uma falha de rede deixava erro E carregando na
      // tela ao mesmo tempo, para sempre. Quem olha conclui "hoje está lento",
      // espera, e nunca tenta de novo.
      setEscala([])
      setErro(mensagemDoErro(causa))
    }
  }, [])

  useEffect(() => {
    setPrevia(null)
    setConfirmado(null)
    void carregarEscala(data)
  }, [data, carregarEscala])

  const nomePor = new Map((escala ?? []).map((linha) => [linha.colaboradorId, linha.nome]))
  // Afastado NÃO conta como de plantão, ainda que a escala tenha ficado
  // marcada de antes (`A10`). O contador tem de dizer quantas pessoas vão
  // receber de verdade — senão a tela promete "3 de 5" e a prévia entrega
  // duas, sem explicação.
  const dePlantao = (escala ?? []).filter((linha) => linha.disponivel && linha.afastamento === null)

  /**
   * Quem está sendo marcado agora. Enquanto houver um, NENHUMA caixa responde.
   *
   * A caixa não reagia até o servidor responder, e nada dizia que o clique
   * tinha pegado. Segunda-feira, cinco pessoas para marcar: a operadora clicava
   * de novo achando que não foi, as respostas chegavam fora de ordem — cada uma
   * traz a escala INTEIRA, então a mais velha sobrescrevia a mais nova — e ela
   * pedia a prévia com a escala que ACHAVA ter marcado. Travar só a linha
   * clicada não bastaria: é a resposta de outra linha que desfaz esta.
   */
  const [alternando, setAlternando] = useState<string | null>(null)

  async function alternar(linha: NaRede<LinhaDaEscala>) {
    if (alternando !== null) return
    setAlternando(linha.colaboradorId)
    setErro(null)
    setPrevia(null)
    try {
      const atualizada = await api.atualizar<NaRede<LinhaDaEscala>[]>('/escala', {
        data,
        colaboradorId: linha.colaboradorId,
        disponivel: !linha.disponivel,
        capacidadeRelativa: linha.capacidadeRelativa,
      })
      setEscala(atualizada)
    } catch (causa) {
      setErro(mensagemDoErro(causa))
    } finally {
      setAlternando(null)
    }
  }

  /**
   * Quando a prévia na tela foi calculada.
   *
   * `confirmar` não recebe a prévia: o servidor REPLANEJA dentro da transação,
   * com os dados do instante do clique. A tela dizia "o que aparece aqui é
   * exatamente o que será gravado" — a função é a mesma, a ENTRADA não. Prévia
   * das 9h20 com 38 itens, outro operador busca e-mails e entram 27, e às 14h a
   * tela ainda mostra 38 com o botão habilitado. O horário não impede nada; ele
   * impede que a tela afirme uma coisa que deixou de ser verdade.
   */
  const [previaCalculadaEm, setPreviaCalculadaEm] = useState<Date | null>(null)

  async function executar(acao: 'sincronizar' | 'previa' | 'confirmar') {
    setOcupado(acao)
    setErro(null)
    try {
      if (acao === 'sincronizar') {
        setIngestao(await api.enviar<NaRede<ResumoIngestao>>('/ingestao'))
        setPrevia(null)
      } else if (acao === 'previa') {
        setPrevia(await api.enviar<Resumo>('/distribuicao/previa', { data, categorias: [] }))
        setPreviaCalculadaEm(new Date())
      } else {
        const resultado = await api.enviar<Resumo>('/distribuicao/confirmar', {
          data,
          categorias: [],
        })
        setConfirmado(resultado)
        setPrevia(null)
      }
    } catch (causa) {
      setErro(mensagemDoErro(causa))
    } finally {
      setOcupado(null)
    }
  }

  const mostrado = previa ?? confirmado
  const comItens = mostrado?.linhas.filter((linha) => linha.quantidade > 0) ?? []
  const comErro = comItens.filter((linha) => linha.erro)
  /**
   * Só trava quando NENHUMA categoria pode ser distribuída.
   *
   * Era `comErro.length > 0`: uma categoria sem ninguém habilitado de plantão
   * bloqueava o dia inteiro. Com equipe de 4-7 pessoas e 2-3 de plantão, isso
   * não é excepcional — é rotina, e o custo era os itens das OUTRAS categorias
   * ficarem parados sem motivo.
   *
   * O serviço nunca precisou disso: `confirmar` pula o plano sem resultado,
   * grava os demais e registra os pulados em `EventoProcessamento` como
   * `reprocessavel`. O aviso logo abaixo é o que a tela deve fazer — avisar —, e
   * o texto dele já promete que "o trabalho fica na fila até haver plantão".
   * O botão desabilitado impedia a própria promessa de acontecer.
   */
  const nadaADistribuir = comItens.length > 0 && comErro.length === comItens.length
  const total = comItens.reduce((soma, linha) => soma + linha.quantidade, 0)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Distribuição do dia</h1>
          <p className="mt-0.5 text-sm text-tinta-suave">
            Marque quem está de plantão, confira a prévia e confirme. Nenhum número é digitado.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-tinta-suave">Data</span>
          {/* Travada junto com as caixas de plantão: trocar de dia com uma
              marcação no ar deixava a resposta atrasada — que traz a escala
              inteira do dia ANTERIOR — sobrescrever a do dia novo, sem aviso. */}
          <input
            type="date"
            value={data}
            disabled={alternando !== null}
            onChange={(evento) => setData(evento.target.value)}
            className="numerico rounded-md border border-borda-forte bg-papel px-2.5 py-2 text-sm disabled:opacity-60"
          />
        </label>
      </div>

      {erro ? <Aviso>{erro}</Aviso> : null}

      {ingestao ? (
        <Aviso tom={ingestao.falhas > 0 || ingestao.emailsSemItem > 0 ? "atencao" : "ok"}>
          {ingestao.recebidos} e-mails lidos · {ingestao.novos} novos ·{' '}
          {ingestao.duplicados} já conhecidos · {ingestao.itensCriados} itens criados
          {ingestao.emailsSemItem > 0 ? (
            <>
              {' · '}
              <strong>
                {ingestao.emailsSemItem} sem item nenhum
              </strong>
            </>
          ) : null}
          {ingestao.falhas > 0 ? (
            <>
              {' · '}
              <strong>{ingestao.falhas} falharam e voltam na próxima busca</strong>
            </>
          ) : null}
        </Aviso>
      ) : null}

      <section>
        <CabecalhoDeSecao
          titulo="Plantão"
          descricao={`${dePlantao.length} de ${escala?.length ?? 0} disponíveis. Quem não está marcado não recebe nada.`}
          acao={
            <Botao onClick={() => executar('sincronizar')} desabilitado={ocupado !== null}>
              {ocupado === 'sincronizar' ? 'buscando…' : 'Buscar e-mails'}
            </Botao>
          }
        />

        {escala === null ? (
          <Carregando />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {escala.map((linha) => (
              <li key={linha.colaboradorId}>
                <Cartao
                  destaque={linha.disponivel && linha.afastamento === null}
                  className={juntar('px-3 py-2.5', linha.afastamento !== null && 'opacity-60')}
                >
                  {/*
                    QUEM ESTÁ AFASTADO NÃO PODE SER MARCADO (`A10`).
                    Sem isto a caixa marcava, a pessoa continuava fora do rateio
                    — porque `carregarElegiveis` a exclui —, e a prévia vinha
                    com uma pessoa a menos sem nada explicar. Marcar e não
                    acontecer nada é a divergência silenciosa que este sistema
                    existe para eliminar.
                  */}
                  <label
                    className={juntar(
                      'flex items-start gap-3',
                      linha.afastamento === null ? 'cursor-pointer' : 'cursor-not-allowed',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={linha.disponivel && linha.afastamento === null}
                      disabled={linha.afastamento !== null || alternando !== null}
                      onChange={() => alternar(linha)}
                      className="mt-1 size-4 accent-[var(--color-acento)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {linha.nome}
                        {alternando === linha.colaboradorId ? (
                          <span className="ml-2 text-xs font-normal text-tinta-suave" role="status">
                            salvando…
                          </span>
                        ) : null}
                      </span>
                      {linha.afastamento !== null ? (
                        <span className="mt-1 block">
                          <Selo tom="atencao">
                            {AFASTAMENTO[linha.afastamento] ?? 'afastada'} · não recebe hoje
                          </Selo>
                        </span>
                      ) : null}
                      <span className="mt-1 flex flex-wrap gap-1">
                        {linha.categorias.map((codigo) => (
                          <Selo key={codigo}>{codigo.toLowerCase().replace('_', ' ')}</Selo>
                        ))}
                      </span>
                    </span>
                  </label>
                </Cartao>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <CabecalhoDeSecao
          titulo={confirmado && !previa ? 'Distribuição gravada' : 'Prévia'}
          descricao={
            confirmado && !previa
              ? `${confirmado.rodadasGravadas} rodadas registradas. Cada uma é auditável.`
              : previa && previaCalculadaEm
                ? `Calculada às ${previaCalculadaEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. ` +
                  'Confirmar recalcula com os dados deste instante, pela mesma função: se entrou e-mail ' +
                  'ou mudou o plantão desde então, o que for gravado acompanha o agora.'
                : 'Mesma função e mesmo cálculo da confirmação — que refaz a conta com os dados do instante do clique.'
          }
          acao={
            <div className="flex gap-2">
              {/* Com uma marcação de plantão ainda no ar, a prévia seria
                  calculada com a escala de ANTES do clique. */}
              <Botao
                onClick={() => executar('previa')}
                desabilitado={ocupado !== null || alternando !== null}
              >
                {ocupado === 'previa' ? 'calculando…' : 'Calcular prévia'}
              </Botao>
              <Botao
                variante="principal"
                onClick={() => executar('confirmar')}
                desabilitado={
                  ocupado !== null || alternando !== null || previa === null || nadaADistribuir
                }
              >
                {ocupado === 'confirmar' ? 'gravando…' : 'Confirmar'}
              </Botao>
            </div>
          }
        />

        {/* Categoria com cadastro inválido no banco não derruba o dia inteiro:
            sai nomeada aqui, e as demais seguem. `DECISOES.md § AT-15`. */}
        {mostrado && mostrado.categoriasInvalidas.length > 0 ? (
          <div className="mb-3">
            <Aviso>
              <strong>
                {mostrado.categoriasInvalidas.length} categoria(s) fora desta rodada por cadastro
                inválido no banco:
              </strong>{' '}
              {mostrado.categoriasInvalidas
                .map((categoria) => `${categoria.codigo} — ${categoria.motivo}`)
                .join(' · ')}
              . As demais seguem normalmente; corrija o cadastro antes de distribuir estas.
            </Aviso>
          </div>
        ) : null}

        {comErro.length > 0 ? (
          <div className="mb-3">
            <Aviso tom="atencao">
              <strong>{comErro.length} categoria(s) sem ninguém elegível.</strong> O trabalho fica na
              fila até haver plantão — nada é descartado.{' '}
              {nadaADistribuir
                ? 'Como nenhuma categoria tem quem receba, não há o que confirmar: marque alguém habilitado e recalcule.'
                : 'Confirmar distribui as demais; estas voltam na próxima rodada.'}
            </Aviso>
          </div>
        ) : null}

        {mostrado === null ? (
          <Vazio
            titulo="Nenhuma prévia calculada"
            descricao="Marque o plantão e clique em Calcular prévia."
          />
        ) : comItens.length === 0 ? (
          <Vazio
            titulo="Nada a distribuir nesta data"
            descricao="Não há itens aprovados aguardando distribuição."
          />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <Metrica rotulo="Entrada" valor={total} detalhe="itens aprovados" />
              <Metrica
                rotulo="Distribuído"
                valor={comItens.reduce(
                  (soma, linha) =>
                    soma + linha.fatias.reduce((parcial, fatia) => parcial + fatia.quantidade, 0),
                  0,
                )}
                detalhe="soma das fatias"
                tom="ok"
              />
              <Metrica rotulo="Categorias" valor={comItens.length} detalhe="com demanda" />
            </div>

            {comItens.map((linha) => (
              <Cartao key={linha.categoriaCodigo} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-sm font-semibold">{linha.rotulo}</span>
                    <span className="ml-2 text-xs text-tinta-fraca">{linha.grupo}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="numerico text-sm">
                      entrada <strong>{linha.quantidade}</strong>
                    </span>
                    {linha.criterio ? (
                      <Selo tom="acento" titulo={CRITERIO[linha.criterio]?.explicacao}>
                        {CRITERIO[linha.criterio]?.texto ?? linha.criterio}
                      </Selo>
                    ) : null}
                  </div>
                </div>

                {/*
                  Relatório legível da rodada (`A6`). O texto vem pronto do
                  servidor, escrito por uma função PURA a partir do snapshot que
                  o motor gravou — a tela não recalcula nada para se explicar,
                  senão existiriam duas fontes para o mesmo número.
                */}
                {narrativaDe(mostrado, linha.categoriaCodigo).map((frase, indice) => (
                  <p
                    key={`${linha.categoriaCodigo}-${indice}`}
                    className="mt-2 text-xs leading-relaxed text-tinta-suave"
                  >
                    {frase}
                  </p>
                ))}

                {linha.erro ? (
                  <p className="mt-2 text-sm text-alerta">{linha.erro}</p>
                ) : (
                  <>
                    <ul className="mt-3 flex flex-col gap-1.5">
                      {linha.fatias.map((fatia) => (
                        <li
                          key={fatia.colaboradorId}
                          className="flex items-center justify-between gap-3 text-sm"
                        >
                          <span className="truncate">
                            {nomePor.get(fatia.colaboradorId) ?? fatia.colaboradorId}
                          </span>
                          <span className="flex items-center gap-3 whitespace-nowrap">
                            <span
                              className="numerico text-xs text-tinta-fraca"
                              title="Crédito antes → depois. Positivo significa que a pessoa recebeu menos do que a cota justa e leva a próxima sobra."
                            >
                              {fatia.creditoAntes.toFixed(2)} → {fatia.creditoDepois.toFixed(2)}
                            </span>
                            <span
                              className={juntar(
                                'numerico w-9 rounded-md px-2 py-0.5 text-right font-semibold',
                                fatia.quantidade > 0
                                  ? 'bg-acento-claro text-acento-escuro'
                                  : 'text-tinta-fraca',
                              )}
                            >
                              {fatia.quantidade}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="numerico mt-2 border-t border-borda pt-2 text-xs text-tinta-fraca">
                      cota justa {linha.cotaJusta.toFixed(2)} · piso {linha.base} · resto{' '}
                      {linha.resto} · soma{' '}
                      {linha.fatias.reduce((soma, fatia) => soma + fatia.quantidade, 0)} ={' '}
                      {linha.quantidade}
                    </p>
                  </>
                )}
              </Cartao>
            ))}
          </div>
        )}
      </section>

      {/*
        Antes de confirmar a rodada. A nota do setor não altera cota, peso nem
        crédito — quem decide continua sendo o motor. Ela existe para quem
        confirma saber o que a equipe já descobriu sobre o dia.
      */}
      <NotasDoSetor titulo="O que o setor já aprendeu sobre a rodada" />
    </div>
  )
}
