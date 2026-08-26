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

const MOTIVO: Record<string, { texto: string; tom: 'atencao' | 'alerta' | 'neutro' }> = {
  baixa_confianca: { texto: 'confiança abaixo do limiar', tom: 'atencao' },
  campo_ausente: { texto: 'campo obrigatório faltando', tom: 'atencao' },
  duplicata_suspeita: { texto: 'possível duplicata', tom: 'atencao' },
  anomalia: { texto: 'anomalia', tom: 'alerta' },
  conteudo_suspeito: { texto: 'conteúdo suspeito', tom: 'alerta' },
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
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [edicao, setEdicao] = useState<Record<string, { titulo: string; categoria: string }>>({})

  const carregar = useCallback(async () => {
    try {
      const lista = await api.buscar<ItemEmRevisao[]>('/revisao')
      setPendentes(lista)
      setEdicao(
        Object.fromEntries(
          lista.map((item) => [
            item.revisaoId,
            { titulo: item.titulo, categoria: item.categoriaCodigo },
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

  async function resolver(item: ItemEmRevisao, aprovar: boolean) {
    setOcupado(item.revisaoId)
    setErro(null)
    const atual = edicao[item.revisaoId]
    try {
      await api.enviar('/revisao/resolver', {
        revisaoId: item.revisaoId,
        categoriaCodigo: atual?.categoria ?? item.categoriaCodigo,
        titulo: atual?.titulo ?? item.titulo,
        campos: {},
        aprovar,
      })
      setPendentes((lista) => (lista ?? []).filter((linha) => linha.revisaoId !== item.revisaoId))
    } catch (causa) {
      setErro(mensagemDoErro(causa))
    } finally {
      setOcupado(null)
    }
  }

  function campos(item: ItemEmRevisao): [string, string][] {
    try {
      const sugestao = JSON.parse(item.sugestaoIa) as { campos?: Record<string, string> }
      return Object.entries(sugestao.campos ?? {})
    } catch {
      return []
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
              : `${pendentes.length} itens em que a IA não teve certeza suficiente.`
        }
      />

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

                  {campos(item).length > 0 ? (
                    <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 rounded-md bg-papel-fundo px-3 py-2 text-xs">
                      {campos(item).map(([chave, valor]) => (
                        <div key={chave}>
                          <dt className="inline text-tinta-fraca">{chave}: </dt>
                          <dd className="inline font-medium">{valor}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}

                  <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-tinta-fraca">Título</span>
                      <input
                        value={atual?.titulo ?? item.titulo}
                        onChange={(evento) =>
                          setEdicao((mapa) => ({
                            ...mapa,
                            [item.revisaoId]: {
                              titulo: evento.target.value,
                              categoria: atual?.categoria ?? item.categoriaCodigo,
                            },
                          }))
                        }
                        className="min-h-10 rounded-md border border-borda-forte bg-papel px-2.5 text-sm"
                      />
                    </label>

                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-tinta-fraca">Categoria</span>
                      <select
                        value={atual?.categoria ?? item.categoriaCodigo}
                        onChange={(evento) =>
                          setEdicao((mapa) => ({
                            ...mapa,
                            [item.revisaoId]: {
                              titulo: atual?.titulo ?? item.titulo,
                              categoria: evento.target.value,
                            },
                          }))
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
