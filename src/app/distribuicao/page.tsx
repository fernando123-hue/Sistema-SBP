'use client'

import { useCallback, useEffect, useState } from 'react'

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

interface LinhaDaEscala {
  colaboradorId: string
  nome: string
  papel: string
  disponivel: boolean
  capacidadeRelativa: number
  categorias: string[]
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

interface Resumo {
  data: string
  totalDistribuido: number
  rodadasGravadas: number
  linhas: LinhaDaPrevia[]
}

function hoje(): string {
  return new Date().toISOString().slice(0, 10)
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
  sem_demanda: { texto: 'sem demanda', explicacao: 'Nada a distribuir nesta categoria.' },
}

export default function Distribuicao() {
  const [data, setData] = useState(hoje)
  const [escala, setEscala] = useState<LinhaDaEscala[] | null>(null)
  const [previa, setPrevia] = useState<Resumo | null>(null)
  const [confirmado, setConfirmado] = useState<Resumo | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const carregarEscala = useCallback(async (dia: string) => {
    setEscala(null)
    try {
      setEscala(await api.buscar<LinhaDaEscala[]>(`/escala?data=${dia}`))
    } catch (causa) {
      setErro(mensagemDoErro(causa))
    }
  }, [])

  useEffect(() => {
    setPrevia(null)
    setConfirmado(null)
    void carregarEscala(data)
  }, [data, carregarEscala])

  const nomePor = new Map((escala ?? []).map((linha) => [linha.colaboradorId, linha.nome]))
  const dePlantao = (escala ?? []).filter((linha) => linha.disponivel)

  async function alternar(linha: LinhaDaEscala) {
    setErro(null)
    setPrevia(null)
    try {
      const atualizada = await api.atualizar<LinhaDaEscala[]>('/escala', {
        data,
        colaboradorId: linha.colaboradorId,
        disponivel: !linha.disponivel,
        capacidadeRelativa: linha.capacidadeRelativa,
      })
      setEscala(atualizada)
    } catch (causa) {
      setErro(mensagemDoErro(causa))
    }
  }

  async function executar(acao: 'sincronizar' | 'previa' | 'confirmar') {
    setOcupado(acao)
    setErro(null)
    try {
      if (acao === 'sincronizar') {
        await api.enviar('/ingestao')
        setPrevia(null)
      } else if (acao === 'previa') {
        setPrevia(await api.enviar<Resumo>('/distribuicao/previa', { data, categorias: [] }))
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
          <input
            type="date"
            value={data}
            onChange={(evento) => setData(evento.target.value)}
            className="numerico rounded-md border border-borda-forte bg-papel px-2.5 py-2 text-sm"
          />
        </label>
      </div>

      {erro ? <Aviso>{erro}</Aviso> : null}

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
                <Cartao destaque={linha.disponivel} className="px-3 py-2.5">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={linha.disponivel}
                      onChange={() => alternar(linha)}
                      className="mt-1 size-4 accent-[var(--color-acento)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{linha.nome}</span>
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
              : 'O que aparece aqui é exatamente o que será gravado — mesma função, mesmo cálculo.'
          }
          acao={
            <div className="flex gap-2">
              <Botao onClick={() => executar('previa')} desabilitado={ocupado !== null}>
                {ocupado === 'previa' ? 'calculando…' : 'Calcular prévia'}
              </Botao>
              <Botao
                variante="principal"
                onClick={() => executar('confirmar')}
                desabilitado={ocupado !== null || previa === null || comErro.length > 0}
              >
                {ocupado === 'confirmar' ? 'gravando…' : 'Confirmar'}
              </Botao>
            </div>
          }
        />

        {comErro.length > 0 ? (
          <div className="mb-3">
            <Aviso tom="atencao">
              <strong>{comErro.length} categoria(s) sem ninguém elegível.</strong> O trabalho fica na
              fila até haver plantão — nada é descartado. Marque alguém habilitado e recalcule.
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
    </div>
  )
}
