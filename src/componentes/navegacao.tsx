'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

import { api } from './api'
import { juntar } from './matrizes'

const DESTINOS = [
  { href: '/distribuicao', rotulo: 'Distribuição', papeis: ['operador', 'gestor'] },
  { href: '/revisao', rotulo: 'Revisão', papeis: ['operador', 'gestor'] },
  { href: '/caixa', rotulo: 'Caixa de entrada', papeis: ['operador', 'gestor', 'colaborador'] },
  { href: '/fila', rotulo: 'Minha fila', papeis: ['operador', 'gestor', 'colaborador'] },
  { href: '/painel', rotulo: 'Painel', papeis: ['operador', 'gestor', 'colaborador'] },
] as const

export function Navegacao({ nome, papel }: { nome: string; papel: string }) {
  const caminho = usePathname()
  const navegador = useRouter()

  const visiveis = DESTINOS.filter((destino) => destino.papeis.includes(papel as never))

  async function sair() {
    await api.remover('/sessao')
    navegador.push('/entrar')
    navegador.refresh()
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
            onClick={sair}
            className="rounded-md px-2 py-1 text-xs text-tinta-suave hover:bg-papel-fundo hover:text-tinta"
          >
            sair
          </button>
        </div>
      </div>
    </header>
  )
}
