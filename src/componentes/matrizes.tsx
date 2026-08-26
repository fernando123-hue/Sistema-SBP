import type { ReactNode } from 'react'

/**
 * Matrizes do design system.
 *
 * Cada componente reutilizável é definido UMA vez, com variantes. As telas
 * compõem instâncias — se apareceu marcação duplicada em duas telas, faltou
 * uma matriz aqui.
 */

export function juntar(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

// ─── Cartão ──────────────────────────────────────────────────

export function Cartao({
  children,
  className,
  destaque,
}: {
  children: ReactNode
  className?: string
  destaque?: boolean
}) {
  return (
    <div
      className={juntar(
        'rounded-[var(--radius-cartao)] border bg-papel',
        destaque ? 'border-acento shadow-sm' : 'border-borda',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function CabecalhoDeSecao({
  titulo,
  descricao,
  acao,
}: {
  titulo: string
  descricao?: string
  acao?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{titulo}</h2>
        {descricao ? <p className="mt-0.5 text-sm text-tinta-suave">{descricao}</p> : null}
      </div>
      {acao}
    </div>
  )
}

// ─── Selo ────────────────────────────────────────────────────

export type TomDoSelo = 'neutro' | 'ok' | 'atencao' | 'alerta' | 'acento'

const TONS: Record<TomDoSelo, string> = {
  neutro: 'bg-papel-fundo text-tinta-suave border-borda',
  ok: 'bg-ok-claro text-ok border-ok/30',
  atencao: 'bg-atencao-claro text-atencao border-atencao/30',
  alerta: 'bg-alerta-claro text-alerta border-alerta/30',
  acento: 'bg-acento-claro text-acento-escuro border-acento/30',
}

export function Selo({
  children,
  tom = 'neutro',
  titulo,
}: {
  children: ReactNode
  tom?: TomDoSelo
  titulo?: string | undefined
}) {
  return (
    <span
      title={titulo}
      className={juntar(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONS[tom],
      )}
    >
      {children}
    </span>
  )
}

/**
 * Selo de confiança da IA.
 *
 * Nunca esconde incerteza: o número aparece sempre, e a cor diz se o item
 * passou ou não pelo limiar da categoria.
 */
export function SeloDeConfianca({ valor, limiar = 0.85 }: { valor: number; limiar?: number }) {
  const tom: TomDoSelo = valor >= limiar ? 'ok' : valor >= limiar - 0.2 ? 'atencao' : 'alerta'
  return (
    <Selo tom={tom} titulo={`Confiança da classificação automática (limiar ${limiar})`}>
      <span className="numerico">{(valor * 100).toFixed(0)}%</span>
    </Selo>
  )
}

const ROTULO_DE_STATUS: Record<string, { texto: string; tom: TomDoSelo }> = {
  novo: { texto: 'novo', tom: 'neutro' },
  aguardando_revisao: { texto: 'em revisão', tom: 'atencao' },
  aprovado: { texto: 'aprovado', tom: 'acento' },
  distribuido: { texto: 'distribuído', tom: 'acento' },
  em_andamento: { texto: 'em andamento', tom: 'acento' },
  concluido: { texto: 'concluído', tom: 'ok' },
  devolvido: { texto: 'devolvido', tom: 'atencao' },
  cancelado: { texto: 'cancelado', tom: 'neutro' },
}

export function SeloDeStatus({ status }: { status: string }) {
  const info = ROTULO_DE_STATUS[status] ?? { texto: status, tom: 'neutro' as TomDoSelo }
  return <Selo tom={info.tom}>{info.texto}</Selo>
}

// ─── Botão ───────────────────────────────────────────────────

type VarianteDoBotao = 'principal' | 'secundario' | 'discreto' | 'perigo'

const VARIANTES: Record<VarianteDoBotao, string> = {
  principal: 'bg-acento text-white hover:bg-acento-escuro border-transparent',
  secundario: 'bg-papel text-tinta hover:bg-papel-fundo border-borda-forte',
  discreto: 'bg-transparent text-tinta-suave hover:text-tinta hover:bg-papel-fundo border-transparent',
  perigo: 'bg-papel text-alerta hover:bg-alerta-claro border-alerta/40',
}

export function Botao({
  children,
  onClick,
  variante = 'secundario',
  desabilitado,
  tipo = 'button',
  className,
  tamanho = 'normal',
}: {
  children: ReactNode
  onClick?: () => void
  variante?: VarianteDoBotao
  desabilitado?: boolean
  tipo?: 'button' | 'submit'
  className?: string
  tamanho?: 'normal' | 'pequeno'
}) {
  return (
    <button
      type={tipo}
      onClick={onClick}
      disabled={desabilitado}
      className={juntar(
        'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors',
        // Alvo de toque confortável: a fila individual é usada no celular.
        tamanho === 'pequeno' ? 'min-h-9 px-2.5 text-xs' : 'min-h-11 px-3.5 text-sm sm:min-h-10',
        VARIANTES[variante],
        desabilitado && 'cursor-not-allowed opacity-45',
        className,
      )}
    >
      {children}
    </button>
  )
}

// ─── Estados ─────────────────────────────────────────────────

export function Vazio({ titulo, descricao }: { titulo: string; descricao?: string }) {
  return (
    <div className="rounded-[var(--radius-cartao)] border border-dashed border-borda-forte px-6 py-12 text-center">
      <p className="font-medium">{titulo}</p>
      {descricao ? <p className="mt-1 text-sm text-tinta-suave">{descricao}</p> : null}
    </div>
  )
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <div className="px-6 py-12 text-center text-sm text-tinta-suave" role="status" aria-live="polite">
      {texto}
    </div>
  )
}

export function Aviso({ children, tom = 'alerta' }: { children: ReactNode; tom?: TomDoSelo }) {
  const fundo =
    tom === 'alerta'
      ? 'border-alerta/40 bg-alerta-claro text-alerta'
      : tom === 'atencao'
        ? 'border-atencao/40 bg-atencao-claro text-atencao'
        : 'border-ok/40 bg-ok-claro text-ok'

  return (
    <div role="alert" className={juntar('rounded-md border px-3 py-2 text-sm', fundo)}>
      {children}
    </div>
  )
}

// ─── Métrica (somente leitura por construção) ────────────────

/**
 * Métrica do painel.
 *
 * É um `<p>`, nunca um `<input>`. Não existe variante editável, e não existe
 * rota de escrita para métrica. É assim que o invariante "nenhum número de
 * painel é digitável" deixa de depender de boa intenção.
 */
export function Metrica({
  rotulo,
  valor,
  detalhe,
  tom = 'neutro',
}: {
  rotulo: string
  valor: string | number
  detalhe?: string
  tom?: TomDoSelo
}) {
  const cor =
    tom === 'ok' ? 'text-ok' : tom === 'alerta' ? 'text-alerta' : tom === 'atencao' ? 'text-atencao' : 'text-tinta'

  return (
    <Cartao className="px-4 py-3">
      <p className="text-xs font-medium tracking-wide text-tinta-fraca uppercase">{rotulo}</p>
      <p className={juntar('numerico mt-1 text-2xl font-semibold', cor)}>{valor}</p>
      {detalhe ? <p className="mt-0.5 text-xs text-tinta-suave">{detalhe}</p> : null}
    </Cartao>
  )
}

// ─── Lista responsiva ────────────────────────────────────────

export interface ColunaDaLista<T> {
  chave: string
  cabecalho: string
  /** Conteúdo na tabela (desktop). */
  conteudo: (linha: T) => ReactNode
  alinhamento?: 'esquerda' | 'direita'
  /** Esconde a coluna no cartão (mobile) quando ela é ruído. */
  ocultarNoCartao?: boolean
}

/**
 * Tabela no desktop, cartões no celular.
 *
 * Tabela em tela pequena força rolagem horizontal e some com o dado. A regra
 * do projeto é cartão no mobile — e ela vale especialmente aqui, porque a
 * *Minha Fila* será consultada no celular.
 */
export function ListaResponsiva<T>({
  linhas,
  colunas,
  chaveDaLinha,
  tituloDoCartao,
  acoes,
}: {
  linhas: T[]
  colunas: ColunaDaLista<T>[]
  chaveDaLinha: (linha: T) => string
  tituloDoCartao?: (linha: T) => ReactNode
  acoes?: (linha: T) => ReactNode
}) {
  return (
    <>
      {/* Desktop */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-borda-forte text-left">
              {colunas.map((coluna) => (
                <th
                  key={coluna.chave}
                  scope="col"
                  className={juntar(
                    'px-3 py-2 text-xs font-semibold tracking-wide text-tinta-fraca uppercase',
                    coluna.alinhamento === 'direita' && 'text-right',
                  )}
                >
                  {coluna.cabecalho}
                </th>
              ))}
              {acoes ? <th className="px-3 py-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => (
              <tr key={chaveDaLinha(linha)} className="border-b border-borda last:border-0">
                {colunas.map((coluna) => (
                  <td
                    key={coluna.chave}
                    className={juntar(
                      'px-3 py-2.5 align-middle',
                      coluna.alinhamento === 'direita' && 'text-right',
                    )}
                  >
                    {coluna.conteudo(linha)}
                  </td>
                ))}
                {acoes ? <td className="px-3 py-2.5 text-right">{acoes(linha)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <ul className="flex flex-col gap-2 md:hidden">
        {linhas.map((linha) => (
          <li key={chaveDaLinha(linha)}>
            <Cartao className="px-3 py-3">
              {tituloDoCartao ? (
                <div className="mb-2 text-sm font-medium">{tituloDoCartao(linha)}</div>
              ) : null}
              <dl className="flex flex-col gap-1">
                {colunas
                  .filter((coluna) => !coluna.ocultarNoCartao)
                  .map((coluna) => (
                    <div key={coluna.chave} className="flex items-center justify-between gap-3">
                      <dt className="text-xs text-tinta-fraca">{coluna.cabecalho}</dt>
                      <dd className="text-right text-sm">{coluna.conteudo(linha)}</dd>
                    </div>
                  ))}
              </dl>
              {acoes ? <div className="mt-3 flex justify-end gap-2">{acoes(linha)}</div> : null}
            </Cartao>
          </li>
        ))}
      </ul>
    </>
  )
}
