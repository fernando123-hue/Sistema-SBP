'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { api, mensagemDoErro } from '../../componentes/api'
import { Aviso, Botao, Cartao, Carregando } from '../../componentes/matrizes'

interface Colaborador {
  id: string
  nome: string
  papel: string
}

/**
 * Entrada provisória.
 *
 * NÃO é autenticação — ver DECISOES.md § AT-08. Escolhe-se quem se é, sem
 * senha. O que já é definitivo: a identidade escolhida vira um cookie assinado
 * pelo servidor, e é dele que sai o autor de toda ação e de todo registro de
 * auditoria. O corpo da requisição nunca diz quem você é.
 */
export default function Entrar() {
  const navegador = useRouter()
  const [colaboradores, setColaboradores] = useState<Colaborador[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [entrando, setEntrando] = useState<string | null>(null)

  useEffect(() => {
    api
      .buscar<Colaborador[]>('/colaboradores')
      .then(setColaboradores)
      .catch((causa) => setErro(mensagemDoErro(causa)))
  }, [])

  async function entrar(colaborador: Colaborador) {
    setEntrando(colaborador.id)
    setErro(null)
    try {
      await api.enviar('/sessao', { colaboradorId: colaborador.id })
      navegador.push(colaborador.papel === 'colaborador' ? '/fila' : '/distribuicao')
      navegador.refresh()
    } catch (causa) {
      setErro(mensagemDoErro(causa))
      setEntrando(null)
    }
  }

  return (
    <div className="mx-auto max-w-md py-8">
      <h1 className="text-xl font-semibold tracking-tight">Atendimento ao Associado</h1>
      <p className="mt-1 text-sm text-tinta-suave">Escolha quem está operando.</p>

      <div className="mt-4 rounded-md border border-atencao/40 bg-atencao-claro px-3 py-2 text-xs text-atencao">
        Entrada provisória, sem senha. A autenticação real entra antes de qualquer dado de
        associado ser carregado no sistema.
      </div>

      {erro ? (
        <div className="mt-4">
          <Aviso>{erro}</Aviso>
        </div>
      ) : null}

      <div className="mt-4">
        {colaboradores === null ? (
          <Carregando />
        ) : colaboradores.length === 0 ? (
          <Aviso tom="atencao">
            Nenhum colaborador cadastrado. Rode <code>npm run db:seed</code>.
          </Aviso>
        ) : (
          <ul className="flex flex-col gap-2">
            {colaboradores.map((colaborador) => (
              <li key={colaborador.id}>
                <Cartao className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span>
                    <span className="block text-sm font-medium">{colaborador.nome}</span>
                    <span className="block text-xs text-tinta-fraca">{colaborador.papel}</span>
                  </span>
                  <Botao
                    variante="principal"
                    tamanho="pequeno"
                    onClick={() => entrar(colaborador)}
                    desabilitado={entrando !== null}
                  >
                    {entrando === colaborador.id ? 'entrando…' : 'entrar'}
                  </Botao>
                </Cartao>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
