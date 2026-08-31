'use client'

import { useCallback, useEffect, useState } from 'react'

import { api, mensagemDoErro } from '../../componentes/api'
import {
  Aviso,
  Botao,
  CabecalhoDeSecao,
  Carregando,
  Cartao,
  ListaResponsiva,
  Selo,
  SeloDeConfianca,
  SeloDeStatus,
  Vazio,
  juntar,
} from '../../componentes/matrizes'
import { hojeIso } from '../../core/util/datas'

interface ItemDaCaixa {
  itemId: string
  titulo: string
  categoriaCodigo: string
  categoriaRotulo: string
  grupo: string
  status: string
  confianca: number
  classificadaPorIa: boolean
  remetente: string | null
  assunto: string | null
  recebidoEm: string | null
  irmaos: number
  responsavel: string | null
}

interface Resumo {
  total: number
  porStatus: Record<string, number>
  porCategoria: { codigo: string; rotulo: string; grupo: string; total: number }[]
}

interface Categoria {
  codigo: string
  rotulo: string
  grupo: string
  entraNoRateio: boolean
}

interface PessoaDaEscala {
  colaboradorId: string
  nome: string
}

interface Registro {
  categoriaCodigo: string
  titulo: string
  quantidade: string
  colaboradorId: string
  observacao: string
}

const REGISTRO_VAZIO: Registro = {
  categoriaCodigo: '',
  titulo: '',
  quantidade: '1',
  colaboradorId: '',
  observacao: '',
}

/**
 * Caixa de entrada.
 *
 * O contraponto direto à planilha: onde havia "e-mail: 47", há os 47 itens,
 * com remetente, assunto, confiança da classificação e responsável.
 *
 * É também onde entra o que NÃO chegou por e-mail. `INADIMP.` e `ISENTO` são
 * lançadas direto na planilha e aqui não tinham como existir — a IA está
 * proibida de classificá-las e o motor as ignora.
 */
