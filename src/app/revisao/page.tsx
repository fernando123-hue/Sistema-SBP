'use client'

import { useCallback, useEffect, useState } from 'react'

import { api, mensagemDoErro } from '../../componentes/api'
import {
  Aviso,
  Botao,
  CabecalhoDeSecao,
  Cartao,
  Carregando,
  Selo,
  SeloDeConfianca,
  Vazio,
} from '../../componentes/matrizes'

interface ItemEmRevisao {
  revisaoId: string
  itemId: string
  motivo: string
  confianca: number
  campoIncerto: string | null
  titulo: string
  categoriaCodigo: string
  remetente: string | null
  assunto: string | null
  sugestaoIa: string
}

const CATEGORIAS = [
  'DOC_CADASTRO',
  'FICHA_CADASTRO',
  'EMAIL_CADASTRO',
  'LIGA',
  'LIGANTE',
  'EMAIL_LIGA',
] as const

interface ItemExtra {
  titulo: string
  campos: Record<string, string>
}

interface Edicao {
  titulo: string
  categoria: string
  campos: Record<string, string>
  extras: ItemExtra[]
}

const MOTIVO: Record<string, { texto: string; tom: 'atencao' | 'alerta' | 'neutro' }> = {
  baixa_confianca: { texto: 'confiança abaixo do limiar', tom: 'atencao' },
  campo_ausente: { texto: 'campo obrigatório faltando', tom: 'atencao' },
  duplicata_suspeita: { texto: 'possível duplicata', tom: 'atencao' },
  anomalia: { texto: 'anomalia', tom: 'alerta' },
  conteudo_suspeito: { texto: 'conteúdo suspeito', tom: 'alerta' },
  desdobramento: { texto: 'e-mail gerou vários itens', tom: 'atencao' },
}

/**
 * Fila de revisão.
 *
 * O operador não recomeça do zero: parte da sugestão da IA, corrige o que
 * estiver errado e aprova. A diferença entre a sugestão e o valor final é a
 * medida de acerto do modelo — e é ela que autoriza afrouxar o limiar depois.
 */
