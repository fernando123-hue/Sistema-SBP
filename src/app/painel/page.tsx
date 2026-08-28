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
  saldoInicial: number
  entrouNoPeriodo: number
  aberto: number
  concluidoNoPeriodo: number
  canceladoNoPeriodo: number
  pendente: number
  aguardandoRevisao: number
  aprovado: number
  distribuido: number
  emAndamento: number
}

interface LinhaPorPessoa {
  colaboradorId: string
  nome: string
  atribuidos: number
  concluidos: number
  pendentes: number
  creditoGlobal: number
}

interface Periodo {
  de: string
  ate: string
}

interface Painel {
  periodo: Periodo
  categorias: LinhaPainel[]
  pessoas: LinhaPorPessoa[]
  conservacao: { rodadas: number; divergentes: { rodadaId: string }[] }
}

interface LinhaDeAcerto {
  categoriaCodigo: string
  revisadas: number
  aceitasSemCorrecao: number
  taxaDeAceitacao: number | null
}

interface Qualidade {
  desde: string | null
  taxa: {
    revisadas: number
    aceitasSemCorrecao: number
    taxaDeAceitacao: number | null
    porDesfecho: Record<string, number>
    porCategoriaSugerida: LinhaDeAcerto[]
    confiancaMediaAceita: number | null
    confiancaMediaCorrigida: number | null
  }
  cobertura: {
    itensDeIa: number
    revisados: number
    naoRevisados: number
    fracaoRevisada: number | null
  }
  ignoradas: number
}

/** Meta do critério de aceitação nº 5. */
const META_DE_ACEITACAO = 0.8

const ROTULO_DO_DESFECHO: Record<string, string> = {
  aceita_sem_correcao: 'aceitas sem correção',
  recusada: 'recusadas',
  categoria_trocada: 'categoria trocada',
  itens_acrescentados: 'itens acrescentados',
  titulo_editado: 'título editado',
  campos_corrigidos: 'campos corrigidos',
}

/** `null` vira travessão, nunca `0%` — "ainda não sei" não é "errou tudo". */
function percentual(fracao: number | null): string {
  return fracao === null ? '—' : `${Math.round(fracao * 100)}%`
}

/**
 * Qual período a medida cobre.
 *
 * Sem isto, "48%" é um número sem contexto — e a primeira pergunta de quem
 * olha ("48% de quando?") não teria resposta na tela.
 */
