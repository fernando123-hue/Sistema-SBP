'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { api, ErroDaApi, mensagemDoErro } from '../../componentes/api'
import { Marca } from '../../componentes/marca'
import { Aviso, Botao, Cartao } from '../../componentes/matrizes'

interface Entrada {
  id: string
  nome: string
  papel: string
  precisaTrocarSenha: boolean
}

interface ContaLocal {
  nome: string
  email: string
  papel: string
}

/**
 * Entrada.
 *
 * A tela NÃO lista quem tem acesso — a versão anterior listava, e junto com uma
 * entrada sem senha isso significava que qualquer um assumia qualquer
 * identidade, inclusive a de gestor. Digitar o e-mail é o preço de não publicar
 * a equipe inteira para quem alcança a página.
 *
 * A mensagem de erro é uma só, de propósito: "e-mail não existe", "senha
 * errada" e "conta travada" precisam ser indistinguíveis (a última desde o
 * C-18, `A57`).
 */
export default function Entrar() {
  const navegador = useRouter()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  // Recusa de e-mail e senha: é o único caso em que a orientação de esperar
  // aparece. Falha de rede ou de servidor não é "errou várias vezes".
  const [recusada, setRecusada] = useState(false)
  const [entrando, setEntrando] = useState(false)
  const [contasLocais, setContasLocais] = useState<ContaLocal[]>([])

  // ACESSO LOCAL SEM SENHA — só aparece quando o servidor diz que existe.
  //
  // A tela não decide nada: pergunta à rota, e a rota responde 404 sempre que o
  // acesso local está desligado, fora de desenvolvimento ou pedido de outra
  // máquina. O 404 é o caso normal e não vira aviso; qualquer outra falha vira,
  // porque esconder "a rota quebrou" atrás de "o acesso está desligado" seria
  // degradar em silêncio.
  useEffect(() => {
    let vigente = true
    api
      .buscar<ContaLocal[]>('/sessao/local')
      .then((contas) => {
        if (vigente) setContasLocais(contas)
      })
      .catch((causa: unknown) => {
        if (!vigente) return
        if (causa instanceof ErroDaApi && causa.status === 404) return
        setErro(`Acesso local indisponível: ${mensagemDoErro(causa)}`)
      })
    return () => {
      vigente = false
    }
  }, [])

  function destinoDoPapel(papel: string): string {
    return papel === 'colaborador' ? '/fila' : '/distribuicao'
  }

  async function entrarLocal(conta: ContaLocal) {
    setEntrando(true)
    setErro(null)
    try {
      const entrada = await api.enviar<{ nome: string; papel: string }>('/sessao/local', {
        email: conta.email,
      })
      navegador.push(destinoDoPapel(entrada.papel))
      navegador.refresh()
    } catch (causa) {
      setErro(mensagemDoErro(causa))
      setEntrando(false)
    }
  }

  async function entrar(evento: React.FormEvent) {
    evento.preventDefault()
    setEntrando(true)
    setErro(null)
    setRecusada(false)
    try {
      const entrada = await api.enviar<Entrada>('/sessao', { email, senha })
      // Com senha provisória, nenhuma outra tela responde — o layout devolve a
      // troca de senha de qualquer forma. Ir direto evita um piscar de tela.
      navegador.push(
        entrada.precisaTrocarSenha ? '/senha' : destinoDoPapel(entrada.papel),
      )
      navegador.refresh()
    } catch (causa) {
      setErro(mensagemDoErro(causa))
      setRecusada(causa instanceof ErroDaApi && causa.status === 422)
      setEntrando(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm py-10">
      {/*
        A marca em tamanho grande vive AQUI, e só aqui.

        É o único momento do dia em que a pessoa está parada, sem trabalho na
        tela, esperando. Nas telas de operação a marca fica pequena na barra e
        sai da frente — quem está distribuindo o dia não quer identidade visual
        ocupando espaço.

        `ocupado` durante a entrada: enquanto a senha é conferida, a marca
        respira. O `scrypt` leva um instante perceptível de propósito (ver
        `servidor/credenciais.ts`), e este é o feedback desse instante.
      */}
      <Marca altura={96} ocupado={entrando} className="mb-6 text-tinta" />
      <h1 className="text-xl font-semibold tracking-tight">Atendimento ao Associado</h1>
      <p className="mt-1 text-sm text-tinta-suave">Entre com o e-mail da associação.</p>

      {erro ? (
        <div className="mt-4">
          <Aviso>{erro}</Aviso>
          {/*
            A MESMA frase para toda recusa, conta travada ou não (C-18, `A57`,
            opção b do dono). O servidor não diz mais que a conta travou — isso
            contava a quem sonda quem tem acesso —, então a orientação de
            esperar mora aqui, fixa, sem depender da conta.
          */}
          {recusada ? (
            <p className="mt-2 text-sm text-tinta-suave">
              Errou várias vezes? Espere um minuto antes de tentar de novo.
            </p>
          ) : null}
        </div>
      ) : null}

      <Cartao className="mt-4 px-4 py-4">
        <form onSubmit={entrar} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-tinta-fraca">E-mail</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(evento) => setEmail(evento.target.value)}
              className="min-h-11 rounded-md border border-borda-forte bg-papel px-2.5 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-tinta-fraca">Senha</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={senha}
              onChange={(evento) => setSenha(evento.target.value)}
              className="min-h-11 rounded-md border border-borda-forte bg-papel px-2.5 text-sm"
            />
          </label>

          <Botao tipo="submit" variante="principal" desabilitado={entrando}>
            {entrando ? 'entrando…' : 'Entrar'}
          </Botao>
        </form>
      </Cartao>

      <p className="mt-3 text-xs text-tinta-fraca">
        Primeira vez? A senha provisória é entregue pelo gestor, e o sistema pede a troca antes de
        liberar qualquer tela.
      </p>

      {contasLocais.length > 0 ? (
        <section
          aria-labelledby="acesso-local-titulo"
          className="mt-8 rounded-md border-2 border-dashed border-atencao/60 bg-atencao-claro px-4 py-4"
        >
          <h2 id="acesso-local-titulo" className="text-sm font-semibold text-atencao">
            Acesso local sem senha — só desenvolvimento
          </h2>
          <p className="mt-1 text-xs text-tinta-suave">
            Aparece porque o acesso local está ligado neste computador. Só contas sintéticas
            ({'@exemplo.test'}), e cada entrada fica registrada. Desligue ao terminar.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {contasLocais.map((conta) => (
              <Botao
                key={conta.email}
                desabilitado={entrando}
                onClick={() => entrarLocal(conta)}
                className="justify-between"
              >
                <span>{conta.nome}</span>
                <span className="text-xs text-tinta-fraca">{conta.papel}</span>
              </Botao>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
