'use client'

import { useCallback, useEffect, useState } from 'react'

import { api, mensagemDoErro } from '../../componentes/api'
import {
  Aviso,
  CabecalhoDeSecao,
  Carregando,
  ListaResponsiva,
  Selo,
  SeloDeConfianca,
  SeloDeStatus,
  Vazio,
  juntar,
} from '../../componentes/matrizes'

interface ItemDaCaixa {
  itemId: string
  titulo: string
  categoriaCodigo: string
  categoriaRotulo: string
  grupo: string
  status: string
  confianca: number
  remetente: string | null
  assunto: string | null
  recebidoEm: string | null
  irmaos: number
  responsavel: string | null
}

interface Resumo {
  total: number
  porStatus: Record<string, number>
  porCategoria: { codigo: string; rotulo: string; grupo: string; total: number }[]
}

/**
 * Caixa de entrada.
 *
 * O contraponto direto à planilha: onde havia "e-mail: 47", há os 47 itens,
 * com remetente, assunto, confiança da classificação e responsável.
 */
export default function Caixa() {
  const [dados, setDados] = useState<{ itens: ItemDaCaixa[]; resumo: Resumo } | null>(null)
  const [filtro, setFiltro] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async (categoria: string | null) => {
    setDados(null)
    try {
      const consulta = categoria ? `?categoria=${categoria}&limite=200` : '?limite=200'
      setDados(await api.buscar<{ itens: ItemDaCaixa[]; resumo: Resumo }>(`/itens${consulta}`))
    } catch (causa) {
      setErro(mensagemDoErro(causa))
    }
  }, [])

  useEffect(() => {
    void carregar(filtro)
  }, [filtro, carregar])

  return (
    <div className="flex flex-col gap-5">
      <CabecalhoDeSecao
        titulo="Caixa de entrada"
        descricao="Cada linha é um item de trabalho real — não uma contagem."
      />

      {erro ? <Aviso>{erro}</Aviso> : null}

      {dados === null ? (
        <Carregando />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setFiltro(null)}
              className={juntar(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                filtro === null
                  ? 'border-acento bg-acento-claro text-acento-escuro'
                  : 'border-borda text-tinta-suave hover:bg-papel-fundo',
              )}
            >
              todas · {dados.resumo.total}
            </button>
            {dados.resumo.porCategoria.map((categoria) => (
              <button
                key={categoria.codigo}
                onClick={() => setFiltro(categoria.codigo)}
                className={juntar(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  filtro === categoria.codigo
                    ? 'border-acento bg-acento-claro text-acento-escuro'
                    : 'border-borda text-tinta-suave hover:bg-papel-fundo',
                )}
              >
                {categoria.rotulo} · {categoria.total}
              </button>
            ))}
          </div>

          {dados.itens.length === 0 ? (
            <Vazio
              titulo="Nenhum item"
              descricao="Use “Buscar e-mails” na tela de Distribuição para trazer a caixa."
            />
          ) : (
            <ListaResponsiva
              linhas={dados.itens}
              chaveDaLinha={(item) => item.itemId}
              tituloDoCartao={(item) => item.titulo}
              colunas={[
                {
                  chave: 'titulo',
                  cabecalho: 'Item',
                  ocultarNoCartao: true,
                  conteudo: (item) => (
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.titulo}</p>
                      <p className="truncate text-xs text-tinta-fraca">
                        {item.remetente ?? 'origem manual'}
                      </p>
                    </div>
                  ),
                },
                {
                  chave: 'categoria',
                  cabecalho: 'Categoria',
                  conteudo: (item) => (
                    <span className="flex items-center gap-1.5">
                      <Selo>{item.categoriaRotulo}</Selo>
                      {item.irmaos > 1 ? (
                        <Selo
                          tom="acento"
                          titulo={`Este e-mail gerou ${item.irmaos} itens — um e-mail pode valer N unidades de carga.`}
                        >
                          {item.irmaos}×
                        </Selo>
                      ) : null}
                    </span>
                  ),
                },
                {
                  chave: 'confianca',
                  cabecalho: 'Confiança',
                  conteudo: (item) => <SeloDeConfianca valor={item.confianca} />,
                },
                {
                  chave: 'status',
                  cabecalho: 'Situação',
                  conteudo: (item) => <SeloDeStatus status={item.status} />,
                },
                {
                  chave: 'responsavel',
                  cabecalho: 'Responsável',
                  alinhamento: 'direita',
                  conteudo: (item) => (
                    <span className="text-sm text-tinta-suave">{item.responsavel ?? '—'}</span>
                  ),
                },
              ]}
            />
          )}
        </>
      )}
    </div>
  )
}
