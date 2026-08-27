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

  return (
    <html lang="pt-BR">
      <body className="min-h-dvh">
        {perfil && !perfil.precisaTrocarSenha ? (
          <Navegacao nome={perfil.nome} papel={perfil.papel} />
        ) : null}
        <main className="mx-auto w-full max-w-6xl px-4 py-6">{conteudo}</main>
      </body>
    </html>
  )
}
