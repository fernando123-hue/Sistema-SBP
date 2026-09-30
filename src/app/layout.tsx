import type { Metadata, Viewport } from 'next'

import { Navegacao } from '../componentes/navegacao'
import { perfilAtual } from '../servidor/sessao'
import Senha from './senha/page'
import './globals.css'

export const metadata: Metadata = {
  title: 'SBP · Atendimento ao Associado',
  description: 'Distribuição de demandas da Secretaria de Atendimento ao Associado',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default async function LayoutRaiz({ children }: { children: React.ReactNode }) {
  // Uma consulta, pela camada de sessão. O layout não fala com o banco direto —
  // era o único ponto do sistema em que uma tela pulava `servicos`/`servidor`.
  const perfil = await perfilAtual()

  // Senha ainda provisória: o layout devolve a troca no lugar do conteúdo, seja
  // qual for a rota pedida. Bloquear por redirecionamento em cada página
  // dependeria de alguém lembrar de proteger cada tela nova; aqui a proteção
  // vale por construção, e a API tem a sua própria em `exigirAtor`.
  const conteudo = perfil?.precisaTrocarSenha ? <Senha /> : children

  /*
    Faixa do acesso local sem senha. Fica no layout, e não numa tela, para
    aparecer em TODAS enquanto a sessão local estiver aberta: quem olha um
    print precisa saber que aquela sessão não passou por senha. Com o menu
    lateral, ela mora na coluna do conteúdo: acima dele, empurrava o rodapé do
    menu para fora da tela.
  */
  const faixaDoAcessoLocal = perfil?.acessoLocal ? (
    <div
      role="status"
      className="border-b border-atencao/40 bg-atencao-claro px-4 py-2 text-center text-sm font-medium text-atencao"
    >
      Acesso local sem senha (desenvolvimento) — só contas sintéticas. Desligue ao terminar.
    </div>
  ) : null

  return (
    <html lang="pt-BR">
      <body className="min-h-dvh">
        {perfil && !perfil.precisaTrocarSenha ? (
          // Menu lateral e conteúdo lado a lado (`navegacao.tsx`).
          <div className="flex min-h-dvh flex-col lg:flex-row">
            <Navegacao nome={perfil.nome} papel={perfil.papel} />
            <div className="min-w-0 flex-1">
              {faixaDoAcessoLocal}
              <main className="px-4 py-6 lg:px-8 lg:py-7">
                <div className="mx-auto w-full max-w-6xl">{conteudo}</div>
              </main>
            </div>
          </div>
        ) : (
          <>
            {faixaDoAcessoLocal}
            <main className="mx-auto w-full max-w-6xl px-4 py-6">{conteudo}</main>
          </>
        )}
      </body>
    </html>
  )
}
