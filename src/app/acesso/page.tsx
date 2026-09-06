'use client'

import { useCallback, useEffect, useState } from 'react'

import { CadastroDeColaboradorSchema } from '../../core/esquemas'
import { api, mensagemDoErro } from '../../componentes/api'
import {
  Aviso,
  Botao,
  CabecalhoDeSecao,
  Cartao,
  Carregando,
  Selo,
  Vazio,
} from '../../componentes/matrizes'

interface Colaborador {
  id: string
  nome: string
  papel: string
  email: string
  ativo: boolean
  precisaTrocarSenha: boolean
  senhaDefinidaEm: string | null
  bloqueadoAte: string | null
  tentativasFalhas: number
  categorias: string[]
}

interface Categoria {
  codigo: string
  rotulo: string
  grupo: string
  entraNoRateio: boolean
}

interface Cadastro {
  nome: string
  email: string
  papel: string
  categorias: string[]
}

const CADASTRO_VAZIO: Cadastro = { nome: '', email: '', papel: 'colaborador', categorias: [] }

/**
 * Administração de acesso e cadastro — só gestor.
 *
 * Cadastro de pessoa e habilitação entram JUNTOS de propósito. Quem trabalha na
 * fila e nasce sem categoria não aparece na tela de plantão nem entra no
 * rateio: some da operação sem que nada acuse. Por isso o formulário oferece as
 * categorias na hora do cadastro, e a lista marca em destaque quem ficou sem
 * nenhuma — é o estado perigoso, e ele precisa ser visível, não raro.
 */
