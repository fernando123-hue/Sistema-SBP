'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { api, mensagemDoErro } from '../../componentes/api'
import { Aviso, Botao, Cartao } from '../../componentes/matrizes'

interface Entrada {
  id: string
  nome: string
  papel: string
  precisaTrocarSenha: boolean
}

/**
 * Entrada.
 *
 * A tela NÃO lista quem tem acesso — a versão anterior listava, e junto com uma
 * entrada sem senha isso significava que qualquer um assumia qualquer
 * identidade, inclusive a de gestor. Digitar o e-mail é o preço de não publicar
 * a equipe inteira para quem alcança a página.
 *
 * A mensagem de erro é uma só, de propósito: "e-mail não existe" e "senha
 * errada" precisam ser indistinguíveis.
 */
export default function Entrar() {
  const navegador = useRouter()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [entrando, setEntrando] = useState(false)

  async function entrar(evento: React.FormEvent) {
    evento.preventDefault()
    setEntrando(true)
    setErro(null)
    try {
      const entrada = await api.enviar<Entrada>('/sessao', { email, senha })
      // Com senha provisória, nenhuma outra tela responde — o layout devolve a
      // troca de senha de qualquer forma. Ir direto evita um piscar de tela.
      navegador.push(
        entrada.precisaTrocarSenha
          ? '/senha'
          : entrada.papel === 'colaborador'
            ? '/fila'
            : '/distribuicao',
      )
      navegador.refresh()
    } catch (causa) {
      setErro(mensagemDoErro(causa))
      setEntrando(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="text-xl font-semibold tracking-tight">Atendimento ao Associado</h1>
      <p className="mt-1 text-sm text-tinta-suave">Entre com o e-mail da associação.</p>

      {erro ? (
        <div className="mt-4">
          <Aviso>{erro}</Aviso>
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
    </div>
  )
}
