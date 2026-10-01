'use client'

import { useEffect, useRef } from 'react'

import { Aviso } from '../../componentes/matrizes'
import { misturaAlfabetos, VEZES_CONTADAS, type EmailDaRevisao } from '../../core/trecho-do-email'
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
 * `dangerouslySetInnerHTML` aqui, e não pode haver. A formatação invisível já
 * chega trocada pelo sinal U+FFFD (`textoParaExibir`): quem revisa vê que havia
 * algo ali, e o remetente não desenha "exe.pdf" no lugar de "fdp.exe".
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
      {/* `break-words`: assunto de mil caracteres sem espaço empurrava os botões para fora do cartão. */}
      <div className="text-xs break-words text-tinta-suave">
        <p>
          de <bdi>{email.remetente}</bdi> · recebido em {quando(email.recebidoEm)}
        </p>
        <p className="font-medium text-tinta">
          <bdi>{email.assunto}</bdi>
        </p>
      </div>

      {misturaAlfabetos(email.remetente) ? (
        <Aviso tom="alerta">
          O endereço do remetente mistura letras de alfabetos diferentes, como um “о” cirílico no lugar do
          “o”. Pode ser alguém se passando por outro endereço.
        </Aviso>
      ) : null}

      {email.campo !== null ? (
        partes.marcado !== null ? (
          <p className="text-xs text-tinta-suave">
            {/* "A primeira vez", e quantas: a marca não é conferência, e um remetente pode pôr o valor
                numa citação no topo (revisão de segurança do #163). */}
            Marcado em amarelo: a primeira vez que o e-mail traz <bdi>{rotuloDoCampo(email.campo)}</bdi>.
            {email.trecho && email.trecho.vezes > 1
              ? email.trecho.vezes >= VEZES_CONTADAS
                ? ' Aparece muitas vezes no texto: confira qual é a certa.'
                : ` Aparece ${email.trecho.vezes} vezes no texto: confira qual é a certa.`
              : ''}
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
