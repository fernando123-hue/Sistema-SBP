'use client'

import { useEffect, useState } from 'react'

import { api, mensagemDoErro } from '../../componentes/api'
import {
  Aviso,
  CabecalhoDeSecao,
  Carregando,
  ListaResponsiva,
  Metrica,
  Vazio,
  juntar,
} from '../../componentes/matrizes'

interface LinhaPainel {
  categoriaCodigo: string
  rotulo: string
  grupo: string
  recebido: number
  aguardandoRevisao: number
  aprovado: number
  distribuido: number
  concluido: number
  pendente: number
}

interface LinhaPorPessoa {
  colaboradorId: string
  nome: string
  atribuidos: number
  concluidos: number
  pendentes: number
  creditoGlobal: number
}

interface Painel {
  categorias: LinhaPainel[]
  pessoas: LinhaPorPessoa[]
  conservacao: { rodadas: number; divergentes: { rodadaId: string }[] }
}

/**
 * Painel.
 *
 * NENHUM número aqui é digitável — todos são agregação de `Item.status` e
 * `Execucao`. Não existe campo de entrada nesta tela, nem rota de escrita para
 * métrica. É a diferença entre este painel e o da planilha, cujo indicador
 * anual de pendência repousa sobre a string "3,0" digitada à mão.
 */
export default function PainelPagina() {
  const [dados, setDados] = useState<Painel | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    api
      .buscar<Painel>('/painel')
      .then(setDados)
      .catch((causa) => setErro(mensagemDoErro(causa)))
  }, [])

  if (erro) return <Aviso>{erro}</Aviso>
  if (!dados) return <Carregando />

  const comDados = dados.categorias.filter((linha) => linha.recebido > 0)
  const total = comDados.reduce(
    (soma, linha) => ({
      recebido: soma.recebido + linha.recebido,
      concluido: soma.concluido + linha.concluido,
      pendente: soma.pendente + linha.pendente,
      revisao: soma.revisao + linha.aguardandoRevisao,
    }),
    { recebido: 0, concluido: 0, pendente: 0, revisao: 0 },
  )

  const conservacaoOk = dados.conservacao.divergentes.length === 0

  return (
    <div className="flex flex-col gap-6">
      <CabecalhoDeSecao
        titulo="Painel"
        descricao="Todo número desta tela é calculado. Não existe campo digitável."
      />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica rotulo="Recebido" valor={total.recebido} detalhe="itens no período" />
        <Metrica rotulo="Concluído" valor={total.concluido} tom="ok" detalhe="com carimbo" />
        <Metrica rotulo="Pendente" valor={total.pendente} detalhe="ainda em aberto" />
        <Metrica
          rotulo="Em revisão"
          valor={total.revisao}
          tom={total.revisao > 0 ? 'atencao' : 'neutro'}
          detalhe="aguardando decisão humana"
        />
      </div>

      <Aviso tom={conservacaoOk ? 'ok' : 'alerta'}>
        {conservacaoOk ? (
          <>
            <strong>Conservação íntegra</strong> em {dados.conservacao.rodadas} rodadas: a soma
            distribuída bate com a de entrada em 100% delas. A planilha falha em 29% dos dias.
          </>
        ) : (
          <>
            <strong>{dados.conservacao.divergentes.length} rodadas divergentes.</strong> Isto é
            defeito do sistema, não erro de operação — investigue pelo log antes de confiar nestes
            números.
          </>
        )}
      </Aviso>

      <section>
        <CabecalhoDeSecao titulo="Por categoria" />
        {comDados.length === 0 ? (
          <Vazio titulo="Sem movimento registrado" />
        ) : (
          <ListaResponsiva
            linhas={comDados}
            chaveDaLinha={(linha) => linha.categoriaCodigo}
            tituloDoCartao={(linha) => linha.rotulo}
            colunas={[
              {
                chave: 'rotulo',
                cabecalho: 'Categoria',
                ocultarNoCartao: true,
                conteudo: (linha) => (
                  <span>
                    <span className="font-medium">{linha.rotulo}</span>
                    <span className="ml-2 text-xs text-tinta-fraca">{linha.grupo}</span>
                  </span>
                ),
              },
              {
                chave: 'recebido',
                cabecalho: 'Recebido',
                alinhamento: 'direita',
                conteudo: (linha) => <span className="numerico">{linha.recebido}</span>,
              },
              {
                chave: 'revisao',
                cabecalho: 'Revisão',
                alinhamento: 'direita',
                conteudo: (linha) => (
                  <span className={juntar('numerico', linha.aguardandoRevisao > 0 && 'text-atencao')}>
                    {linha.aguardandoRevisao}
                  </span>
                ),
              },
              {
                chave: 'distribuido',
                cabecalho: 'Distribuído',
                alinhamento: 'direita',
                conteudo: (linha) => <span className="numerico">{linha.distribuido}</span>,
              },
              {
                chave: 'concluido',
                cabecalho: 'Concluído',
                alinhamento: 'direita',
                conteudo: (linha) => <span className="numerico text-ok">{linha.concluido}</span>,
              },
              {
                chave: 'pendente',
                cabecalho: 'Pendente',
                alinhamento: 'direita',
                conteudo: (linha) => <span className="numerico">{linha.pendente}</span>,
              },
            ]}
          />
        )}
      </section>

      <section>
        <CabecalhoDeSecao
          titulo="Por pessoa"
          descricao="Crédito próximo de zero significa carga equilibrada. É o livro-razão que a planilha não tem."
        />
        <ListaResponsiva
          linhas={dados.pessoas.filter((pessoa) => pessoa.atribuidos > 0)}
          chaveDaLinha={(pessoa) => pessoa.colaboradorId}
          tituloDoCartao={(pessoa) => pessoa.nome}
          colunas={[
            {
              chave: 'nome',
              cabecalho: 'Colaborador',
              ocultarNoCartao: true,
              conteudo: (pessoa) => <span className="font-medium">{pessoa.nome}</span>,
            },
            {
              chave: 'atribuidos',
              cabecalho: 'Atribuídos',
              alinhamento: 'direita',
              conteudo: (pessoa) => <span className="numerico">{pessoa.atribuidos}</span>,
            },
            {
              chave: 'concluidos',
              cabecalho: 'Concluídos',
              alinhamento: 'direita',
              conteudo: (pessoa) => <span className="numerico text-ok">{pessoa.concluidos}</span>,
            },
            {
              chave: 'pendentes',
              cabecalho: 'Pendentes',
              alinhamento: 'direita',
              conteudo: (pessoa) => <span className="numerico">{pessoa.pendentes}</span>,
            },
            {
              chave: 'credito',
              cabecalho: 'Crédito',
              alinhamento: 'direita',
              conteudo: (pessoa) => (
                <span
                  className={juntar(
                    'numerico',
                    Math.abs(pessoa.creditoGlobal) < 1 ? 'text-tinta-suave' : 'text-atencao',
                  )}
                  title="Positivo: recebeu menos que a cota justa e leva a próxima sobra."
                >
                  {pessoa.creditoGlobal >= 0 ? '+' : ''}
                  {pessoa.creditoGlobal.toFixed(2)}
                </span>
              ),
            },
          ]}
        />
      </section>
    </div>
  )
}