export default function Caixa() {
  const [dados, setDados] = useState<{ itens: ItemDaCaixa[]; resumo: Resumo } | null>(null)
  const [filtro, setFiltro] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const [papel, setPapel] = useState<string | null>(null)
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [equipe, setEquipe] = useState<PessoaDaEscala[]>([])
  const [registrando, setRegistrando] = useState(false)
  const [novo, setNovo] = useState<Registro>(REGISTRO_VAZIO)
  const [gravando, setGravando] = useState(false)
  const [confirmacao, setConfirmacao] = useState<string | null>(null)

  const carregar = useCallback(async (categoria: string | null) => {
    setDados(null)
    try {
      const consulta = categoria ? `?categoria=${categoria}&limite=200` : '?limite=200'
      setDados(await api.buscar<{ itens: ItemDaCaixa[]; resumo: Resumo }>(`/itens${consulta}`))
    } catch (causa) {
      setErro(mensagemDoErro(causa))
    }
  }, [])

  useEffect(() => {
    void carregar(filtro)
  }, [filtro, carregar])

  // O papel decide se o formulário de registro aparece. Esconder é
  // conveniência, não proteção: `registrarManual` confere o papel no servidor,
  // e quem enviar o POST à mão sem ser operador ou gestor recebe 403.
  useEffect(() => {
    void (async () => {
      try {
        const sessao = await api.buscar<{ colaborador: { papel: string } | null }>('/sessao')
        setPapel(sessao.colaborador?.papel ?? null)
      } catch {
        setPapel(null)
      }
    })()
  }, [])

  const podeRegistrar = papel === 'operador' || papel === 'gestor'

  // As duas listas do formulário só são buscadas quando ele abre pela primeira
  // vez: a tela é de leitura para quase todo mundo, e ninguém deve pagar duas
  // requisições por uma funcionalidade que talvez nem use.
  useEffect(() => {
    if (!registrando || categorias.length > 0) return

    void (async () => {
      try {
        const [lista, escala] = await Promise.all([
          api.buscar<Categoria[]>('/categorias'),
          // A escala do dia é a lista de pessoas ATIVAS que este papel pode
          // ler — `GET /api/colaboradores` é só do gestor, de propósito.
          // Quem não tem nenhuma habilitação não aparece aqui; habilite a
          // pessoa em alguma categoria para poder nomeá-la.
          api.buscar<PessoaDaEscala[]>(`/escala?data=${hojeIso()}`),
        ])
        setCategorias(lista)
        setEquipe(escala)
      } catch (causa) {
        setErro(mensagemDoErro(causa))
      }
    })()
  }, [registrando, categorias.length])

  const escolhida = categorias.find((categoria) => categoria.codigo === novo.categoriaCodigo)
  const exigeResponsavel = escolhida !== undefined && !escolhida.entraNoRateio

  async function registrar() {
    setGravando(true)
    setErro(null)
    setConfirmacao(null)
    try {
      const feito = await api.enviar<{ quantidade: number; responsavel: { nome: string } | null }>(
        '/itens',
        {
          categoriaCodigo: novo.categoriaCodigo,
          titulo: novo.titulo,
          quantidade: Number(novo.quantidade),
          colaboradorId: exigeResponsavel ? novo.colaboradorId : null,
          observacao: novo.observacao.trim() === '' ? null : novo.observacao,
        },
      )
      setConfirmacao(
        `${feito.quantidade} ${feito.quantidade === 1 ? 'item registrado' : 'itens registrados'}` +
          (feito.responsavel ? ` na fila de ${feito.responsavel.nome}.` : ', à espera da rodada.'),
      )
      setNovo(REGISTRO_VAZIO)
      setRegistrando(false)
      await carregar(filtro)
    } catch (causa) {
      setErro(mensagemDoErro(causa))
    } finally {
      setGravando(false)
    }
  }

  const quantidade = Number(novo.quantidade)
  const incompleto =
    novo.categoriaCodigo === '' ||
    novo.titulo.trim() === '' ||
    !Number.isInteger(quantidade) ||
    quantidade < 1 ||
    (exigeResponsavel && novo.colaboradorId === '')

  return (
    <div className="flex flex-col gap-5">
      <CabecalhoDeSecao
        titulo="Caixa de entrada"
        descricao="Cada linha é um item de trabalho real — não uma contagem."
        acao={
          podeRegistrar ? (
            <Botao
              variante={registrando ? 'secundario' : 'principal'}
              onClick={() => {
                setRegistrando(!registrando)
                setNovo(REGISTRO_VAZIO)
                setConfirmacao(null)
              }}
              desabilitado={gravando}
            >
              {registrando ? 'cancelar' : 'Registrar item'}
            </Botao>
          ) : undefined
        }
      />

      {erro ? <Aviso>{erro}</Aviso> : null}
      {confirmacao ? <Aviso tom="ok">{confirmacao}</Aviso> : null}

      {registrando ? (
        <Cartao className="px-4 py-4">
          <p className="text-sm font-medium">Item que não chegou por e-mail</p>
          <p className="mt-1 text-xs text-tinta-fraca">
            O balcão, o telefone e as categorias de exceção (<strong>Inadimplente</strong>,{' '}
            <strong>Isento</strong>) entram por aqui. Cada unidade vira um item rastreável — nunca
            um número digitado.
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-tinta-suave">Categoria</span>
              <select
                value={novo.categoriaCodigo}
                onChange={(evento) =>
                  setNovo({ ...novo, categoriaCodigo: evento.target.value, colaboradorId: '' })
                }
                className="rounded-md border border-borda-forte bg-papel px-2.5 py-2 text-sm"
              >
                <option value="">escolha…</option>
                {categorias.map((categoria) => (
                  <option key={categoria.codigo} value={categoria.codigo}>
                    {categoria.rotulo}
                    {categoria.entraNoRateio ? '' : ' (fora do rateio)'}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-tinta-suave">Descrição</span>
              <input
                value={novo.titulo}
                onChange={(evento) => setNovo({ ...novo, titulo: evento.target.value })}
                className="rounded-md border border-borda-forte bg-papel px-2.5 py-2 text-sm"
                placeholder="O que é este trabalho"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-tinta-suave">Quantidade</span>
              <input
                type="number"
                min={1}
                value={novo.quantidade}
                onChange={(evento) => setNovo({ ...novo, quantidade: evento.target.value })}
                className="numerico rounded-md border border-borda-forte bg-papel px-2.5 py-2 text-sm"
              />
            </label>

            {exigeResponsavel ? (
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-tinta-suave">Quem atendeu</span>
                <select
                  value={novo.colaboradorId}
                  onChange={(evento) => setNovo({ ...novo, colaboradorId: evento.target.value })}
                  className="rounded-md border border-borda-forte bg-papel px-2.5 py-2 text-sm"
                >
                  <option value="">escolha…</option>
                  {equipe.map((pessoa) => (
                    <option key={pessoa.colaboradorId} value={pessoa.colaboradorId}>
                      {pessoa.nome}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="text-tinta-suave">Observação (opcional)</span>
              <input
                value={novo.observacao}
                onChange={(evento) => setNovo({ ...novo, observacao: evento.target.value })}
                className="rounded-md border border-borda-forte bg-papel px-2.5 py-2 text-sm"
                placeholder="Fica no histórico do item"
              />
            </label>
          </div>

          {escolhida ? (
            <div className="mt-3">
              <Aviso tom={exigeResponsavel ? 'atencao' : 'neutro'}>
                {exigeResponsavel ? (
                  <>
                    <strong>{escolhida.rotulo}</strong> fica fora do rateio diário, então o motor
                    nunca vai atribuir este item a ninguém. Sem responsável ele nasceria pendente
                    para sempre — por isso &ldquo;quem atendeu&rdquo; é obrigatório aqui. O item
                    entra na fila dessa pessoa, e a conclusão continua sendo ato dela.
                  </>
                ) : (
                  <>
                    <strong>{escolhida.rotulo}</strong> entra no rateio: o item vai para o pool e
                    quem escolhe o responsável é o motor, na próxima rodada. Escolher a dedo aqui
                    seria a porta lateral que este sistema existe para fechar.
                  </>
                )}
              </Aviso>
            </div>
          ) : null}

          <div className="mt-4 flex justify-end">
            <Botao onClick={registrar} desabilitado={gravando || incompleto}>
              {gravando ? 'registrando…' : 'Registrar'}
            </Botao>
          </div>
        </Cartao>
      ) : null}

      {dados === null ? (
        <Carregando />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setFiltro(null)}
              className={juntar(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                filtro === null
                  ? 'border-acento bg-acento-claro text-acento-escuro'
                  : 'border-borda text-tinta-suave hover:bg-papel-fundo',
              )}
            >
              todas · {dados.resumo.total}
            </button>
            {dados.resumo.porCategoria.map((categoria) => (
              <button
                key={categoria.codigo}
                onClick={() => setFiltro(categoria.codigo)}
                className={juntar(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  filtro === categoria.codigo
                    ? 'border-acento bg-acento-claro text-acento-escuro'
                    : 'border-borda text-tinta-suave hover:bg-papel-fundo',
                )}
              >
                {categoria.rotulo} · {categoria.total}
              </button>
            ))}
          </div>

          {dados.itens.length === 0 ? (
            <Vazio
              titulo="Nenhum item"
              descricao="Use “Buscar e-mails” na tela de Distribuição para trazer a caixa."
            />
          ) : (
            <ListaResponsiva
              linhas={dados.itens}
              chaveDaLinha={(item) => item.itemId}
              tituloDoCartao={(item) => item.titulo}
              colunas={[
                {
                  chave: 'titulo',
                  cabecalho: 'Item',
                  ocultarNoCartao: true,
                  conteudo: (item) => (
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.titulo}</p>
                      <p className="truncate text-xs text-tinta-fraca">
                        {item.remetente ?? 'origem manual'}
                      </p>
                    </div>
                  ),
                },
                {
                  chave: 'categoria',
                  cabecalho: 'Categoria',
                  conteudo: (item) => (
                    <span className="flex items-center gap-1.5">
                      <Selo>{item.categoriaRotulo}</Selo>
                      {item.irmaos > 1 ? (
                        <Selo
                          tom="acento"
                          titulo={`Este e-mail gerou ${item.irmaos} itens — um e-mail pode valer N unidades de carga.`}
                        >
                          {item.irmaos}×
                        </Selo>
                      ) : null}
                    </span>
                  ),
                },
                {
                  chave: 'confianca',
                  cabecalho: 'Confiança',
                  // Item digitado por gente não tem confiança de classificação
                  // para mostrar. "100%" ali era um número excelente sobre uma
                  // decisão que nenhum modelo tomou.
                  conteudo: (item) =>
                    item.classificadaPorIa ? (
                      <SeloDeConfianca valor={item.confianca} />
                    ) : (
                      <Selo titulo="Registrado à mão: nenhum modelo classificou este item.">
                        manual
                      </Selo>
                    ),
                },
                {
                  chave: 'status',
                  cabecalho: 'Situação',
                  conteudo: (item) => <SeloDeStatus status={item.status} />,
                },
                {
                  chave: 'responsavel',
                  cabecalho: 'Responsável',
                  alinhamento: 'direita',
                  conteudo: (item) => (
                    <span className="text-sm text-tinta-suave">{item.responsavel ?? '—'}</span>
                  ),
                },
              ]}
            />
          )}
        </>
      )}
    </div>
  )
}
