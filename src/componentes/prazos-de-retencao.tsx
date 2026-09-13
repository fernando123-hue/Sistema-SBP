'use client'

import { useCallback, useEffect, useState } from 'react'

import { PRAZO_MAXIMO_EM_DIAS, PRAZO_MINIMO_EM_DIAS, type ChaveDePrazo } from '../core/esquemas'
import type { PrazoEmVigor } from '../core/retencao'
import type { NaRede } from '../core/tipos'
import { paraDataIso } from '../core/util/datas'
import { api, mensagemDoErro } from './api'
import { Aviso, Botao, CabecalhoDeSecao, Cartao, Carregando } from './matrizes'

type Prazo = NaRede<PrazoEmVigor>

/** O que cada prazo significa, escrito para quem decide — não para quem programa. */
const SOBRE: Readonly<Record<ChaveDePrazo, { titulo: string; explicacao: string; oQueApaga: string }>> = {
  motivo_de_afastamento: {
    titulo: 'Motivo de afastamento',
    explicacao:
      'Conta a partir do dia em que a pessoa volta. Passado o prazo, a observação é apagada e o tipo vira "férias" ou "ausente". Ausência sem data de volta não conta, e as datas nunca saem.',
    oQueApaga: 'o motivo das ausências que já passaram do novo prazo',
  },
}

function diaCurto(instante: string): string {
  const [ano, mes, dia] = paraDataIso(new Date(instante)).split('-')
  return `${dia}/${mes}/${ano}`
}

/**
 * Prazos de retenção — `A17`. Fica na tela de acesso porque é de gestor.
 *
 * ENCURTAR PEDE DOIS CLIQUES. Encurtar apaga, na limpeza seguinte, o que o
 * prazo antigo ainda guardava, e não há desfazer. O servidor também recusa o
 * encurtamento sem confirmação — a pergunta aqui é para quem lê, a trava lá é
 * para quem não passou por esta tela.
 */
export function PrazosDeRetencao({
  aoFalhar,
  ocupado,
}: {
  aoFalhar: (mensagem: string | null) => void
  ocupado: boolean
}) {
  const [prazos, setPrazos] = useState<Prazo[] | null>(null)
  /** O que está digitado e ainda não foi salvo, por prazo. */
  const [rascunho, setRascunho] = useState<Partial<Record<ChaveDePrazo, string>>>({})
  const [confirmando, setConfirmando] = useState<ChaveDePrazo | null>(null)
  const [salvando, setSalvando] = useState<ChaveDePrazo | null>(null)

  const carregar = useCallback(async () => {
    try {
      setPrazos(await api.buscar<Prazo[]>('/retencao'))
    } catch (causa) {
      // Lista vazia, não `null`: `null` desenha "Carregando…" para sempre.
      setPrazos([])
      aoFalhar(mensagemDoErro(causa))
    }
  }, [aoFalhar])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function salvar(chave: ChaveDePrazo, dias: number, confirmarEncurtamento: boolean) {
    setSalvando(chave)
    aoFalhar(null)
    try {
      await api.atualizar('/retencao', { chave, dias, confirmarEncurtamento })
      setConfirmando(null)
      setRascunho((atual) => {
        const restante = { ...atual }
        delete restante[chave]
        return restante
      })
      await carregar()
    } catch (causa) {
      aoFalhar(mensagemDoErro(causa))
    } finally {
      setSalvando(null)
    }
  }

  return (
    <section className="mt-2">
      <CabecalhoDeSecao
        titulo="Prazos de retenção"
        descricao="Por quanto tempo o sistema guarda dado pessoal depois que ele deixa de ser necessário. A limpeza roda sozinha, uma vez por dia; uma mudança vale a partir da limpeza seguinte."
      />

      {prazos === null ? (
        <Carregando />
      ) : (
        <ul className="flex flex-col gap-2">
          {prazos.map((prazo) => {
            const sobre = SOBRE[prazo.chave]
            const texto = rascunho[prazo.chave] ?? String(prazo.dias)
            const dias = Number(texto)
            const valido =
              texto.trim() !== '' &&
              Number.isInteger(dias) &&
              dias >= PRAZO_MINIMO_EM_DIAS &&
              dias <= PRAZO_MAXIMO_EM_DIAS
            const mudou = valido && dias !== prazo.dias
            const encurta = mudou && dias < prazo.dias
            const aguardandoConfirmacao = encurta && confirmando === prazo.chave

            return (
              <li key={prazo.chave}>
                <Cartao className="px-4 py-3">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="min-w-0 flex-1 basis-64">
                      <p className="text-sm font-medium">{sobre.titulo}</p>
                      <p className="mt-1 text-xs text-tinta-suave">{sobre.explicacao}</p>
                      <p className="mt-1 text-xs text-tinta-fraca">
                        {prazo.alteradoEm === null
                          ? `Valor padrão (${prazo.padrao} dias). Ninguém alterou.`
                          : `Alterado por ${prazo.alteradoPorNome ?? 'pessoa fora do cadastro'} em ${diaCurto(prazo.alteradoEm)}. Padrão: ${prazo.padrao} dias.`}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="number"
                          inputMode="numeric"
                          min={PRAZO_MINIMO_EM_DIAS}
                          max={PRAZO_MAXIMO_EM_DIAS}
                          step={1}
                          value={texto}
                          aria-label={`${sobre.titulo}: prazo em dias`}
                          onChange={(evento) => {
                            const valor = evento.target.value
                            setRascunho((atual) => ({ ...atual, [prazo.chave]: valor }))
                            // Mudou o número depois de pedir confirmação: a
                            // pergunta feita era sobre OUTRO número.
                            setConfirmando(null)
                          }}
                          className="w-20 rounded-md border border-borda-forte bg-papel px-2.5 py-2 text-sm"
                        />
                        <span className="text-tinta-suave">dias</span>
                      </label>
                      <Botao
                        tamanho="pequeno"
                        variante={aguardandoConfirmacao ? 'perigo' : 'principal'}
                        desabilitado={!mudou || ocupado || salvando !== null}
                        onClick={() => {
                          if (encurta && !aguardandoConfirmacao) {
                            setConfirmando(prazo.chave)
                            return
                          }
                          void salvar(prazo.chave, dias, encurta)
                        }}
                      >
                        {salvando === prazo.chave
                          ? 'salvando…'
                          : aguardandoConfirmacao
                            ? 'Confirmar: encurtar'
                            : 'Salvar'}
                      </Botao>
                    </div>
                  </div>

                  {!valido ? (
                    <div className="mt-3">
                      <Aviso>
                        Use um número inteiro de {PRAZO_MINIMO_EM_DIAS} a {PRAZO_MAXIMO_EM_DIAS} dias.
                      </Aviso>
                    </div>
                  ) : null}

                  {aguardandoConfirmacao ? (
                    <div className="mt-3">
                      <Aviso tom="atencao">
                        Encurtar de <strong>{prazo.dias}</strong> para <strong>{dias}</strong> dias
                        apaga, na próxima limpeza diária, {sobre.oQueApaga} — <strong>sem volta</strong>.
                      </Aviso>
                    </div>
                  ) : null}
                </Cartao>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
