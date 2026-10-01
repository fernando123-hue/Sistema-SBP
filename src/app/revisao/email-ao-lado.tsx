'use client'

import { useEffect, useRef } from 'react'

import { Aviso } from '../../componentes/matrizes'
import type { EmailDaRevisao } from '../../core/trecho-do-email'
import { partesDoCorpo, rotuloDoCampo } from './fila-na-tela'

/** O que a tela sabe do e-mail de uma revisão: pedido, chegou, ou falhou. */
export type EstadoDoEmail =
  | { readonly fase: 'carregando' }
  | { readonly fase: 'pronto'; readonly email: EmailDaRevisao }
  | { readonly fase: 'erro'; readonly mensagem: string }

const DATA = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

function quando(iso: string): string {
  const data = new Date(iso)
  return Number.isNaN(data.getTime()) ? iso : DATA.format(data)
}

/**
 * O e-mail original, ao lado do que a IA leu (`A69`, 2A).
 *
 * ═══ TEXTO, NUNCA HTML ═══
 *
 * O corpo é do remetente. Ele entra como filho de texto do React, que escapa
 * tudo: um `<script>` no e-mail aparece como as letras "<script>". Não há
 * `dangerouslySetInnerHTML` aqui, e não pode haver. Os controles de direção já
 * chegam trocados por "�" (`textoParaExibir`), para o remetente não desenhar
 * "exe.pdf" no lugar de "fdp.exe".
 */
export function EmailAoLado({ estado }: { estado: EstadoDoEmail }) {
  const caixa = useRef<HTMLDivElement>(null)
  const marca = useRef<HTMLElement>(null)

  // Leva o trecho marcado para o meio da caixa, sem rolar a página: num e-mail
  // longo, o nome duvidoso está lá embaixo, e quem revisa não o acharia.
  const pronto = estado.fase === 'pronto' ? estado.email : null
  useEffect(() => {
    const dentro = caixa.current
    const alvo = marca.current
    if (!dentro || !alvo) return
    dentro.scrollTop = Math.max(0, alvo.offsetTop - dentro.clientHeight / 2)
  }, [pronto])

  if (estado.fase === 'carregando') {
    return <p className="text-sm text-tinta-suave">Carregando o e-mail…</p>
  }
  if (estado.fase === 'erro') {
    return <Aviso>{estado.mensagem}</Aviso>
  }

  const email = estado.email
  if (email.situacao === 'sem_email') {
    return (
      <p className="rounded-md bg-papel-fundo px-3 py-2 text-sm text-tinta-suave">
        Este item foi registrado à mão: não há e-mail para mostrar.
      </p>
    )
  }
  if (email.situacao === 'expurgado') {
    return (
      <p className="rounded-md bg-papel-fundo px-3 py-2 text-sm text-tinta-suave">
        Conteúdo expurgado: a retenção apagou o texto deste e-mail em {quando(email.expurgadoEm)}. O item
        continua; confira pelos campos ao lado.
      </p>
    )
  }

  const partes = partesDoCorpo(email.corpo, email.trecho)
  return (
    <section aria-label="E-mail original" className="flex min-w-0 flex-col gap-2">
      <div className="text-xs text-tinta-suave">
        <p>
          de <bdi>{email.remetente}</bdi> · recebido em {quando(email.recebidoEm)}
        </p>
        <p className="font-medium text-tinta">
          <bdi>{email.assunto}</bdi>
        </p>
      </div>

      {email.campo !== null ? (
        partes.marcado !== null ? (
          <p className="text-xs text-tinta-suave">
            Marcado em amarelo: onde o e-mail traz <bdi>{rotuloDoCampo(email.campo)}</bdi>.
          </p>
        ) : (
          <p className="text-xs text-atencao">
            Não consegui apontar no e-mail onde está <bdi>{rotuloDoCampo(email.campo)}</bdi>. Leia o texto e
            confira.
          </p>
        )
      ) : null}

      <div
        ref={caixa}
        tabIndex={0}
        aria-label="Texto do e-mail"
        className="relative max-h-96 overflow-auto rounded-md border border-borda bg-papel-fundo px-3 py-2"
      >
        <pre className="font-sans text-sm break-words whitespace-pre-wrap text-tinta">
          {partes.antes}
          {partes.marcado !== null ? (
            <mark ref={marca} className="rounded-sm bg-atencao-claro px-0.5 text-tinta ring-1 ring-atencao">
              {partes.marcado}
            </mark>
          ) : null}
          {partes.depois}
        </pre>
      </div>
    </section>
  )
}
