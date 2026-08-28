'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { api, mensagemDoErro } from '../../componentes/api'
import { Aviso, Botao, Cartao } from '../../componentes/matrizes'

const TAMANHO_MINIMO = 10

/**
 * Troca de senha.
 *
 * É a única tela que responde enquanto a senha ainda é a provisória entregue
 * pelo gestor — o layout raiz devolve esta página no lugar de qualquer outra, e
 * `exigirAtor` recusa a API. A janela em que outra pessoa conhece a senha
 * termina aqui.
 */
export default function Senha() {
  const navegador = useRouter()
  const [senhaAtual, setSenhaAtual] = useState('')
  const [senhaNova, setSenhaNova] = useState('')
  const [repetida, setRepetida] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const divergem = repetida.length > 0 && senhaNova !== repetida

  async function sair() {
    await api.remover('/sessao').catch(() => null)
    navegador.push('/entrar')
    navegador.refresh()
  }

  async function trocar(evento: React.FormEvent) {
    evento.preventDefault()
    // Conferência de digitação é decisão de tela: o servidor recebe uma senha
    // só, e não tem como saber que a pessoa se enganou ao repetir.
    if (senhaNova !== repetida) {
      setErro('A repetição não confere com a senha nova.')
      return
    }

    setSalvando(true)
    setErro(null)
    try {
      await api.enviar('/sessao/senha', { senhaAtual, senhaNova })
      navegador.push('/distribuicao')
      navegador.refresh()
    } catch (causa) {
      setErro(mensagemDoErro(causa))
      setSalvando(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="text-xl font-semibold tracking-tight">Defina sua senha</h1>
      <p className="mt-1 text-sm text-tinta-suave">
        A senha provisória serviu para o primeiro acesso. Escolha uma que só você conheça.
      </p>

      {erro ? (
        <div className="mt-4">
          <Aviso>{erro}</Aviso>
        </div>
      ) : null}

      <Cartao className="mt-4 px-4 py-4">
        <form onSubmit={trocar} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-tinta-fraca">Senha provisória</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={senhaAtual}
              onChange={(evento) => setSenhaAtual(evento.target.value)}
              className="min-h-11 rounded-md border border-borda-forte bg-papel px-2.5 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-tinta-fraca">Senha nova</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={TAMANHO_MINIMO}
              value={senhaNova}
              onChange={(evento) => setSenhaNova(evento.target.value)}
              className="min-h-11 rounded-md border border-borda-forte bg-papel px-2.5 text-sm"
            />
            <span className="text-xs text-tinta-fraca">
              Pelo menos {TAMANHO_MINIMO} caracteres. Uma frase que você lembre vale mais que
              símbolos embaralhados.
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-tinta-fraca">Repita a senha nova</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              value={repetida}
              onChange={(evento) => setRepetida(evento.target.value)}
              className="min-h-11 rounded-md border border-borda-forte bg-papel px-2.5 text-sm"
            />
            {divergem ? <span className="text-xs text-alerta">As duas não conferem.</span> : null}
          </label>

          <Botao tipo="submit" variante="principal" desabilitado={salvando || divergem}>
            {salvando ? 'salvando…' : 'Salvar senha'}
          </Botao>
        </form>
      </Cartao>

      {/*
        Saída obrigatória. Com senha provisória a barra de navegação não é
        renderizada, então esta era a única tela do sistema sem porta: quem
        entrasse na conta errada — ou recebesse a provisória de outra pessoa —
        ficava preso, sem conseguir sequer deslogar.
      */}
      <div className="mt-3 flex justify-center">
        <Botao variante="discreto" tamanho="pequeno" onClick={sair}>
          sair e entrar com outra conta
        </Botao>
      </div>
    </div>
  )
}
