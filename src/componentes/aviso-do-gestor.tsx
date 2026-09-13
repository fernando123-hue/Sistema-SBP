'use client'

import type { AvisoDoGestor } from '../core/aviso-do-gestor'

/**
 * O aviso do dia, dentro do painel de ajuda — `A17`.
 *
 * Só chega aqui para gestor: o servidor recusa os outros papéis. O texto diz de
 * onde veio, porque o painel é o do assistente e quem lê poderia supor que foi
 * a leitura automática que escreveu "fulana está de atestado". Não foi.
 */

const ROTULO_DO_TIPO: Record<string, string> = {
  ferias: 'férias',
  atestado: 'atestado',
  falta: 'falta',
  licenca: 'licença',
  outro: 'outro motivo',
  ausente: 'ausente',
}

function diaCurto(iso: string): string {
  const [, mes, dia] = iso.split('-')
  return `${dia}/${mes}`
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mt-2 first:mt-0">
      <p className="text-xs font-medium tracking-wide text-tinta-fraca uppercase">{titulo}</p>
      <ul className="mt-1 flex flex-col gap-0.5">{children}</ul>
    </div>
  )
}

export function AvisoDoDia({ aviso }: { aviso: AvisoDoGestor }) {
  return (
    <section aria-label="Aviso do dia" className="mb-4 rounded-md border border-borda bg-papel-fundo px-3 py-2.5 text-sm">
      <p className="font-medium">Hoje, {diaCurto(aviso.hoje)}</p>

      {aviso.limpeza === 'falhou' ? (
        <p role="alert" className="mt-2 rounded border border-alerta/40 bg-alerta-claro px-2 py-1.5 text-xs text-alerta">
          A limpeza de dados de hoje <strong>falhou</strong>. Motivos que já deviam ter saído continuam guardados.
          Avise quem cuida do sistema.
        </p>
      ) : null}

      <div className="mt-2">
        {aviso.foraHoje.length > 0 ? (
          <Bloco titulo="Fora hoje">
            {aviso.foraHoje.map((linha) => (
              <li key={`fora-${linha.nome}`}>
                {linha.nome} — {ROTULO_DO_TIPO[linha.tipo] ?? linha.tipo}
                <span className="text-tinta-suave">
                  {linha.volta === null ? ', sem data de volta' : `, volta ${diaCurto(linha.volta)}`}
                </span>
              </li>
            ))}
          </Bloco>
        ) : null}

        {aviso.voltam.length > 0 ? (
          <Bloco titulo="Voltam">
            {aviso.voltam.map((linha) => (
              <li key={`volta-${linha.nome}`}>
                {linha.nome} <span className="text-tinta-suave">— {linha.quando === 'hoje' ? 'hoje' : 'amanhã'}</span>
              </li>
            ))}
          </Bloco>
        ) : null}

        {aviso.motivosQueSaem.length > 0 ? (
          <Bloco titulo="Motivo sai do sistema">
            {aviso.motivosQueSaem.map((linha) => (
              <li key={`motivo-${linha.nome}-${linha.dia}`}>
                {linha.nome} ({ROTULO_DO_TIPO[linha.tipo] ?? linha.tipo})
                {linha.cancelada ? (
                  <span className="ml-1 rounded border border-borda-forte px-1 text-xs font-medium">
                    ausência cancelada
                  </span>
                ) : null}
                <span className={linha.atrasado ? 'text-alerta' : 'text-tinta-suave'}>
                  {linha.atrasado ? ` — devia ter saído em ${diaCurto(linha.dia)}` : ` — em ${diaCurto(linha.dia)}`}
                </span>
              </li>
            ))}
          </Bloco>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-tinta-fraca">
        Montado pelo sistema a partir dos afastamentos, sem leitura automática. Só quem é gestor vê.
      </p>
    </section>
  )
}
