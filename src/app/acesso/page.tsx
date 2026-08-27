'use client'

import { useCallback, useEffect, useState } from 'react'

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
}

/**
 * Administração de acesso — só gestor.
 *
 * O par que faltava da autenticação: sem esta tela, cadastrar senha e destravar
 * conta só existiam como chamada de API, e um gestor real não tem como usar
 * isso. Cadastro de pessoa NÃO entra aqui de propósito — enquanto não houver
 * tela de habilitação, alguém criado nasceria invisível para a distribuição, e
 * meia funcionalidade em administração de acesso é pior que nenhuma.
 */
export default function Acesso() {
  const [equipe, setEquipe] = useState<Colaborador[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  /** Senha recém-sorteada, exibida UMA vez. Nunca volta do servidor depois disto. */
  const [senhaGerada, setSenhaGerada] = useState<{ nome: string; senha: string } | null>(null)

  const carregar = useCallback(async () => {
    try {
      setEquipe(await api.buscar<Colaborador[]>('/colaboradores'))
    } catch (causa) {
      setErro(mensagemDoErro(causa))
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function agir(pessoa: Colaborador, acao: () => Promise<void>) {
    setOcupado(pessoa.id)
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
    await agir(pessoa, async () => {
      // O corpo NÃO leva senha: quem sorteia é o servidor. Pedir ao gestor que
      // invente termina em `Sbp2026!` para a equipe inteira.
      const resposta = await api.enviar<{ senhaProvisoria: string }>('/colaboradores/senha', {
        colaboradorId: pessoa.id,
      })
      setSenhaGerada({ nome: pessoa.nome, senha: resposta.senhaProvisoria })
    })
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

  return (
    <div className="flex flex-col gap-5">
      <CabecalhoDeSecao
        titulo="Acesso"
        descricao="Quem entra no sistema, em que estado, e o que fazer quando alguém não consegue entrar."
      />

      {erro ? <Aviso>{erro}</Aviso> : null}

      {senhaGerada ? (
        <Cartao className="border-atencao/40 bg-atencao-claro px-4 py-3">
          <p className="text-sm font-medium text-atencao">
            Senha provisória de {senhaGerada.nome}
          </p>
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

            return (
              <li key={pessoa.id}>
                <Cartao className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{pessoa.nome}</span>
                    <Selo>{pessoa.papel}</Selo>
                    <Selo tom={situacao.tom}>{situacao.texto}</Selo>
                  </div>

                  <p className="mt-1 text-xs text-tinta-suave">{pessoa.email}</p>

                  {travada ? (
                    <p className="mt-1 text-xs text-alerta">
                      {pessoa.tentativasFalhas} tentativas erradas. Destrava sozinha, ou libere
                      agora.
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    {travada ? (
                      <Botao
                        variante="secundario"
                        tamanho="pequeno"
                        desabilitado={ocupado !== null}
                        onClick={() =>
                          agir(pessoa, async () => {
                            await api.enviar('/colaboradores/destravar', { colaboradorId: pessoa.id })
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
                        agir(pessoa, async () => {
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
    </div>
  )
}
