import { useSyncExternalStore, type ReactNode } from 'react'

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
  ref,
  role,
  'aria-live': ariaLive,
}: {
  children: ReactNode
  className?: string
  destaque?: boolean
  /** React 19 aceita `ref` como prop comum — sem `forwardRef`. */
  ref?: React.Ref<HTMLDivElement>
  /**
   * Para o cartão que aparece SOZINHO em resposta a uma ação — a senha
   * provisória, por exemplo. Sem `role="status"`, quem usa leitor de tela não
   * fica sabendo que ele existe, e ele "aparece uma única vez".
   */
  role?: string
  'aria-live'?: 'off' | 'polite' | 'assertive'
}) {
  return (
    <div
      ref={ref}
      role={role}
      aria-live={ariaLive}
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
  // `title` num selo só aparece passando o mouse: não chega a leitor de tela
  // (pendência 2). O texto escondido leva a explicação ao leitor; o `title`
  // fica para quem usa o mouse. Quem enxerga e usa só teclado continua sem
  // ela — explicação que essa pessoa precisa vai em texto visível na tela.
  // Como o leitor lê o texto em toda linha de tabela, ele tem de ser curto e
  // em português de gente.
  return (
    <span
      title={titulo}
      className={juntar(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONS[tom],
      )}
    >
      {children}
      {titulo ? <span className="sr-only">, {titulo}</span> : null}
    </span>
  )
}

/**
 * Selo de confiança da IA.
 *
 * Nunca esconde incerteza: o número aparece sempre, e a cor diz se o item
 * passou ou não pelo limiar da categoria.
 */
/**
 * O limiar é OBRIGATÓRIO, e o default de 0,85 foi removido de propósito.
 *
 * Ele existia, ninguém passava o valor, e os dois únicos chamadores não tinham
 * como passar: nem `ItemDaCaixa` nem `ItemEmRevisao` carregavam o limiar da
 * categoria. Resultado na tela de Revisão: um item de `DOC_CADASTRO` (limiar
 * 0,95) com confiança 0,90 mostrava, na MESMA linha, o selo "confiança abaixo
 * do limiar" em amarelo e este selo em verde, com o tooltip citando 0,85 — um
 * limiar que não é o daquela categoria.
 *
 * Com o parâmetro obrigatório, o próximo chamador não repete o defeito calado.
 */
export function SeloDeConfianca({ valor, limiar }: { valor: number; limiar: number }) {
  const tom: TomDoSelo = valor >= limiar ? 'ok' : valor >= limiar - 0.2 ? 'atencao' : 'alerta'
  return (
    <Selo tom={tom} titulo={`mínimo da categoria ${(limiar * 100).toFixed(0)}%`}>
      {/*
        Para baixo: 0,949 com mínimo de 95% não pode aparecer como "95%"
        (revisão do #126). A folga de 1e-9 é o ponto flutuante: 0,29 × 100 dá
        28,999…, e sem ela a tela diria 28%.
      */}
      <span className="numerico">{Math.floor(valor * 100 + 1e-9)}%</span>
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
  // `text-sobre-acento`, não `text-white`: no tema escuro o acento clareia e o
  // branco ficava em 2,43:1 — ilegível justo no botão mais usado do sistema.
  principal: 'bg-acento text-sobre-acento hover:bg-acento-escuro border-transparent',
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
        // Alvo de toque confortável: a fila individual é usada no celular. O
        // pequeno também tem 44 px lá — com 36 px, "Concluir" e "Não é comigo"
        // lado a lado viravam um toque no botão errado (N-04).
        tamanho === 'pequeno'
          ? 'min-h-11 px-2.5 text-xs sm:min-h-9'
          : 'min-h-11 px-3.5 text-sm sm:min-h-10',
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
        : tom === 'ok'
          ? 'border-ok/40 bg-ok-claro text-ok'
          : 'border-borda bg-papel-fundo text-tinta-suave'

  // Só o alerta interrompe o leitor de tela (achado N-32). Com `alert` em todo
  // tom, cada item suspeito da Revisão era anunciado como urgente ao carregar,
  // e o neutro caía no verde de sucesso.
  return (
    <div
      role={tom === 'alerta' ? 'alert' : 'status'}
      className={juntar('rounded-md border px-3 py-2 text-sm', fundo)}
    >
      {children}
    </div>
  )
}

/**
 * O que muda na tela sem mover o foco, dito ao leitor de tela (pendência 5).
 *
 * "Concluir" vira "Confirmar: concluir" no MESMO botão, com o foco nele, e boa
 * parte dos leitores não repete um nome que mudou: quem não enxerga clicava uma
 * vez, não ouvia nada e não sabia que faltava o segundo clique.
 *
 * A região fica na página SEMPRE, vazia até haver o que dizer — leitor de tela
 * não anuncia região viva que já nasce com texto, e vazia ela não soma à rajada
 * de avisos na carga da tela (pendência 6). `polite`: espera a pessoa terminar
 * o que está ouvindo; não é alerta.
 */
export function Anuncio({ mensagem }: { mensagem: string | null }) {
  return (
    <span className="sr-only" aria-live="polite" aria-atomic="true">
      {mensagem ?? ''}
    </span>
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
  // UMA variante por vez, escolhida em execução. Antes as duas eram emitidas e o
  // CSS escondia metade: na Caixa, 200 linhas viravam ~10.000 nós de DOM, metade
  // nunca vista, e cada `coluna.conteudo(linha)` rodava duas vezes por render.
  const telaLarga = useTelaLarga()

  if (!telaLarga) {
    return <CartoesDaLista {...{ linhas, colunas, chaveDaLinha, tituloDoCartao, acoes }} />
  }

  return (
    <div className="overflow-x-auto">
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
  )
}

/** A variante de celular: um cartão por linha, com as colunas como pares rótulo–valor. */
function CartoesDaLista<T>({
  linhas,
  colunas,
  chaveDaLinha,
  tituloDoCartao,
  acoes,
}: {
  linhas: T[]
  colunas: ColunaDaLista<T>[]
  chaveDaLinha: (linha: T) => string
  tituloDoCartao?: ((linha: T) => ReactNode) | undefined
  acoes?: ((linha: T) => ReactNode) | undefined
}) {
  return (
    <ul className="flex flex-col gap-2">
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
  )
}

/** A mesma fronteira do `md:` do Tailwind (`48rem`), para a lista e o resto da tela virarem juntos. */
const CONSULTA_TELA_LARGA = '(min-width: 48rem)'

function assinarLarguraDaTela(avisar: () => void): () => void {
  const consulta = window.matchMedia(CONSULTA_TELA_LARGA)
  consulta.addEventListener('change', avisar)
  return () => consulta.removeEventListener('change', avisar)
}

/**
 * `true` em tela larga. No servidor não há tela, e `true` desenha a tabela —
 * mas as telas que usam a lista só a desenham depois que os dados chegam por
 * `useEffect`, então a hidratação nunca chega a mostrar a variante errada.
 */
function useTelaLarga(): boolean {
  return useSyncExternalStore(
    assinarLarguraDaTela,
    () => window.matchMedia(CONSULTA_TELA_LARGA).matches,
    () => true,
  )
}