export default function Acesso() {
  const [equipe, setEquipe] = useState<Colaborador[] | null>(null)
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  /** Senha recém-sorteada, exibida UMA vez. Nunca volta do servidor depois disto. */
  const [senhaGerada, setSenhaGerada] = useState<{ nome: string; senha: string } | null>(null)
  const [cadastrando, setCadastrando] = useState(false)
  const [novo, setNovo] = useState<Cadastro>(CADASTRO_VAZIO)
  /** Quem está com o editor de categorias aberto, e o rascunho da seleção. */
  const [editando, setEditando] = useState<{ id: string; categorias: string[] } | null>(null)

  const carregar = useCallback(async () => {
    try {
      const [pessoas, disponiveis] = await Promise.all([
        api.buscar<Colaborador[]>('/colaboradores'),
        api.buscar<Categoria[]>('/categorias'),
      ])
      setEquipe(pessoas)
      setCategorias(disponiveis)
    } catch (causa) {
      setErro(mensagemDoErro(causa))
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function agir(chave: string, acao: () => Promise<void>) {
    setOcupado(chave)
    setErro(null)
    try {
      await acao()
      await carregar()
    } catch (causa) {
      setErro(mensagemDoErro(causa))
    } finally {
      setOcupado(null)
    }
  }

  async function gerarSenha(pessoa: Colaborador) {
    await agir(pessoa.id, async () => {
      // O corpo NÃO leva senha: quem sorteia é o servidor. Pedir ao gestor que
      // invente termina em `Sbp2026!` para a equipe inteira.
      const resposta = await api.enviar<{ senhaProvisoria: string }>('/colaboradores/senha', {
        colaboradorId: pessoa.id,
      })
      setSenhaGerada({ nome: pessoa.nome, senha: resposta.senhaProvisoria })
    })
  }

  async function cadastrar() {
    // Conferido com o MESMO esquema do servidor.
    //
    // Não substitui a validação de lá — substituir seria confiar no cliente —,
    // mas evita a ida inútil e devolve a mensagem exata. E é o que de fato
    // confere o e-mail: `type="email"` num campo FORA de `<form>` não valida
    // nada, e o botão aqui é `onClick`, não `submit`. O campo parecia
    // conferido e não era.
    const conferido = CadastroDeColaboradorSchema.safeParse(novo)
    if (!conferido.success) {
      setErro(
        conferido.error.issues
          .map((problema) => `${problema.path.join('.')}: ${problema.message}`)
          .join('; '),
      )
      return
    }

    await agir('novo', async () => {
      const criado = await api.enviar<{ nome: string; senhaProvisoria: string }>(
        '/colaboradores',
        conferido.data,
      )
      // Mesma janela única da senha provisória gerada para quem já existe: o
      // valor não volta em consulta nenhuma depois disto.
      setSenhaGerada({ nome: criado.nome, senha: criado.senhaProvisoria })
      setNovo(CADASTRO_VAZIO)
      setCadastrando(false)
    })
  }

  async function salvarCategorias(pessoa: Colaborador, escolhidas: string[]) {
    await agir(pessoa.id, async () => {
      await api.enviar('/colaboradores/habilitacao', {
        colaboradorId: pessoa.id,
        categorias: escolhidas,
      })
      setEditando(null)
    })
  }

  function alternar(lista: string[], codigo: string): string[] {
    return lista.includes(codigo)
      ? lista.filter((item) => item !== codigo)
      : [...lista, codigo]
  }

  function estado(pessoa: Colaborador): { texto: string; tom: 'atencao' | 'alerta' | 'neutro' } {
    if (!pessoa.ativo) return { texto: 'acesso desligado', tom: 'neutro' }
    if (pessoa.bloqueadoAte && new Date(pessoa.bloqueadoAte) > new Date()) {
      return { texto: 'travada por tentativas', tom: 'alerta' }
    }
    if (!pessoa.senhaDefinidaEm) return { texto: 'sem senha', tom: 'atencao' }
    if (pessoa.precisaTrocarSenha) return { texto: 'senha provisória', tom: 'atencao' }
    return { texto: 'em ordem', tom: 'neutro' }
  }

  /**
   * Gestor sem categoria é normal — ele administra, não recebe rateio.
   * Colaborador sem categoria é o problema: existe, entra no sistema, e nunca
   * recebe nada.
   */
  function invisivelParaDistribuicao(pessoa: Colaborador): boolean {
    return pessoa.ativo && pessoa.papel !== 'gestor' && pessoa.categorias.length === 0
  }

  const rotuloDaCategoria = (codigo: string): string =>
    categorias.find((categoria) => categoria.codigo === codigo)?.rotulo ?? codigo

  return (
    <div className="flex flex-col gap-5">
      <CabecalhoDeSecao
        titulo="Acesso e cadastro"
        descricao="Quem entra no sistema, em que estado, o que cada um pode receber, e o que fazer quando alguém não consegue entrar."
        acao={
          <Botao
            variante={cadastrando ? 'secundario' : 'principal'}
            onClick={() => {
              setCadastrando(!cadastrando)
              setNovo(CADASTRO_VAZIO)
            }}
            desabilitado={ocupado !== null}
          >
            {cadastrando ? 'cancelar' : 'Cadastrar pessoa'}
          </Botao>
        }
      />

      {erro ? <Aviso>{erro}</Aviso> : null}

      {senhaGerada ? (
        <Cartao className="border-atencao/40 bg-atencao-claro px-4 py-3">
          <p className="text-sm font-medium text-atencao">Senha provisória de {senhaGerada.nome}</p>
          <p className="mt-2 font-mono text-lg break-all select-all">{senhaGerada.senha}</p>
          <p className="mt-2 text-xs text-atencao">
            Aparece uma única vez e não fica gravada em lugar nenhum. Entregue pessoalmente — o
            sistema exige a troca no primeiro acesso, e a partir daí nem você conhece a senha.
          </p>
          <div className="mt-3">
            <Botao variante="secundario" tamanho="pequeno" onClick={() => setSenhaGerada(null)}>
              já anotei
            </Botao>
          </div>
        </Cartao>
      ) : null}

      {cadastrando ? (
        <Cartao className="px-4 py-4">
          <p className="text-sm font-medium">Nova pessoa</p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-tinta-suave">Nome</span>
              <input
                value={novo.nome}
                onChange={(evento) => setNovo({ ...novo, nome: evento.target.value })}
                className="rounded-md border border-borda-forte bg-papel px-2.5 py-2 text-sm"
                placeholder="Nome completo"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-tinta-suave">E-mail</span>
              <input
                type="email"
                value={novo.email}
                onChange={(evento) => setNovo({ ...novo, email: evento.target.value })}
                className="rounded-md border border-borda-forte bg-papel px-2.5 py-2 text-sm"
                placeholder="pessoa@associacao.org"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-tinta-suave">Papel</span>
              <select
                value={novo.papel}
                onChange={(evento) => setNovo({ ...novo, papel: evento.target.value })}
                className="rounded-md border border-borda-forte bg-papel px-2.5 py-2 text-sm"
              >
                <option value="colaborador">colaborador</option>
                <option value="operador">operador</option>
                <option value="gestor">gestor</option>
              </select>
            </label>
          </div>

          <p className="mt-4 text-xs font-medium tracking-wide text-tinta-fraca uppercase">
            O que esta pessoa pode receber
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {categorias.map((categoria) => (
              <label
                key={categoria.codigo}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-borda-forte px-2.5 py-1.5 text-sm"
              >
                <input
                  type="checkbox"
                  checked={novo.categorias.includes(categoria.codigo)}
                  onChange={() =>
                    setNovo({ ...novo, categorias: alternar(novo.categorias, categoria.codigo) })
                  }
                  className="size-4 accent-[var(--color-acento)]"
                />
                <span>{categoria.rotulo}</span>
              </label>
            ))}
          </div>

          {novo.papel !== 'gestor' && novo.categorias.length === 0 ? (
            <div className="mt-3">
              <Aviso tom="atencao">
                Sem nenhuma categoria, esta pessoa entra no sistema e <strong>nunca recebe
                trabalho</strong> — ela nem aparece na tela de plantão. Dá para cadastrar assim e
                acertar depois, mas ninguém vai ser avisado quando isso acontecer.
              </Aviso>
            </div>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <Botao
              onClick={cadastrar}
              desabilitado={ocupado !== null || novo.nome.trim() === '' || novo.email.trim() === ''}
            >
              {ocupado === 'novo' ? 'cadastrando…' : 'Cadastrar e gerar senha'}
            </Botao>
          </div>
        </Cartao>
      ) : null}

      {equipe === null ? (
        <Carregando />
      ) : equipe.length === 0 ? (
        <Vazio titulo="Nenhum colaborador cadastrado" />
      ) : (
        <ul className="flex flex-col gap-3">
          {equipe.map((pessoa) => {
            const situacao = estado(pessoa)
            const travada = Boolean(
              pessoa.bloqueadoAte && new Date(pessoa.bloqueadoAte) > new Date(),
            )
            const editor = editando?.id === pessoa.id ? editando : null

            return (
              <li key={pessoa.id}>
                <Cartao className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{pessoa.nome}</span>
                    <Selo>{pessoa.papel}</Selo>
                    <Selo tom={situacao.tom}>{situacao.texto}</Selo>
                    {invisivelParaDistribuicao(pessoa) ? (
                      <Selo tom="alerta">sem categoria · não recebe nada</Selo>
                    ) : null}
                  </div>

                  <p className="mt-1 text-xs text-tinta-suave">{pessoa.email}</p>

                  {pessoa.categorias.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {pessoa.categorias.map((codigo) => (
                        <Selo key={codigo}>{rotuloDaCategoria(codigo)}</Selo>
                      ))}
                    </div>
                  ) : null}

                  {travada ? (
                    <p className="mt-1 text-xs text-alerta">
                      {pessoa.tentativasFalhas} tentativas erradas. Destrava sozinha, ou libere
                      agora.
                    </p>
                  ) : null}

                  {editor ? (
                    <div className="mt-3 rounded-md border border-borda-forte px-3 py-3">
                      <p className="text-xs font-medium tracking-wide text-tinta-fraca uppercase">
                        O que {pessoa.nome} pode receber
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {categorias.map((categoria) => (
                          <label
                            key={categoria.codigo}
                            className="flex cursor-pointer items-center gap-2 rounded-md border border-borda-forte px-2.5 py-1.5 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={editor.categorias.includes(categoria.codigo)}
                              onChange={() =>
                                setEditando({
                                  id: pessoa.id,
                                  categorias: alternar(editor.categorias, categoria.codigo),
                                })
                              }
                              className="size-4 accent-[var(--color-acento)]"
                            />
                            <span>{categoria.rotulo}</span>
                          </label>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-tinta-fraca">
                        Tirar uma categoria vale a partir da próxima distribuição, inclusive a de
                        hoje. Nada é apagado — o histórico de carga continua de pé.
                      </p>
                      <div className="mt-3 flex justify-end gap-2">
                        <Botao
                          variante="secundario"
                          tamanho="pequeno"
                          onClick={() => setEditando(null)}
                          desabilitado={ocupado !== null}
                        >
                          cancelar
                        </Botao>
                        <Botao
                          tamanho="pequeno"
                          onClick={() => salvarCategorias(pessoa, editor.categorias)}
                          desabilitado={ocupado !== null}
                        >
                          Salvar categorias
                        </Botao>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    {!editor ? (
                      <Botao
                        variante="secundario"
                        tamanho="pequeno"
                        desabilitado={ocupado !== null}
                        onClick={() =>
                          setEditando({ id: pessoa.id, categorias: [...pessoa.categorias] })
                        }
                      >
                        Categorias
                      </Botao>
                    ) : null}

                    {travada ? (
                      <Botao
                        variante="secundario"
                        tamanho="pequeno"
                        desabilitado={ocupado !== null}
                        onClick={() =>
                          agir(pessoa.id, async () => {
                            await api.enviar('/colaboradores/destravar', {
                              colaboradorId: pessoa.id,
                            })
                          })
                        }
                      >
                        Destravar
                      </Botao>
                    ) : null}

                    {pessoa.ativo ? (
                      <Botao
                        variante="secundario"
                        tamanho="pequeno"
                        desabilitado={ocupado !== null}
                        onClick={() => gerarSenha(pessoa)}
                      >
                        {pessoa.senhaDefinidaEm ? 'Nova senha provisória' : 'Criar senha'}
                      </Botao>
                    ) : null}

                    <Botao
                      variante={pessoa.ativo ? 'perigo' : 'principal'}
                      tamanho="pequeno"
                      desabilitado={ocupado !== null}
                      onClick={() =>
                        agir(pessoa.id, async () => {
                          await api.enviar('/colaboradores/ativacao', {
                            colaboradorId: pessoa.id,
                            ativo: !pessoa.ativo,
                          })
                        })
                      }
                    >
                      {pessoa.ativo ? 'Desligar acesso' : 'Religar acesso'}
                    </Botao>
                  </div>
                </Cartao>
              </li>
            )
          })}
        </ul>
      )}

      <p className="text-xs text-tinta-fraca">
        Desligar o acesso encerra a sessão aberta na mesma hora e não apaga nada: o histórico de
        carga da pessoa continua de pé, porque a auditoria precisa dele.
      </p>

      <Afastamentos
        equipe={equipe ?? []}
        aoMudar={carregar}
        aoFalhar={setErro}
        ocupado={ocupado !== null}
      />
    </div>
  )
}

const TIPOS: { valor: string; rotulo: string }[] = [
  { valor: 'ferias', rotulo: 'Férias' },
  { valor: 'atestado', rotulo: 'Atestado' },
  { valor: 'falta', rotulo: 'Falta' },
  { valor: 'licenca', rotulo: 'Licença' },
  { valor: 'outro', rotulo: 'Outro' },
]

interface Afastamento {
  id: string
  colaboradorId: string
  nome: string
  tipo: string
  inicio: string
  fim: string | null
  observacao: string | null
  vigente: boolean
}

function dia(iso: string): string {
  const [ano, mes, data] = iso.split('-')
  return `${data}/${mes}/${ano}`
}

/**
 * Afastamentos — férias, atestado, falta (`A10`).
 *
 * O que isto substitui: desmarcar `disponível` na escala, dia a dia. Duas
 * semanas de férias eram catorze marcações que alguém precisava lembrar de
 * fazer — e esquecer uma significa mandar trabalho para quem não está, com o
 * item aparecendo como parado só dias depois.
 *
 * A tela deixa `fim` opcional de propósito: ausência sem data de volta
 * definida é caso real (licença), e obrigar uma data faria o gestor inventar
 * uma. Quem está fora sai do rateio até alguém encerrar.
 */
function Afastamentos({
  equipe,
  aoMudar,
  aoFalhar,
  ocupado,
}: {
  equipe: Colaborador[]
  aoMudar: () => Promise<void>
  aoFalhar: (mensagem: string | null) => void
  ocupado: boolean
}) {
  const [lista, setLista] = useState<Afastamento[] | null>(null)
  const [abrindo, setAbrindo] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [novo, setNovo] = useState({ colaboradorId: '', tipo: 'ferias', inicio: '', fim: '', observacao: '' })

  const carregar = useCallback(async () => {
    try {
      setLista(await api.buscar<Afastamento[]>('/afastamentos'))
    } catch (causa) {
      aoFalhar(mensagemDoErro(causa))
    }
  }, [aoFalhar])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function registrar() {
    setSalvando(true)
    aoFalhar(null)
    try {
      await api.enviar('/afastamentos', {
        colaboradorId: novo.colaboradorId,
        tipo: novo.tipo,
        inicio: novo.inicio,
        // Campo vazio é ausência EM ABERTO, não string vazia: o servidor
        // distingue os dois, e mandar `''` viraria erro de formato de data.
        fim: novo.fim === '' ? null : novo.fim,
        observacao: novo.observacao.trim() === '' ? null : novo.observacao.trim(),
      })
      setNovo({ colaboradorId: '', tipo: 'ferias', inicio: '', fim: '', observacao: '' })
      setAbrindo(false)
      await carregar()
      await aoMudar()
    } catch (causa) {
      aoFalhar(mensagemDoErro(causa))
    } finally {
      setSalvando(false)
    }
  }

  async function cancelar(afastamento: Afastamento) {
    setSalvando(true)
    aoFalhar(null)
    try {
      await api.remover(`/afastamentos/${afastamento.id}`)
      await carregar()
      await aoMudar()
    } catch (causa) {
      aoFalhar(mensagemDoErro(causa))
    } finally {
      setSalvando(false)
    }
  }

  const podeSalvar = novo.colaboradorId !== '' && novo.inicio !== ''

  return (
    <section className="mt-2">
      <CabecalhoDeSecao
        titulo="Afastamentos"
        descricao="Quem está fora não recebe trabalho, sem ninguém precisar desmarcar a escala dia a dia. O crédito de quem está afastado fica parado — quem volta de férias não volta levando tudo."
        acao={
          <Botao
            variante={abrindo ? 'secundario' : 'principal'}
            onClick={() => setAbrindo(!abrindo)}
            desabilitado={ocupado || salvando}
          >
            {abrindo ? 'cancelar' : 'Registrar afastamento'}
          </Botao>
        }
      />

      {abrindo ? (
        <Cartao className="mb-3 px-4 py-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs">
              Pessoa
              <select
                value={novo.colaboradorId}
                onChange={(evento) => setNovo({ ...novo, colaboradorId: evento.target.value })}
                className="rounded border border-borda bg-transparent px-2 py-1.5 text-sm"
              >
                <option value="">selecione…</option>
                {equipe
                  .filter((pessoa) => pessoa.ativo)
                  .map((pessoa) => (
                    <option key={pessoa.id} value={pessoa.id}>
                      {pessoa.nome}
                    </option>
                  ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs">
              Tipo
              <select
                value={novo.tipo}
                onChange={(evento) => setNovo({ ...novo, tipo: evento.target.value })}
                className="rounded border border-borda bg-transparent px-2 py-1.5 text-sm"
              >
                {TIPOS.map((tipo) => (
                  <option key={tipo.valor} value={tipo.valor}>
                    {tipo.rotulo}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs">
              Início
              <input
                type="date"
                value={novo.inicio}
                onChange={(evento) => setNovo({ ...novo, inicio: evento.target.value })}
                className="rounded border border-borda bg-transparent px-2 py-1.5 text-sm"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs">
              Fim <span className="text-tinta-fraca">(vazio = sem data de volta)</span>
              <input
                type="date"
                value={novo.fim}
                onChange={(evento) => setNovo({ ...novo, fim: evento.target.value })}
                className="rounded border border-borda bg-transparent px-2 py-1.5 text-sm"
              />
            </label>

            {/*
              A observação é a FICHA, e só o gestor a lê. É onde cabe "motivos
              pessoais" sem que isso vire rótulo público: as outras telas
              recebem "de férias" ou "indisponível", e nunca este texto.
            */}
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">
              Observação <span className="text-tinta-fraca">(só o gestor vê)</span>
              <input
                type="text"
                value={novo.observacao}
                maxLength={500}
                placeholder="motivos pessoais, previsão de retorno…"
                onChange={(evento) => setNovo({ ...novo, observacao: evento.target.value })}
                className="rounded border border-borda bg-transparent px-2 py-1.5 text-sm"
              />
            </label>
          </div>

          <div className="mt-3 flex justify-end">
            <Botao
              variante="principal"
              tamanho="pequeno"
              onClick={registrar}
              desabilitado={!podeSalvar || salvando}
            >
              {salvando ? 'salvando…' : 'Salvar'}
            </Botao>
          </div>
        </Cartao>
      ) : null}

      {lista === null ? (
        <Carregando />
      ) : lista.length === 0 ? (
        <Vazio titulo="Ninguém afastado" descricao="Férias e atestados registrados aparecem aqui." />
      ) : (
        <ul className="flex flex-col gap-2">
          {lista.map((afastamento) => (
            <li key={afastamento.id}>
              <Cartao className="px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-sm font-medium">{afastamento.nome}</span>
                    <span className="ml-2 text-xs text-tinta-suave">
                      {TIPOS.find((tipo) => tipo.valor === afastamento.tipo)?.rotulo ??
                        afastamento.tipo}
                      {' · '}
                      {dia(afastamento.inicio)}
                      {afastamento.fim ? ` a ${dia(afastamento.fim)}` : ' — sem data de volta'}
                    </span>
                    {/*
                      A FICHA do gestor (decisão de 06/09/2026): aqui, e só
                      aqui, aparece o motivo por extenso. As outras telas
                      recebem "de férias" ou "indisponível" — redigido no
                      servidor, não escondido no componente.
                    */}
                    {afastamento.observacao ? (
                      <span className="mt-0.5 block text-xs text-tinta-fraca">
                        {afastamento.observacao}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {/*
                      "fora hoje" é o que muda a distribuição AGORA. Sem esta
                      marca, férias que ainda não começaram e férias em curso
                      ficariam visualmente iguais, e quem olha a tela para
                      entender por que alguém não recebeu não teria resposta.
                    */}
                    {afastamento.vigente ? <Selo tom="atencao">fora hoje</Selo> : null}
                    <Botao
                      tamanho="pequeno"
                      onClick={() => cancelar(afastamento)}
                      desabilitado={salvando || ocupado}
                    >
                      Cancelar
                    </Botao>
                  </div>
                </div>
              </Cartao>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs text-tinta-fraca">
        Cancelar um afastamento não apaga o registro: a trilha precisa continuar respondendo por que
        alguém ficou fora do rateio numa data passada.
      </p>
    </section>
  )
}
