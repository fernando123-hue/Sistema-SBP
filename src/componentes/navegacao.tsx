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
    //
    // Abaixo de 1024 px — janela estreita ou zoom alto, que é critério de
    // acessibilidade também no computador — a coluna vira barra de cima, com o
    // bloco reduzido e as telas quebrando linha. Com a coluna fixa, a 400% de
    // zoom não sobrava nenhuma tela visível e o conteúdo ficava com 80 px
    // (revisão técnica do #151). Na coluna, ela rola INTEIRA: rolando só a
    // lista, marca e rodapé comiam as telas em janela baixa.
    //
    // `relative z-30`: o `sticky` cria contexto de empilhamento, e o painel da
    // Ajuda (fixo, `z-40`, filho deste aside) passava por BAIXO de elemento
    // semitransparente da página (revisão de segurança do #151).
    <aside className="relative z-30 flex w-full flex-col border-b border-borda bg-papel lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-b-0">
      <Link
        href={telaInicial(papel)}
        // Contorno de foco para DENTRO (`.foco-para-dentro`, em `globals.css`):
        // o bloco encosta no alto da janela, e o contorno para fora saía
        // cortado (revisão técnica do #151).
        className="foco-para-dentro group flex items-center gap-3 px-4 py-2 lg:flex-col lg:items-start lg:py-0 lg:pb-5"
      >
        {/*
          O bloco leva o nome da SBP como TEXTO (lido pelo leitor de tela); o P
          é decoração. "Atendimento ao Associado" completa o nome do link. Na
          barra estreita, o bloco reduzido não tem o nome, e ele vai só para o
          leitor de tela.
        */}
        <span className="hidden lg:block">
          <BlocoDaMarca altura={132} comNome ocupado={ocupado} />
        </span>
        <span className="lg:hidden">
          <BlocoDaMarca altura={48} ocupado={ocupado} />
        </span>
        <span className="text-sm leading-tight font-semibold text-tinta group-hover:text-acento">
          <span className="sr-only lg:hidden">Sociedade Brasileira de Pediatria — </span>
          Atendimento ao Associado
        </span>
      </Link>

      <nav aria-label="Principal" className="px-3 lg:flex-1">
        {/* `py-1`: o contorno de foco do primeiro item saía cortado em cima. */}
        <ul className="flex flex-wrap gap-0.5 py-1 lg:flex-col lg:flex-nowrap">
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

      <div className="flex flex-wrap items-center gap-3 border-t border-borda px-4 py-3 lg:flex-col lg:flex-nowrap lg:items-stretch lg:py-4">
        {/* A ajuda abre um painel fixo no canto da tela (`assistente.tsx`):
            o botão pode morar aqui, junto de quem está logado. */}
        <Assistente papel={papel} />
        <div className="flex items-end justify-between gap-2">
          <span className="min-w-0 text-xs leading-tight">
            {/* Inteiro, sem reticências: no computador compartilhado, a pessoa
                confere quem está logado antes de agir, e dois nomes com o mesmo
                começo ficavam iguais (revisão de segurança do #151). */}
            <span className="block font-medium break-words text-tinta">{nome}</span>
            <span className="block text-tinta-fraca">{papel}</span>
          </span>
          {/* Alvo de toque de 44 px no celular, como o `Botao` garante: com
              ~26 px, "sair" no balcão compartilhado era o controle mais fácil
              de errar — e sair errado é a sessão de pé para a próxima pessoa. */}
          <button
            onClick={() => void sair()}
            disabled={saindo}
            className="min-h-11 shrink-0 rounded-md px-3 text-xs text-tinta-suave hover:bg-papel-fundo hover:text-tinta disabled:opacity-50 sm:min-h-9 sm:px-2"
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