function periodo(desde: string | null): string {
  if (desde === null) return 'Desde o início'
  const [ano, mes, dia] = desde.split('-')
  return `Desde ${dia}/${mes}/${ano}`
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
  const [qualidade, setQualidade] = useState<Qualidade | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  /** Vazio = deixa o servidor escolher o mês corrente, a unidade da planilha. */
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')

  useEffect(() => {
    const recorte = de && ate ? `?de=${de}&ate=${ate}` : ''
    Promise.all([
      api.buscar<Painel>(`/painel${recorte}`),
      // Janela padrão, NUNCA `dias=tudo`. Esta é a tela mais visitada do
      // sistema; pedir a série inteira faria a consulta crescer com o tempo de
      // vida da instalação. `conferirConservacao` já documenta a mesma regra —
      // nenhuma tela lê a tabela desde a fundação para se desenhar.
      api.buscar<Qualidade>('/qualidade'),
    ])
      .then(([painel, medida]) => {
        setDados(painel)
        setQualidade(medida)
      })
      .catch((causa) => setErro(mensagemDoErro(causa)))
  }, [de, ate])

  if (erro) return <Aviso>{erro}</Aviso>
  if (!dados) return <Carregando />

  const comDados = dados.categorias.filter((linha) => linha.aberto > 0)
  const total = comDados.reduce(
    (soma, linha) => ({
      aberto: soma.aberto + linha.aberto,
      entrou: soma.entrou + linha.entrouNoPeriodo,
      concluido: soma.concluido + linha.concluidoNoPeriodo,
      pendente: soma.pendente + linha.pendente,
      revisao: soma.revisao + linha.aguardandoRevisao,
    }),
    { aberto: 0, entrou: 0, concluido: 0, pendente: 0, revisao: 0 },
  )

  const conservacaoOk = dados.conservacao.divergentes.length === 0

  return (
    <div className="flex flex-col gap-6">
      <CabecalhoDeSecao
        titulo="Painel"
        descricao="Todo número desta tela é calculado. Não existe campo digitável."
        acao={
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-tinta-suave">Período</span>
            <input
              type="date"
              value={de || dados.periodo.de}
              onChange={(evento) => {
                setDe(evento.target.value)
                if (!ate) setAte(dados.periodo.ate)
              }}
              className="numerico rounded-md border border-borda-forte bg-papel px-2.5 py-2 text-sm"
            />
            <span className="text-tinta-fraca">até</span>
            <input
              type="date"
              value={ate || dados.periodo.ate}
              onChange={(evento) => {
                setAte(evento.target.value)
                if (!de) setDe(dados.periodo.de)
              }}
              className="numerico rounded-md border border-borda-forte bg-papel px-2.5 py-2 text-sm"
            />
          </div>
        }
      />

      {/*
        Os rótulos citam a coluna equivalente da planilha de propósito: na
        rodada de comparação, alguém vai pôr as duas lado a lado, e sem esse
        mapeamento a conferência vira discussão sobre o que cada palavra
        significa.
      */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica rotulo="Aberto" valor={total.aberto} detalhe="saldo + entrou no período" />
        <Metrica
          rotulo="Concluído"
          valor={total.concluido}
          tom="ok"
          detalhe="fechado dentro do período"
        />
        <Metrica rotulo="Pendente" valor={total.pendente} detalhe="aberto no fim do período" />
        <Metrica
          rotulo="Em revisão"
          valor={total.revisao}
          tom={total.revisao > 0 ? 'atencao' : 'neutro'}
          detalhe="aguardando decisão humana · estado atual"
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
                chave: 'saldo',
                cabecalho: 'Saldo',
                alinhamento: 'direita',
                conteudo: (linha) => <span className="numerico">{linha.saldoInicial}</span>,
              },
              {
                chave: 'entrou',
                cabecalho: 'Entrou',
                alinhamento: 'direita',
                conteudo: (linha) => <span className="numerico">{linha.entrouNoPeriodo}</span>,
              },
              {
                chave: 'aberto',
                cabecalho: 'Aberto',
                alinhamento: 'direita',
                conteudo: (linha) => (
                  <span className="numerico font-medium">{linha.aberto}</span>
                ),
              },
              {
                chave: 'concluido',
                cabecalho: 'Concluído',
                alinhamento: 'direita',
                conteudo: (linha) => (
                  <span className="numerico text-ok">{linha.concluidoNoPeriodo}</span>
                ),
              },
              {
                chave: 'pendente',
                cabecalho: 'Pendente',
                alinhamento: 'direita',
                conteudo: (linha) => <span className="numerico">{linha.pendente}</span>,
              },
              {
                chave: 'revisao',
                // "(hoje)" no cabeçalho porque esta coluna NÃO é do período: é
                // estado atual, ao lado de cinco colunas que são recortadas.
                // Sem o rótulo, quem consulta julho leria como "fila de revisão de
                // julho" — misturar dois universos na mesma tabela sem dizer é a
                // forma mais barata de produzir um número plausível e falso.
                cabecalho: 'Revisão (hoje)',
                alinhamento: 'direita',
                conteudo: (linha) => (
                  <span className={juntar('numerico', linha.aguardandoRevisao > 0 && 'text-atencao')}>
                    {linha.aguardandoRevisao}
                  </span>
                ),
              },
            ]}
          />
        )}
        <p className="mt-3 text-xs text-tinta-fraca">
          <strong>Saldo</strong> atravessou a virada do período · <strong>Entrou</strong> chegou
          dentro dele · <strong>Aberto</strong> = saldo + entrou · <strong>Concluído</strong>{' '}
          fechou dentro do período · <strong>Pendente</strong> = aberto − concluído − cancelado.
          São as colunas <em>Saldo</em>, <em>Mov. do Dia</em>, <em>ABERTO</em>,{' '}
          <em>Realizado</em> e <em>Pend.</em> da planilha, na mesma ordem. A diferença: lá a
          pendência é grampeada em zero e o excedente de quem limpa backlog antigo é descartado;
          aqui a conta fecha sozinha. <strong>Revisão (hoje)</strong> é a única coluna que não
          segue o período — ela mostra a fila neste momento, não a de quando o período correu.
        </p>
      </section>

      {qualidade ? <QualidadeDaIa medida={qualidade} /> : null}

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

/**
 * Qualidade da interpretação da IA.
 *
 * Responde ao critério de aceitação nº 5. Duas leituras que NUNCA devem ser
 * separadas: a taxa de aceitação e a cobertura. Taxa alta sobre amostra
 * minúscula não é resultado — e como o denominador é só o que passou por
 * humano, subir o limiar de confiança até ninguém revisar levaria a taxa a
 * 100% enquanto a conferência desaparecia. Por isso as duas ficam lado a lado.
 *
 * Não há recorte por revisor, e não vai haver: mediria pessoa, não modelo.
 */
