'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

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
import { NotasDoSetor } from '../../componentes/notas'
import { textoDoConteudoRemovido } from '../../core/retencao'
import { hojeIso } from '../../core/util/datas'
import type { CategoriaDisponivel, ItemDaCaixa, NaRede } from '../../core/tipos'


/**
 * Quantos itens a lista traz por vez.
 *
 * A Revisão já avisava quando cortava; a Caixa cortava calada. Com alguns meses
 * de uso a pastilha "todas" mostra o total de itens JÁ EXISTENTES — milhares —
 * e a lista abaixo tem 200 linhas: quem conta conclui que o sistema perdeu
 * itens, que é a desconfiança que este projeto existe para eliminar.
 */
const TETO_DA_LISTA = 200

interface Resumo {
  total: number
  porStatus: Record<string, number>
  porCategoria: { codigo: string; rotulo: string; grupo: string; total: number }[]
}

/** O contrato de `GET /api/categorias` — o mesmo que a rota e a tela de Acesso usam. */
type Categoria = CategoriaDisponivel

interface Liga {
  id: string
  nome: string
  instituicao: string | null
  uf: string | null
  itens: number
  notas: number
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
  const [dados, setDados] = useState<{ itens: NaRede<ItemDaCaixa>[]; resumo: Resumo } | null>(null)
  const [filtro, setFiltro] = useState<string | null>(null)
  /**
   * Liga escolhida, `null` para todas.
   *
   * Separado do filtro de categoria porque as duas perguntas são
   * independentes: "que tipo de trabalho é este" e "de quem veio". Somá-las num
   * filtro só obrigaria a escolher entre ver uma liga e ver uma categoria.
   */
  const [ligaEscolhida, setLigaEscolhida] = useState<string | null>(null)
  const [ligas, setLigas] = useState<Liga[]>([])
  const [erro, setErro] = useState<string | null>(null)

  const [papel, setPapel] = useState<string | null>(null)
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [equipe, setEquipe] = useState<PessoaDaEscala[]>([])
  const [registrando, setRegistrando] = useState(false)
  const [novo, setNovo] = useState<Registro>(REGISTRO_VAZIO)
  const [gravando, setGravando] = useState(false)
  const [confirmacao, setConfirmacao] = useState<string | null>(null)