export default function Revisao() {
  const [pendentes, setPendentes] = useState<ItemEmRevisao[] | null>(null)
  /** Quantas existem de verdade. Maior que a lista = a fila está truncada. */
  const [totalPendentes, setTotalPendentes] = useState(0)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [edicao, setEdicao] = useState<Record<string, Edicao>>({})

  const carregar = useCallback(async () => {
    try {
      const fila = await api.buscar<{ itens: ItemEmRevisao[]; total: number }>('/revisao')
      const lista = fila.itens
      setTotalPendentes(fila.total)
      setPendentes(lista)
      setEdicao(
        Object.fromEntries(
          lista.map((item) => [
            item.revisaoId,
            {
              titulo: item.titulo,
              categoria: item.categoriaCodigo,
              campos: camposSugeridos(item),
              extras: [],
            },
          ]),
        ),
      )
    } catch (causa) {
      setErro(mensagemDoErro(causa))
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  function mudarEdicao(revisaoId: string, parcial: Partial<Edicao>) {
    setEdicao((mapa) => ({ ...mapa, [revisaoId]: { ...mapa[revisaoId]!, ...parcial } }))
  }

  function mudarCampo(revisaoId: string, chave: string, valor: string) {
    const atual = edicao[revisaoId]
    if (!atual) return
    mudarEdicao(revisaoId, { campos: { ...atual.campos, [chave]: valor } })
  }

  /**
   * "A IA propõe N; o operador ajusta" (AT-06). Quando um item de lista ainda
   * esconde gente — "e mais 2 ligantes" no rodapé — o operador adiciona aqui
   * em vez de o sistema contar carga de menos pra sempre.
   */
  function adicionarExtra(revisaoId: string, chavesCampos: string[]) {
    const atual = edicao[revisaoId]
    if (!atual) return
    const novo: ItemExtra = {
      titulo: '',
      campos: Object.fromEntries(chavesCampos.map((chave) => [chave, ''])),
    }
    mudarEdicao(revisaoId, { extras: [...atual.extras, novo] })
  }

  function removerExtra(revisaoId: string, indice: number) {
    const atual = edicao[revisaoId]
    if (!atual) return
    mudarEdicao(revisaoId, { extras: atual.extras.filter((_, i) => i !== indice) })
  }

  function mudarExtra(revisaoId: string, indice: number, parcial: Partial<ItemExtra>) {
    const atual = edicao[revisaoId]
    if (!atual) return
    const extras = atual.extras.map((extra, i) => (i === indice ? { ...extra, ...parcial } : extra))
    mudarEdicao(revisaoId, { extras })
  }

  async function resolver(item: ItemEmRevisao, aprovar: boolean) {
    const atual = edicao[item.revisaoId]
    const extras = atual?.extras ?? []

    // NÃO descarta item sem título em silêncio.
    //
    // Filtrar os vazios aqui era exatamente a doença que esta tela existe para
    // curar: o operador adicionava o ligante esquecido, esquecia o título, e o
    // sistema voltava a contar carga de menos — agora sem nem o rastro que a
    // IA tinha deixado. Some com o trabalho e não conta a ninguém.
    if (aprovar && extras.some((extra) => extra.titulo.trim() === '')) {
      setErro('Há item novo sem título. Preencha o título ou remova o item antes de aprovar.')
      return
    }

    setOcupado(item.revisaoId)
    setErro(null)
    try {
      await api.enviar('/revisao/resolver', {
        revisaoId: item.revisaoId,
        categoriaCodigo: atual?.categoria ?? item.categoriaCodigo,
        titulo: atual?.titulo ?? item.titulo,
        campos: atual?.campos ?? {},
        aprovar,
        // Descartar é decisão sobre o item original; os extras nem chegam a
        // existir, então não há o que criar.
        itensExtras: aprovar ? extras : [],
      })
      setPendentes((lista) => (lista ?? []).filter((linha) => linha.revisaoId !== item.revisaoId))
    } catch (causa) {
      setErro(mensagemDoErro(causa))
    } finally {
      setOcupado(null)
    }
  }

  function camposSugeridos(item: ItemEmRevisao): Record<string, string> {
    try {
      const sugestao = JSON.parse(item.sugestaoIa) as { campos?: Record<string, string> }
      return sugestao.campos ?? {}
    } catch {
      return {}
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <CabecalhoDeSecao
        titulo="Revisão"
        descricao={
          pendentes === null
            ? 'Carregando…'
            : pendentes.length === 0
              ? 'Nada aguardando decisão humana.'
              : `${totalPendentes} itens em que a IA não teve certeza suficiente.`
        }
      />

      {pendentes !== null && totalPendentes > pendentes.length ? (
        <Aviso tom="atencao">
          <strong>
            {totalPendentes} revisões pendentes, e esta tela mostra {pendentes.length}.
          </strong>{' '}
          A ordem é fixa (menor confiança primeiro), então o que ficou além do corte não sobe
          sozinho — resolva a fila para o resto aparecer. Sem este aviso, a tela diria
          &ldquo;{pendentes.length} itens&rdquo; para sempre enquanto a fila crescia atrás dela.
        </Aviso>
      ) : null}

      {erro ? <Aviso>{erro}</Aviso> : null}

      {pendentes === null ? (
        <Carregando />
      ) : pendentes.length === 0 ? (
        <Vazio
          titulo="Fila de revisão vazia"
          descricao="Todos os itens passaram do limiar de confiança das suas categorias."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {pendentes.map((item) => {
            const info = MOTIVO[item.motivo] ?? { texto: item.motivo, tom: 'neutro' as const }
            const atual = edicao[item.revisaoId]

            return (
              <li key={item.revisaoId}>
                <Cartao className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Selo tom={info.tom}>{info.texto}</Selo>
                    <SeloDeConfianca valor={item.confianca} />
                    {item.campoIncerto ? <Selo>falta: {item.campoIncerto}</Selo> : null}
                  </div>

                  <p className="mt-2 text-xs text-tinta-suave">
                    de {item.remetente ?? 'origem manual'}
                    {item.assunto ? ` · ${item.assunto}` : ''}
                  </p>

                  {item.motivo === 'conteudo_suspeito' ? (
                    <div className="mt-2">
                      <Aviso tom="alerta">
                        O conteúdo deste e-mail tentou dar instruções ao sistema. Foi tratado como
                        dado comum e não teve efeito nenhum sobre a distribuição. Confira antes de
                        aprovar.
                      </Aviso>
                    </div>
                  ) : null}

                  {Object.keys(atual?.campos ?? {}).length > 0 ? (
                    <div className="mt-3 grid grid-cols-2 gap-2 rounded-md bg-papel-fundo px-3 py-2 sm:grid-cols-3">
                      {Object.entries(atual?.campos ?? {}).map(([chave, valor]) => (
                        <label key={chave} className="flex flex-col gap-1">
                          <span className="text-xs text-tinta-fraca">{chave}</span>
                          <input
                            value={valor}
                            onChange={(evento) => mudarCampo(item.revisaoId, chave, evento.target.value)}
                            className="min-h-9 rounded-md border border-borda-forte bg-papel px-2 text-sm"
                          />
                        </label>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-tinta-fraca">Título</span>
                      <input
                        value={atual?.titulo ?? item.titulo}
                        onChange={(evento) =>
                          mudarEdicao(item.revisaoId, { titulo: evento.target.value })
                        }
                        className="min-h-10 rounded-md border border-borda-forte bg-papel px-2.5 text-sm"
                      />
                    </label>

                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-tinta-fraca">Categoria</span>
                      <select
                        value={atual?.categoria ?? item.categoriaCodigo}
                        onChange={(evento) =>
                          mudarEdicao(item.revisaoId, { categoria: evento.target.value })
                        }
                        className="min-h-10 rounded-md border border-borda-forte bg-papel px-2.5 text-sm"
                      >
                        {CATEGORIAS.map((codigo) => (
                          <option key={codigo} value={codigo}>
                            {codigo.toLowerCase().replaceAll('_', ' ')}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="mt-3 flex flex-col gap-2 rounded-md border border-dashed border-borda-forte px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-tinta-fraca">
                        Este e-mail escondia mais gente? Adicione os itens que a IA não separou.
                      </span>
                      <Botao
                        variante="secundario"
                        tamanho="pequeno"
                        onClick={() =>
                          adicionarExtra(item.revisaoId, Object.keys(atual?.campos ?? {}))
                        }
                      >
                        + item
                      </Botao>
                    </div>

                    {(atual?.extras ?? []).map((extra, indice) => (
                      <div
                        key={indice}
                        className="flex flex-col gap-2 rounded-md bg-papel-fundo px-2.5 py-2 sm:flex-row sm:items-start"
                      >
                        <input
                          value={extra.titulo}
                          required
                          aria-label="título do item novo"
                          placeholder="título do item (obrigatório)"
                          onChange={(evento) =>
                            mudarExtra(item.revisaoId, indice, { titulo: evento.target.value })
                          }
                          className="min-h-9 flex-1 rounded-md border border-borda-forte bg-papel px-2 text-sm"
                        />
                        {Object.keys(extra.campos).map((chave) => (
                          <input
                            key={chave}
                            value={extra.campos[chave] ?? ''}
                            placeholder={chave}
                            onChange={(evento) =>
                              mudarExtra(item.revisaoId, indice, {
                                campos: { ...extra.campos, [chave]: evento.target.value },
                              })
                            }
                            className="min-h-9 flex-1 rounded-md border border-borda-forte bg-papel px-2 text-sm"
                          />
                        ))}
                        <Botao
                          variante="perigo"
                          tamanho="pequeno"
                          onClick={() => removerExtra(item.revisaoId, indice)}
                        >
                          remover
                        </Botao>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 flex justify-end gap-2">
                    <Botao
                      variante="perigo"
                      tamanho="pequeno"
                      onClick={() => resolver(item, false)}
                      desabilitado={ocupado !== null}
                    >
                      Descartar
                    </Botao>
                    <Botao
                      variante="principal"
                      tamanho="pequeno"
                      onClick={() => resolver(item, true)}
                      desabilitado={ocupado !== null}
                    >
                      {ocupado === item.revisaoId ? 'salvando…' : 'Aprovar'}
                    </Botao>
                  </div>
                </Cartao>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
