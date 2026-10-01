'use client'

import { Aviso, Botao, Cartao, Selo } from '../../componentes/matrizes'
import { EmailAoLado, type EstadoDoEmail } from './email-ao-lado'

/** Uma linha do cartão: o que a tela precisa de cada revisão do e-mail. */
export interface LinhaDoCartao {
  revisaoId: string
  titulo: string
  /** O nome que a IA leu, quando a sugestão tem `nome`. Editável. */
  nome: string | null
  tirado: boolean
  /** "falta: crm", "confiança 62%": o que o formulário avulso mostraria. */
  selos: readonly string[]
}

export interface PessoaNova {
  /** Chave estável da linha na tela; não vai ao servidor. */
  chave: number
  titulo: string
  nome: string
}

/**
 * O cartão de um e-mail na Revisão (`A69`, 1A).
 *
 * Uma lista de ligantes chegava como N cartões com o formulário inteiro, e a
 * decisão real era uma só: "estes N nomes são os que o e-mail pede?". Aqui a
 * pessoa confere a lista contra o e-mail, tira quem não é, corrige o nome,
 * acrescenta quem a IA não separou, e aprova de uma vez. Trocar categoria ou
 * mexer nos outros campos continua em "Ver um por um".
 *
 * Tudo que vem do e-mail (título, nome, remetente, assunto) entra como texto
 * do React, que escapa; nada disso vai para a região viva (`§ AT-48`) — o
 * aviso do segundo toque é montado na página, só com números.
 */
