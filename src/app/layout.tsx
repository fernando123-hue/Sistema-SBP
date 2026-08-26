import type { Metadata, Viewport } from 'next'

import { Navegacao } from '../componentes/navegacao'
import { atorAtual } from '../servidor/sessao'
import { obterPrisma } from '../servidor/prisma'
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
  const ator = await atorAtual()

  const colaborador = ator
    ? await obterPrisma().colaborador.findUnique({
        where: { id: ator.colaboradorId },
        select: { nome: true, papel: true },
      })
    : null

  return (
    <html lang="pt-BR">
      <body className="min-h-dvh">
        {colaborador ? <Navegacao nome={colaborador.nome} papel={colaborador.papel} /> : null}
        <main className="mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  )
}
