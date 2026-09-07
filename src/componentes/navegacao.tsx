'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'

import { api, mensagemDoErro } from './api'
import { juntar } from './matrizes'

const DESTINOS = [
  { href: '/distribuicao', rotulo: 'Distribuição', papeis: ['operador', 'gestor'] },
  { href: '/revisao', rotulo: 'Revisão', papeis: ['operador', 'gestor'] },
  { href: '/caixa', rotulo: 'Caixa de entrada', papeis: ['operador', 'gestor', 'colaborador'] },
  { href: '/fila', rotulo: 'Minha fila', papeis: ['operador', 'gestor', 'colaborador'] },
  { href: '/painel', rotulo: 'Painel', papeis: ['operador', 'gestor', 'colaborador'] },
  // A rota também é conferida no servidor. Esconder o link é conveniência, não
  // proteção: quem digitar `/acesso` sem ser gestor recebe 403 da API e vê a
  // tela vazia com o erro.
  { href: '/acesso', rotulo: 'Acesso', papeis: ['gestor'] },
] as const

export function Navegacao({ nome, papel }: { nome: string; papel: string }) {
  const caminho = usePathname()
  const navegador = useRouter()
  const [saindo, setSaindo] = useState(false)
  const [erroAoSair, setErroAoSair] = useState<string | null>(null)

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
    <header className="border-b border-borda bg-papel">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/distribuicao" className="text-sm font-semibold tracking-tight">
          SBP <span className="font-normal text-tinta-fraca">· Atendimento</span>
        </Link>

        <nav aria-label="Principal" className="order-3 -mx-1 w-full overflow-x-auto sm:order-2 sm:w-auto">
          <ul className="flex gap-1">
            {visiveis.map((destino) => {
              const ativo = caminho.startsWith(destino.href)
              return (
                <li key={destino.href}>
                  <Link
                    href={destino.href}
                    aria-current={ativo ? 'page' : undefined}
                    className={juntar(
                      'inline-block rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors',
                      ativo
                        ? 'bg-acento-claro font-medium text-acento-escuro'
                        : 'text-tinta-suave hover:bg-papel-fundo hover:text-tinta',
                    )}
                  >
                    {destino.rotulo}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="order-2 ml-auto flex items-center gap-2 sm:order-3">
          <span className="text-right text-xs leading-tight">
            <span className="block font-medium">{nome}</span>
            <span className="block text-tinta-fraca">{papel}</span>
          </span>
          <button
            onClick={() => void sair()}
            disabled={saindo}
            className="rounded-md px-2 py-1 text-xs text-tinta-suave hover:bg-papel-fundo hover:text-tinta disabled:opacity-50"
          >
            {saindo ? 'saindo…' : 'sair'}
          </button>
        </div>
      </div>

      {erroAoSair ? (
        <div
          role="alert"
          className="border-t border-alerta/40 bg-alerta-claro px-4 py-2 text-sm text-alerta"
        >
          Não foi possível sair: {erroAoSair} <strong>Você continua conectado.</strong> Tente de novo.
        </div>
      ) : null}
    </header>
  )
}