export function CartaoDoEmail({
  linhas,
  novos,
  remetente,
  assunto,
  email,
  confirmando,
  ocupado,
  aoAlternarEmail,
  aoSeparar,
  aoMudarLinha,
  aoTirar,
  aoAcrescentar,
  aoMudarNovo,
  aoRemoverNovo,
  aoAprovar,
  aoDescartar,
}: {
  linhas: readonly LinhaDoCartao[]
  novos: readonly PessoaNova[]
  remetente: string | null
  assunto: string | null
  email: EstadoDoEmail | undefined
  /** Qual dos dois botões está esperando o segundo toque. */
  confirmando: 'aprovar' | 'descartar' | null
  /** Esta decisão em voo; `bloqueado` quando outra decisão da tela está em voo. */
  ocupado: 'aprovar' | 'descartar' | 'bloqueado' | null
  aoAlternarEmail: () => void
  aoSeparar: () => void
  aoMudarLinha: (revisaoId: string, parcial: { titulo?: string; nome?: string }) => void
  aoTirar: (revisaoId: string) => void
  aoAcrescentar: () => void
  aoMudarNovo: (indice: number, parcial: Partial<Omit<PessoaNova, 'chave'>>) => void
  aoRemoverNovo: (indice: number) => void
  aoAprovar: () => void
  aoDescartar: () => void
}) {
  const originaisQueFicam = linhas.filter((linha) => !linha.tirado).length
  const ficam = originaisQueFicam + novos.length
  const parado = ocupado !== null

  return (
    <Cartao className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Selo tom="atencao">{`${linhas.length} itens do mesmo e-mail`}</Selo>
        <span className="ml-auto flex gap-2">
          <Botao variante="secundario" tamanho="pequeno" onClick={aoSeparar} desabilitado={ocupado !== null}>
            Ver um por um
          </Botao>
          <Botao
            variante="secundario"
            tamanho="pequeno"
            onClick={aoAlternarEmail}
            desabilitado={email?.fase === 'carregando'}
          >
            {email ? 'Fechar o e-mail' : 'Ver o e-mail'}
          </Botao>
        </span>
      </div>

      <div className={email ? 'mt-3 grid gap-4 lg:grid-cols-2' : ''}>
        {email ? <EmailAoLado estado={email} /> : null}
        <div className="min-w-0">
          <p className="mt-2 text-xs text-tinta-suave">
            {/* <bdi>: remetente e assunto vêm de fora, e um controle de
                direção neles desenharia o resto da linha invertido. */}
            de <bdi>{remetente ?? 'origem manual'}</bdi>
            {assunto ? (
              <>
                {' · '}
                <bdi>{assunto}</bdi>
              </>
            ) : null}
          </p>
          <p className="mt-1 text-xs text-tinta-suave">
            Confira a lista contra o e-mail. Tire quem não é, corrija o nome e acrescente quem faltou.
          </p>

          <ol className="mt-3 flex flex-col gap-2">
            {linhas.map((linha, indice) => (
              <li
                key={linha.revisaoId}
                className={`flex flex-col gap-2 rounded-md px-2.5 py-2 sm:flex-row sm:items-center ${
                  linha.tirado ? 'bg-papel-fundo opacity-60' : 'bg-papel-fundo'
                }`}
              >
                <span className="w-6 shrink-0 text-xs text-tinta-fraca">{indice + 1}.</span>
                {linha.selos.map((selo) => (
                  <Selo key={selo}>{selo}</Selo>
                ))}
                {linha.nome !== null ? (
                  <input
                    value={linha.nome}
                    disabled={linha.tirado || parado}
                    aria-label={`nome do item ${indice + 1}`}
                    onChange={(evento) => aoMudarLinha(linha.revisaoId, { nome: evento.target.value })}
                    className="min-h-9 flex-1 rounded-md border border-borda-forte bg-papel px-2 text-sm"
                  />
                ) : null}
                <input
                  value={linha.titulo}
                  disabled={linha.tirado || parado}
                  aria-label={`título do item ${indice + 1}`}
                  onChange={(evento) => aoMudarLinha(linha.revisaoId, { titulo: evento.target.value })}
                  className={`min-h-9 flex-1 rounded-md border border-borda-forte bg-papel px-2 text-sm ${
                    linha.tirado ? 'line-through' : ''
                  }`}
                />
                <Botao
                  variante={linha.tirado ? 'secundario' : 'perigo'}
                  tamanho="pequeno"
                  onClick={() => aoTirar(linha.revisaoId)}
                  desabilitado={ocupado !== null}
                >
                  {linha.tirado ? `devolver o ${indice + 1}` : `tirar o ${indice + 1}`}
                </Botao>
              </li>
            ))}
          </ol>

          <div className="mt-3 flex flex-col gap-2 rounded-md border border-dashed border-borda-forte px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-tinta-fraca">Faltou alguém que o e-mail pede?</span>
              <Botao variante="secundario" tamanho="pequeno" onClick={aoAcrescentar} desabilitado={ocupado !== null}>
                + pessoa
              </Botao>
            </div>
            {novos.map((novo, indice) => (
              <div
                key={novo.chave}
                className="flex flex-col gap-2 rounded-md bg-papel-fundo px-2.5 py-2 sm:flex-row sm:items-start"
              >
                <input
                  value={novo.nome}
                  aria-label={`nome da pessoa nova ${indice + 1}`}
                  placeholder="nome"
                  disabled={parado}
                  onChange={(evento) => aoMudarNovo(indice, { nome: evento.target.value })}
                  className="min-h-9 flex-1 rounded-md border border-borda-forte bg-papel px-2 text-sm"
                />
                <input
                  value={novo.titulo}
                  required
                  aria-label={`título da pessoa nova ${indice + 1}`}
                  placeholder="título do item (obrigatório)"
                  disabled={parado}
                  onChange={(evento) => aoMudarNovo(indice, { titulo: evento.target.value })}
                  className="min-h-9 flex-1 rounded-md border border-borda-forte bg-papel px-2 text-sm"
                />
                <Botao variante="perigo" tamanho="pequeno" onClick={() => aoRemoverNovo(indice)} desabilitado={parado}>
                  {`remover a pessoa nova ${indice + 1}`}
                </Botao>
              </div>
            ))}
          </div>

          {originaisQueFicam === 0 ? (
            <div className="mt-3">
              <Aviso tom="atencao">
                Todos os itens do e-mail foram tirados. Para recusar o e-mail inteiro, use Descartar o e-mail.
              </Aviso>
            </div>
          ) : null}

          {/* Os dois pedem dois toques: aprovar a lista também descarta quem
              foi tirado, e descartar não tem volta (mesma razão do cartão avulso). */}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Botao variante="perigo" tamanho="pequeno" onClick={aoDescartar} desabilitado={ocupado !== null}>
              {ocupado === 'descartar'
                ? 'descartando…'
                : confirmando === 'descartar'
                  ? 'Confirmar: descartar o e-mail para sempre'
                  : 'Descartar o e-mail'}
            </Botao>
            <Botao
              variante="principal"
              tamanho="pequeno"
              onClick={aoAprovar}
              // Pessoa nova vai junto com um item aprovado do e-mail: sem
              // nenhum, o servidor recusa (revisão técnica do #167).
              desabilitado={parado || originaisQueFicam === 0}
            >
              {ocupado === 'aprovar'
                ? 'salvando…'
                : confirmando === 'aprovar'
                  ? `Confirmar: aprovar os ${ficam}`
                  : `Aprovar os ${ficam}`}
            </Botao>
          </div>
        </div>
      </div>
    </Cartao>
  )
}
