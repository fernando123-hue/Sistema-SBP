'use client'

import type { AvisoParaATela, ListaDoAviso, MudancaNoAviso } from '../core/aviso-do-gestor'

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

const TITULO_DA_LISTA: Readonly<Record<Exclude<ListaDoAviso, 'limpeza'>, string>> = {
  fora: 'Fora hoje',
  volta: 'Voltam',
  sai: 'Motivo sai do sistema',
}

function diaCurto(iso: string): string {
  const [, mes, dia] = iso.split('-')
  return `${dia}/${mes}`
}

/** A mudança em palavras simples — pedido do dono para os textos desta tela. */
function frase(sentido: 'entrou' | 'saiu', mudanca: MudancaNoAviso): string {
  if (mudanca.lista === 'limpeza') {
    return sentido === 'entrou' ? 'A limpeza de dados de hoje falhou' : 'A limpeza de dados de hoje voltou a funcionar'
  }
  const titulo = TITULO_DA_LISTA[mudanca.lista]
  return sentido === 'entrou' ? `${mudanca.nome} entrou em "${titulo}"` : `${mudanca.nome} saiu de "${titulo}"`
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mt-2 first:mt-0">
      <p className="text-xs font-medium tracking-wide text-tinta-fraca uppercase">{titulo}</p>
      <ul className="mt-1 flex flex-col gap-0.5">{children}</ul>
    </div>
  )
}

export function AvisoDoDia({ aviso }: { aviso: AvisoParaATela }) {
  const { entraram, sairam } = aviso.novidades
  const mudou = entraram.length > 0 || sairam.length > 0

  return (
    <section aria-label="Aviso do dia" className="mb-4 rounded-md border border-borda bg-papel-fundo px-3 py-2.5 text-sm">
      <p className="font-medium">Hoje, {diaCurto(aviso.hoje)}</p>

      {mudou ? (
        <div className="mt-2 rounded border border-atencao/40 bg-atencao-claro px-2 py-1.5 text-xs text-atencao">
          <p className="font-medium">Mudou desde a última vez que você olhou</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {entraram.map((mudanca, indice) => (
              <li key={`entrou-${mudanca.lista}-${mudanca.nome}-${indice}`}>{frase('entrou', mudanca)}</li>
            ))}
            {sairam.map((mudanca, indice) => (
              <li key={`saiu-${mudanca.lista}-${mudanca.nome}-${indice}`}>{frase('saiu', mudanca)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {aviso.limpeza === 'falhou' ? (
        <p role="alert" className="mt-2 rounded border border-alerta/40 bg-alerta-claro px-2 py-1.5 text-xs text-alerta">
          A limpeza de dados de hoje <strong>falhou</strong>. Motivos que já deviam ter saído continuam guardados.
          Avise quem cuida do sistema.
        </p>
      ) : null}

      <div className="mt-2">
        {aviso.foraHoje.length > 0 ? (
          <Bloco titulo="Fora hoje">
            {aviso.foraHoje.map((linha, indice) => (
              <li key={`fora-${linha.nome}-${indice}`}>
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
            {aviso.voltam.map((linha, indice) => (
              <li key={`volta-${linha.nome}-${indice}`}>
                {linha.nome} <span className="text-tinta-suave">— {linha.quando === 'hoje' ? 'hoje' : 'amanhã'}</span>
              </li>
            ))}
          </Bloco>
        ) : null}

        {aviso.motivosQueSaem.length > 0 ? (
          <Bloco titulo="Motivo sai do sistema">
            {aviso.motivosQueSaem.map((linha, indice) => (
              <li key={`motivo-${linha.nome}-${linha.dia}-${indice}`}>
                {linha.nome} ({ROTULO_DO_TIPO[linha.tipo] ?? linha.tipo})
                {linha.cancelada ? (
                  // Mesmas palavras do botão que cancela na tela de Acesso: quem
                  // clicou "Não aconteceu" reconhece aqui o que fez.
                  <span className="ml-1 rounded border border-borda-forte px-1 text-xs font-medium">
                    não aconteceu
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
