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
  Vazio,
} from '../../componentes/matrizes'

interface ItemDaFila {
  itemId: string
  titulo: string
  categoriaCodigo: string
  categoriaRotulo: string
  status: string
  remetente: string | null
  assunto: string | null
  recebidoEm: string | null
  atribuidoEm: string
}

function quando(valor: string | null): string {
  if (!valor) return '—'
  return new Date(valor).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

/**
 * Minha fila.
 *
 * A tela que substitui "Paulo: 24". Em vez de um número, os 24 itens reais,
 * com remetente e assunto. Mobile-first: é a tela que será aberta no celular.
 */
export default function Fila() {
  const [itens, setItens] = useState<ItemDaFila[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      setItens(await api.buscar<ItemDaFila[]>('/fila'))
    } catch (causa) {
      setErro(mensagemDoErro(causa))
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function concluir(item: ItemDaFila) {
    setOcupado(item.itemId)
    setErro(null)
    try {
      await api.enviar(`/itens/${item.itemId}/concluir`)
      setItens((atual) => (atual ?? []).filter((linha) => linha.itemId !== item.itemId))
    } catch (causa) {
      setErro(mensagemDoErro(causa))
    } finally {
      setOcupado(null)
    }
  }

  const porCategoria = new Map<string, ItemDaFila[]>()
  for (const item of itens ?? []) {
    porCategoria.set(item.categoriaRotulo, [...(porCategoria.get(item.categoriaRotulo) ?? []), item])
  }

  return (
    <div className="flex flex-col gap-5">
      <CabecalhoDeSecao
        titulo="Minha fila"
        descricao={
          itens === null
            ? 'Carregando…'
            : `${itens.length} ${itens.length === 1 ? 'item' : 'itens'} para trabalhar. O que não terminar hoje continua seu amanhã.`
        }
      />

      {erro ? <Aviso>{erro}</Aviso> : null}

      {itens === null ? (
        <Carregando />
      ) : itens.length === 0 ? (
        <Vazio titulo="Fila vazia" descricao="Nada atribuído a você no momento." />
      ) : (
        <div className="flex flex-col gap-5">
          {[...porCategoria.entries()].map(([categoria, lista]) => (
            <section key={categoria}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                {categoria}
                <Selo>{lista.length}</Selo>
              </h2>

              <ul className="flex flex-col gap-2">
                {lista.map((item) => (
                  <li key={item.itemId}>
                    <Cartao className="px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{item.titulo}</p>
                          <p className="mt-0.5 truncate text-xs text-tinta-suave">
                            {item.remetente ?? 'origem manual'}
                          </p>
                          {item.assunto && item.assunto !== item.titulo ? (
                            <p className="mt-0.5 truncate text-xs text-tinta-fraca">
                              {item.assunto}
                            </p>
                          ) : null}
                        </div>
                        <span className="numerico text-xs whitespace-nowrap text-tinta-fraca">
                          {quando(item.recebidoEm)}
                        </span>
                      </div>

                      <div className="mt-3 flex justify-end">
                        <Botao
                          variante="principal"
                          tamanho="pequeno"
                          onClick={() => concluir(item)}
                          desabilitado={ocupado !== null}
                        >
                          {ocupado === item.itemId ? 'concluindo…' : 'Concluir'}
                        </Botao>
                      </div>
                    </Cartao>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