function QualidadeDaIa({ medida }: { medida: Qualidade }) {
  const { taxa, cobertura } = medida
  const semDado = taxa.revisadas === 0
  const atingiuMeta = taxa.taxaDeAceitacao !== null && taxa.taxaDeAceitacao >= META_DE_ACEITACAO

  const desfechos = Object.entries(taxa.porDesfecho)
    .filter(([, quantidade]) => quantidade > 0)
    .sort((a, b) => b[1] - a[1])

  // A confiança só é informativa quando SEPARA acerto de erro. Se as duas
  // médias estão coladas, o número que o modelo reporta é ruído, e mexer no
  // limiar com base nele seria calibrar no escuro.
  const separacao =
    taxa.confiancaMediaAceita !== null && taxa.confiancaMediaCorrigida !== null
      ? taxa.confiancaMediaAceita - taxa.confiancaMediaCorrigida
      : null

  return (
    <section>
      <CabecalhoDeSecao
        titulo="Acerto da IA"
        descricao={`${periodo(medida.desde)} · medido só sobre o que passou por revisão humana, o único universo que não se infla mexendo no limiar de confiança.`}
      />

      {semDado ? (
        <Vazio
          titulo="Ainda não há revisão resolvida"
          descricao="A medida nasce do que o humano decide na fila de Revisão. Sem decisão nenhuma não há taxa, e o travessão significa ausência de dado, nunca zero por cento."
        />
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Metrica
              rotulo="Aceitas sem correção"
              valor={percentual(taxa.taxaDeAceitacao)}
              tom={atingiuMeta ? 'ok' : 'atencao'}
              detalhe={`meta ${Math.round(META_DE_ACEITACAO * 100)}% · ${taxa.aceitasSemCorrecao} de ${taxa.revisadas}`}
            />
            <Metrica
              rotulo="Cobertura"
              valor={percentual(cobertura.fracaoRevisada)}
              detalhe={`${cobertura.revisados} revisados de ${cobertura.itensDeIa} itens da IA`}
            />
            <Metrica
              rotulo="Confiança quando acerta"
              valor={taxa.confiancaMediaAceita === null ? '—' : taxa.confiancaMediaAceita.toFixed(2)}
              detalhe="média informada pelo modelo"
            />
            <Metrica
              rotulo="Confiança quando erra"
              valor={
                taxa.confiancaMediaCorrigida === null
                  ? '—'
                  : taxa.confiancaMediaCorrigida.toFixed(2)
              }
              detalhe="média informada pelo modelo"
            />
          </div>

          {separacao !== null && separacao < 0.05 ? (
            <div className="mt-3">
              <Aviso tom="atencao">
                <strong>A confiança do modelo não separa acerto de erro.</strong> As duas médias
                estão a {separacao.toFixed(2)} de distância. Enquanto isso durar, mexer no limiar de
                confiança é calibrar no escuro — o número que ele reporta não distingue os casos.
              </Aviso>
            </div>
          ) : null}

          {medida.ignoradas > 0 ? (
            <div className="mt-3">
              <Aviso tom="alerta">
                <strong>{medida.ignoradas} revisões fora da conta.</strong> O registro gravado não
                pôde ser lido, então a amostra está desfalcada. Aparece aqui em vez de sumir da
                média em silêncio.
              </Aviso>
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium tracking-wide text-tinta-fraca uppercase">
                O que o humano mudou
              </p>
              <ul className="flex flex-col gap-1.5">
                {desfechos.map(([desfecho, quantidade]) => (
                  <li key={desfecho} className="flex items-center gap-2 text-sm">
                    <span className="numerico w-10 shrink-0 text-right text-tinta-suave">
                      {quantidade}
                    </span>
                    <span
                      className={juntar(
                        'h-2 rounded-full',
                        desfecho === 'aceita_sem_correcao' ? 'bg-ok' : 'bg-atencao',
                      )}
                      style={{ width: `${Math.max(4, (quantidade / taxa.revisadas) * 55)}%` }}
                    />
                    <span className="text-tinta-suave">
                      {ROTULO_DO_DESFECHO[desfecho] ?? desfecho}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium tracking-wide text-tinta-fraca uppercase">
                Onde a IA erra mais
              </p>
              <ListaResponsiva
                linhas={taxa.porCategoriaSugerida}
                chaveDaLinha={(linha) => linha.categoriaCodigo}
                tituloDoCartao={(linha) => linha.categoriaCodigo}
                colunas={[
                  {
                    chave: 'categoria',
                    cabecalho: 'Categoria sugerida',
                    ocultarNoCartao: true,
                    conteudo: (linha) => <span className="font-medium">{linha.categoriaCodigo}</span>,
                  },
                  {
                    chave: 'revisadas',
                    cabecalho: 'Revisadas',
                    alinhamento: 'direita',
                    conteudo: (linha) => <span className="numerico">{linha.revisadas}</span>,
                  },
                  {
                    chave: 'taxa',
                    cabecalho: 'Aceitas',
                    alinhamento: 'direita',
                    conteudo: (linha) => (
                      <span
                        className={juntar(
                          'numerico',
                          linha.taxaDeAceitacao !== null &&
                            linha.taxaDeAceitacao < META_DE_ACEITACAO &&
                            'text-atencao',
                        )}
                      >
                        {percentual(linha.taxaDeAceitacao)}
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          </div>
        </>
      )}
    </section>
  )
}