  /**
   * Busca por CPF ou matrícula (`A40`, resposta 24).
   *
   * `null` = sem busca, a lista normal da Caixa. O número digitado fica só
   * neste estado e no corpo do POST: nunca vai para o endereço da página.
   */
  const [textoDaBusca, setTextoDaBusca] = useState('')
  const [resultadoDaBusca, setResultadoDaBusca] = useState<NaRede<ItemDaCaixa>[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [erroDaBusca, setErroDaBusca] = useState<string | null>(null)
  /** Mesma defesa de `ultimaCarga`: só a busca mais recente escreve na tela. */
  const ultimaBusca = useRef(0)

  /**
   * Número da carga mais recente. Só ela escreve na tela.
   *
   * Clicar na pastilha A e logo na B dispara duas buscas; se a de A chegasse
   * depois, a lista mostrava os itens de A com o filtro marcado em B — e nada
   * na tela dizia que estava errado. Revisão do PR #35.
   */
  const ultimaCarga = useRef(0)

  const carregar = useCallback(async (categoria: string | null, liga: string | null) => {
    ultimaCarga.current += 1
    const estaCarga = ultimaCarga.current
    setDados(null)
    try {
      const parametros = new URLSearchParams({ limite: String(TETO_DA_LISTA) })
      if (categoria) parametros.set('categoria', categoria)
      if (liga) parametros.set('liga', liga)
      const resposta = await api.buscar<{ itens: NaRede<ItemDaCaixa>[]; resumo: Resumo }>(
        `/itens?${parametros}`,
      )
      if (estaCarga !== ultimaCarga.current) return
      setDados(resposta)
    } catch (causa) {
      if (estaCarga !== ultimaCarga.current) return
      // Estado neutro, e não `null`: `null` é a condição que desenha
      // "Carregando…", então uma falha de rede deixava erro E carregando na
      // tela ao mesmo tempo, para sempre. Quem olha conclui "hoje está lento",
      // espera, e nunca tenta de novo.
      setDados({ itens: [], resumo: { total: 0, porStatus: {}, porCategoria: [] } })
      setErro(mensagemDoErro(causa))
    }
  }, [])

  useEffect(() => {
    void carregar(filtro, ligaEscolhida)
  }, [filtro, ligaEscolhida, carregar])

  useEffect(() => {
    // Falha aqui não derruba a caixa: sem a lista, o seletor de liga
    // simplesmente não aparece e o resto da tela segue inteiro.
    void api
      .buscar<Liga[]>('/ligas')
      .then(setLigas)
      .catch(() => setLigas([]))
  }, [])

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
      await carregar(filtro, ligaEscolhida)
    } catch (causa) {
      setErro(mensagemDoErro(causa))
    } finally {
      setGravando(false)
    }
  }

  async function buscar() {
    if (textoDaBusca.trim() === '') return
    ultimaBusca.current += 1
    const estaBusca = ultimaBusca.current
    setBuscando(true)
    setErroDaBusca(null)
    try {
      const resposta = await api.enviar<{ itens: NaRede<ItemDaCaixa>[] }>('/itens/busca', {
        texto: textoDaBusca,
      })
      if (estaBusca !== ultimaBusca.current) return
      setResultadoDaBusca(resposta.itens)
    } catch (causa) {
      if (estaBusca !== ultimaBusca.current) return
      // O resultado da busca ANTERIOR sai. Visto rodando: "Este CPF não confere"
      // aparecia em cima de "1 item com este CPF", e quem olhava entendia que o
      // item era daquele CPF errado.
      setResultadoDaBusca(null)
      // A frase vem do servidor, já em linguagem simples e sem o número.
      setErroDaBusca(mensagemDoErro(causa))
    } finally {
      if (estaBusca === ultimaBusca.current) setBuscando(false)
    }
  }

  function limparBusca() {
    ultimaBusca.current += 1
    setTextoDaBusca('')
    setResultadoDaBusca(null)
    setErroDaBusca(null)
    setBuscando(false)
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

      {/*
        No topo, para todos os cargos (`A40`, resposta 24). Enter também busca.
        `inputMode="numeric"` abre o teclado de números no celular.
      */}
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="busca-por-chave" className="sr-only">
            Buscar por CPF ou matrícula
          </label>
          <input
            id="busca-por-chave"
            value={textoDaBusca}
            onChange={(evento) => setTextoDaBusca(evento.target.value)}
            onKeyDown={(evento) => {
              if (evento.key === 'Enter') void buscar()
            }}
            inputMode="numeric"
            autoComplete="off"
            maxLength={40}
            placeholder="Buscar por CPF ou matrícula"
            className="min-h-11 min-w-0 flex-1 rounded-md border border-borda-forte bg-papel px-2.5 py-2 text-sm sm:min-h-9"
          />
          <Botao onClick={() => void buscar()} desabilitado={buscando || textoDaBusca.trim() === ''}>
            {buscando ? 'buscando…' : 'Buscar'}
          </Botao>
          {resultadoDaBusca !== null || erroDaBusca !== null ? (
            <Botao variante="secundario" onClick={limparBusca}>
              Limpar busca
            </Botao>
          ) : null}
        </div>
        {erroDaBusca ? <Aviso>{erroDaBusca}</Aviso> : null}
        {resultadoDaBusca !== null && resultadoDaBusca.length > 0 ? (
          <p className="text-xs text-tinta-suave">
            {resultadoDaBusca.length === 1
              ? '1 item com este CPF ou matrícula.'
              : `${resultadoDaBusca.length} itens com este CPF ou matrícula.`}
          </p>
        ) : null}
      </div>

      {dados !== null && dados.itens.length >= TETO_DA_LISTA ? (
        <Aviso tom="atencao">
          <strong>
            Esta tela mostra {dados.itens.length} itens; o filtro atual tem mais do que isso.
          </strong>{' '}
          Escolha uma categoria ou uma liga para ver o resto.
        </Aviso>
      ) : null}

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
                {/* A lista vem da escala, que só traz quem tem alguma categoria
                    habilitada. Pessoa nova, sem categoria, atendia no balcão e
                    não aparecia aqui — e o botão cinza sem explicação levava a
                    concluir que ela nem estava cadastrada. */}
                <span className="text-xs text-tinta-fraca">
                  Não achou a pessoa? Aparece aqui quem tem ao menos uma categoria habilitada no
                  Acesso.
                </span>
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
                    <strong>{escolhida.rotulo}</strong> fica fora da distribuição do dia: ninguém
                    recebe este item automaticamente. Por isso é preciso dizer quem atendeu. O
                    item entra na fila dessa pessoa, e é ela quem marca como concluído.
                  </>
                ) : (
                  <>
                    <strong>{escolhida.rotulo}</strong> entra na distribuição do dia: o sistema
                    escolhe quem recebe na próxima rodada, pela carga de cada um. Por isso não dá
                    para escolher a pessoa aqui.
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
          {/* Filtros de categoria e liga valem para a lista normal, não para o resultado da busca. */}
          {resultadoDaBusca === null ? (
          <>
          {/*
            A frase existe por causa do recorte de `A24`.

            Sem ela, a colaboradora abre a Caixa, lê "todas · 3" onde ontem
            lia "todas · 47", e a conclusão natural é que o sistema perdeu
            pedidos. O número mudou porque a pergunta mudou, e a tela precisa
            dizer isso — em frase curta, sem termo técnico.
          */}
          {papel === 'colaborador' ? (
            <p className="text-xs text-tinta-suave">
              Aqui estão os pedidos que estão com você. Os pedidos dos colegas ficam com quem
              coordena o setor.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setFiltro(null)}
              className={juntar(
                'min-h-11 rounded-full border px-3 py-1 text-xs font-medium transition-colors sm:min-h-8',
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
                  'min-h-11 rounded-full border px-3 py-1 text-xs font-medium transition-colors sm:min-h-8',
                  filtro === categoria.codigo
                    ? 'border-acento bg-acento-claro text-acento-escuro'
                    : 'border-borda text-tinta-suave hover:bg-papel-fundo',
                )}
              >
                {categoria.rotulo} · {categoria.total}
              </button>
            ))}
          </div>

          {/*
            Seletor, não pastilhas: categoria são oito e cabem na linha; liga
            cresce sem teto com a operação, e uma fileira de trinta pastilhas
            empurraria a caixa para fora da tela no celular.
          */}
          {ligas.length > 0 ? (
            <label className="flex flex-wrap items-center gap-2 text-xs text-tinta-suave">
              <span className="font-medium">Liga</span>
              <select
                value={ligaEscolhida ?? ''}
                onChange={(evento) => setLigaEscolhida(evento.target.value || null)}
                className="min-h-9 rounded-md border border-borda bg-papel px-2 py-1 text-xs text-tinta"
              >
                <option value="">todas as ligas</option>
                {ligas.map((liga) => (
                  <option key={liga.id} value={liga.id}>
                    {liga.nome}
                    {liga.instituicao ? ` — ${liga.instituicao}` : ''} · {liga.itens}
                    {liga.notas > 0 ? ` · ${liga.notas} nota${liga.notas === 1 ? '' : 's'}` : ''}
                  </option>
                ))}
              </select>
              {ligaEscolhida ? (
                <span>
                  A memória do setor abaixo é desta liga — e o que você anotar fica ligado a ela.
                </span>
              ) : null}
            </label>
          ) : null}
          </>
          ) : null}

          {resultadoDaBusca !== null && resultadoDaBusca.length === 0 ? (
            // Honesto sobre o limite: só tem chave o item cujo e-mail trazia o
            // CPF ou a matrícula, e que chegou depois de a busca existir.
            <Vazio
              titulo="Nenhum item com este CPF ou matrícula"
              descricao="A busca só acha itens em que o e-mail trazia o CPF ou a matrícula, e que chegaram depois que a busca passou a existir. Para os outros, procure pela data de chegada."
            />
          ) : resultadoDaBusca === null && dados.itens.length === 0 ? (
            <Vazio
              titulo="Nenhum item"
              descricao="Use “Buscar e-mails” na tela de Distribuição para trazer a caixa."
            />
          ) : (
            <ListaResponsiva
              linhas={resultadoDaBusca ?? dados.itens}
              chaveDaLinha={(item) => item.itemId}
              // O cartão do celular esconde a coluna "Item" para não repetir o
              // título — então o título do cartão tem de trazer o bloco inteiro.
              // Com só `item.titulo`, o celular perdia o remetente, a liga e o
              // aviso de texto apagado pelo prazo (N-03).
              tituloDoCartao={(item) => (
                <ResumoDoItem item={item} aoEscolherLiga={setLigaEscolhida} />
              )}
              colunas={[
                {
                  chave: 'titulo',
                  cabecalho: 'Item',
                  ocultarNoCartao: true,
                  conteudo: (item) => (
                    <ResumoDoItem item={item} aoEscolherLiga={setLigaEscolhida} />
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
                          titulo={`este e-mail virou ${item.irmaos} itens`}
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
                      <SeloDeConfianca valor={item.confianca} limiar={item.limiarConfianca} />
                    ) : (
                      <Selo titulo="registrado à mão, sem classificação automática">
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

      {/*
        A ÚNICA das quatro telas com contexto de categoria de verdade: o filtro
        já diz em que categoria a pessoa está olhando. Sem filtro, `null` — e a
        seleção devolve as notas do setor inteiro, que é a resposta certa para
        "ainda não sei de que categoria este trabalho é".
      */}
      <NotasDoSetor contexto={{ categoriaCodigo: filtro, ligaId: ligaEscolhida }} />
    </div>
  )
}

/**
 * Título, origem e liga de um item — a célula "Item" da tabela e o título do
 * cartão no celular. Um componente só, para as duas telas não divergirem.
 */
function ResumoDoItem({
  item,
  aoEscolherLiga,
}: {
  item: NaRede<ItemDaCaixa>
  aoEscolherLiga: (ligaId: string | null) => void
}) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium">{item.titulo}</p>
      {/*
        Texto apagado pelo prazo (`A20`) não é "origem manual":
        a pessoa precisa saber que o original está no Outlook, e
        quando chegou, para achá-lo lá.
      */}
      {item.conteudoRemovidoEm ? (
        <p className="text-xs font-normal text-tinta-fraca">
          {textoDoConteudoRemovido(
            new Date(item.conteudoRemovidoEm),
            item.recebidoEm ? new Date(item.recebidoEm) : null,
          )}
        </p>
      ) : (
        <p className="truncate text-xs font-normal text-tinta-fraca">
          {item.remetente ?? 'origem manual'}
        </p>
      )}
      {/*
        A liga aparece na linha porque é ela que governa o
        rateio de `LIGANTE` e `EMAIL_LIGA` desde o `A4` — e até
        aqui decidia a distribuição sem nunca ser vista por
        quem opera. Clicar filtra a caixa por ela.
      */}
      {item.ligaNome ? (
        <button
          type="button"
          onClick={() => aoEscolherLiga(item.ligaId)}
          className="mt-0.5 truncate text-xs font-normal text-acento underline decoration-dotted underline-offset-2"
          // Em botão o `title` é a descrição acessível: o leitor de tela o lê
          // ao focar, e quem usa o mouse o vê. Diferente de `title` em texto
          // sem foco, que só o mouse alcança (pendência 2, revisão do #126).
          title="Ver só esta liga — e o que o setor já aprendeu sobre ela"
        >
          {item.ligaNome}
        </button>
      ) : null}
    </div>
  )
}
