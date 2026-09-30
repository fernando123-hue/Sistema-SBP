'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Assistente } from './assistente'
import { BlocoDaMarca } from './marca'
import { api, mensagemDoErro, observarAtividade } from './api'
import { PAPEIS_DA_TELA, ROTULO_DA_TELA, TELAS, telaInicial } from '../core/telas'
import { juntar } from './matrizes'

// Derivados de `core/telas.ts`, a mesma fonte que a segunda conferência do
// assistente lê. Mantidos à mão em dois lugares, divergiam calados. Esconder o
// link continua sendo conveniência, não proteção: a rota confere no servidor.
const DESTINOS = TELAS.map((href) => ({
  href,
  rotulo: ROTULO_DA_TELA[href],
  papeis: PAPEIS_DA_TELA[href],
}))

export function Navegacao({ nome, papel }: { nome: string; papel: string }) {
  const caminho = usePathname()
  const navegador = useRouter()
  const [saindo, setSaindo] = useState(false)
  const [erroAoSair, setErroAoSair] = useState<string | null>(null)
  /**
   * A marca respira enquanto há requisição em voo.
   *
   * O sinal vem de `api.ts`, que já é a porta única de toda tela — nenhuma
   * delas precisa avisar nada. Substitui um indicador genérico por um que É a
   * identidade, e reflete um fato, não uma métrica.
   */
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => observarAtividade(setOcupado), [])

  const visiveis = DESTINOS.filter((destino) => destino.papeis.includes(papel as never))

  /**
   * Sair, e dizer a verdade quando não deu.
   *
   * A versão anterior era `await api.remover('/sessao')` seguido de
   * `push('/entrar')`, sem `try`. Qualquer falha — rede oscilando, servidor
   * reiniciando — rejeitava no `await` e a navegação NUNCA acontecia: a tela
   * ficava idêntica, sem aviso nenhum, e a única evidência era uma rejeição no
   * console do navegador. A pessoa clicava, não via nada mudar, concluía que
   * travou e ia embora com a sessão de pé — no balcão compartilhado, a próxima
   * pessoa entrava como ela, e a trilha registrava o nome dela.
   *
   * Agora a falha aparece e a sessão NÃO é dada como encerrada. Isto é o
   * oposto do que `senha/page.tsx` fazia com `.catch(() => null)`: lá a
   * navegação seguia de qualquer jeito, o que esconde exatamente o caso
   * perigoso. Sair é revogação — se ela não aconteceu no servidor, mandar a
   * pessoa para a tela de entrada é dizer que ela saiu quando ela não saiu.
   */
  async function sair() {
    if (saindo) return
    setSaindo(true)
    setErroAoSair(null)
    try {
      await api.remover('/sessao')
      navegador.push('/entrar')
      navegador.refresh()
    } catch (causa) {
      setErroAoSair(mensagemDoErro(causa))
    } finally {
      setSaindo(false)
    }
  }

  return (
    // ═══ MENU LATERAL ═══
    //
    // A identidade da SBP (30/09/2026, pedido do dono, referência feita no
    // Stitch): o bloco azul da marca encostado no alto, como no site da SBP,
    // as telas numa coluna, e quem está logado embaixo. O sistema é só para
    // computador (`A60`), e a coluna devolve a altura inteira da tela ao
    // trabalho — a barra de cima comia uma faixa de todas as telas.
    <aside className="sticky top-0 flex h-dvh w-60 shrink-0 flex-col border-r border-borda bg-papel">
      <Link href={telaInicial(papel)} className="group flex flex-col gap-3 px-4 pb-5">
        {/*
          O bloco leva o nome da SBP como TEXTO (lido pelo leitor de tela); o P
          é decoração. "Atendimento ao Associado" completa o nome do link.
        */}
        <BlocoDaMarca altura={132} comNome ocupado={ocupado} />
        <span className="text-sm leading-tight font-semibold text-tinta group-hover:text-acento">
          Atendimento ao Associado
        </span>
      </Link>

      <nav aria-label="Principal" className="flex-1 overflow-y-auto px-3">
        <ul className="flex flex-col gap-0.5">
          {visiveis.map((destino) => {
            const ativo = caminho.startsWith(destino.href)
            return (
              <li key={destino.href}>
                <Link
                  href={destino.href}
                  aria-current={ativo ? 'page' : undefined}
                  className={juntar(
                    'flex items-center rounded-md border-l-[3px] px-3 py-2 text-sm transition-colors',
                    ativo
                      ? 'border-acento bg-acento-claro font-semibold text-acento-escuro'
                      : 'border-transparent text-tinta-suave hover:bg-papel-fundo hover:text-tinta',
                  )}
                >
                  {destino.rotulo}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="flex flex-col gap-3 border-t border-borda px-4 py-4">
        {/* A ajuda abre um painel fixo no canto da tela (`assistente.tsx`):
            o botão pode morar aqui, junto de quem está logado. */}
        <Assistente papel={papel} />
        <div className="flex items-end justify-between gap-2">
          <span className="min-w-0 text-xs leading-tight">
            <span className="block truncate font-medium text-tinta">{nome}</span>
            <span className="block text-tinta-fraca">{papel}</span>
          </span>
          <button
            onClick={() => void sair()}
            disabled={saindo}
            className="min-h-9 rounded-md px-2 text-xs text-tinta-suave hover:bg-papel-fundo hover:text-tinta disabled:opacity-50"
          >
            {saindo ? 'saindo…' : 'sair'}
          </button>
        </div>
        {erroAoSair ? (
          <div role="alert" className="rounded-md border border-alerta/40 bg-alerta-claro px-3 py-2 text-xs text-alerta">
            Não foi possível sair: {erroAoSair} <strong>Você continua conectado.</strong> Tente de novo.
          </div>
        ) : null}
      </div>
    </aside>
  )
}
