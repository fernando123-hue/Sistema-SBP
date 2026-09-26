'use client'

import { useEffect, useState } from 'react'

import { api, mensagemDoErro } from '../../componentes/api'
import {
  Aviso,
  Botao,
  CabecalhoDeSecao,
  Carregando,
  ListaResponsiva,
  Metrica,
  Selo,
  Vazio,
  juntar,
} from '../../componentes/matrizes'

import type { LinhaPainel, LinhaPorPessoa, NaRede } from '../../core/tipos'

interface Periodo {

  de: string
  ate: string
}

interface Painel {
  periodo: Periodo
  categorias: NaRede<LinhaPainel>[]
  pessoas: NaRede<LinhaPorPessoa>[]
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
  /** A mesma taxa, separada por modelo. Vazio quando não há revisão resolvida. */
  porModelo: {
    modelo: string
    taxa: { revisadas: number; aceitasSemCorrecao: number; taxaDeAceitacao: number | null }
  }[]
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

interface Ausente {
  colaboradorId: string
  nome: string
  /** Já redigido pelo servidor conforme o papel de quem pediu. */
  rotulo: string
}

/**
 * Como cada rótulo aparece na tela.
 *
 * O servidor já redigiu: quem não é gestor só recebe `ferias` ou
 * `indisponivel`. Os demais só chegam aqui quando quem está olhando é gestor —
 * e aí o motivo é justamente o que ele precisa ver.
 */
const ROTULO_AUSENCIA: Record<string, string> = {
  ferias: 'férias',
  indisponivel: 'indisponível',
  atestado: 'atestado',
  licenca: 'licença',
  falta: 'falta',
  outro: 'outro',
  ausente: 'ausente',
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
  return `Desde ${dataCurta(desde)}`
}

/** `AAAA-MM-DD` → `DD/MM/AAAA`, sem passar por `Date` (e pelo fuso). */
function dataCurta(iso: string): string {
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano}`
}

/**
 * Há quantos dias o item aberto mais antigo da categoria está parado (`A7`).
 *
 * SEM LIMIAR DE ALERTA, e isso é decisão, não esquecimento. O `A7` diz, com
 * todas as letras, que o setor de cadastro **não tem tarefa com prazo** — não
 * existe item que "não pode esperar". Pintar de vermelho a partir de N dias
 * inventaria um SLA que ninguém decidiu, e a tela passaria a cobrar a equipe
 * por uma regra que não existe. O número aparece; o julgamento é de quem lê.
 *
 * Se um limiar vier a ser definido, é decisão do dono do negócio e entra aqui.
 */
function Atraso({ dias }: { dias: number | null }) {
  if (dias === null) return <span className="text-tinta-fraca">—</span>
  // `0` é hoje: dizer "há 0 dias" é pior do que dizer "hoje".
  return <span className="numerico">{dias === 0 ? 'hoje' : `${dias}d`}</span>
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
  const [fora, setFora] = useState<Ausente[]>([])
  /** Vazio = deixa o servidor escolher o mês corrente, a unidade da planilha. */
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  /** Muda para pedir os dados de novo depois de uma falha. */
  const [tentativa, setTentativa] = useState(0)
  // Um erro por efeito, e não um só: mudar o período limpa o erro DO PERÍODO,
  // e não pode apagar calado a falha de `/qualidade`, que nem foi refeita.
  const [erroDoPeriodo, setErroDoPeriodo] = useState<string | null>(null)
  const [erroDoEstadoAtual, setErroDoEstadoAtual] = useState<string | null>(null)
  const erro = erroDoPeriodo ?? erroDoEstadoAtual

  // ═══ DOIS EFEITOS, PORQUE SÓ UMA DAS TRÊS CONSULTAS DEPENDE DO PERÍODO ═══
  //
  // Era um efeito só, com `[de, ate]`: ajustar as duas pontas do período
  // refazia também `/qualidade` (janela própria) e `/afastamentos/hoje` (estado
  // atual) — oito consultas de banco a cada data escolhida, para trazer de
  // novo exatamente o que já estava na tela.
  // Cada efeito descarta a própria resposta quando já foi substituído. Sem
  // isto, ajustar as duas pontas do período disparava duas buscas, e se a
  // primeira chegasse por último a tela mostrava os números de um período com
  // outro escrito nos campos. Revisão do PR #35.
  useEffect(() => {
    let vigente = true
    // Limpa o erro anterior: sem isto, a faixa vermelha da tentativa que falhou
    // ficaria na tela por cima dos dados que a tentativa seguinte trouxe.
    setErroDoPeriodo(null)
    const recorte = de && ate ? `?de=${de}&ate=${ate}` : ''
    api
      .buscar<Painel>(`/painel${recorte}`)
      .then((painel) => {
        if (vigente) setDados(painel)
      })
      .catch((causa) => {
        if (vigente) setErroDoPeriodo(mensagemDoErro(causa))
      })
    return () => {
      vigente = false
    }
  }, [de, ate, tentativa])

  useEffect(() => {
    let vigente = true
    setErroDoEstadoAtual(null)
    Promise.all([
      // Janela padrão, NUNCA `dias=tudo`. Esta é a tela mais visitada do
      // sistema; pedir a série inteira faria a consulta crescer com o tempo de
      // vida da instalação. `conferirConservacao` já documenta a mesma regra —
      // nenhuma tela lê a tabela desde a fundação para se desenhar.
      api.buscar<Qualidade>('/qualidade'),
      // Quem está fora HOJE. Sem recorte de período de propósito: é estado
      // atual, como as outras colunas marcadas "(hoje)".
      api.buscar<Ausente[]>('/afastamentos/hoje'),
    ])
      .then(([medida, ausentes]) => {
        if (!vigente) return
        setQualidade(medida)
        setFora(ausentes)
      })
      .catch((causa) => {
        if (vigente) setErroDoEstadoAtual(mensagemDoErro(causa))
      })
    return () => {
      vigente = false
    }
  }, [tentativa])

  // ═══ ERRO NÃO APAGA A TELA ═══
  //
  // Este ramo era `if (erro) return <Aviso>{erro}</Aviso>`, e ele levava junto
  // o cabeçalho e os DOIS CAMPOS DE PERÍODO. Como o efeito só dispara quando
  // `de`/`ate` mudam, e não sobrava campo na tela para mudá-los, não existia
  // caminho de volta dentro da página: uma piscada de rede no meio da consulta
  // deixava a gestora com uma linha vermelha no branco e nada para clicar.
  //
  // Agora o erro aparece com o botão que refaz a consulta; e quando já havia
  // dados na tela, eles ficam — refazer uma consulta que falhou não é motivo
  // para apagar o que já estava certo.
  if (!dados) {
    return (
      <div className="flex flex-col gap-4">
        <CabecalhoDeSecao
          titulo="Painel"
          descricao="Todo número desta tela é calculado. Não existe campo digitável."
        />
        {erro ? (
          <div className="flex flex-col items-start gap-3">
            <Aviso>{erro}</Aviso>
            <Botao onClick={() => setTentativa((numero) => numero + 1)}>Tentar de novo</Botao>
          </div>
        ) : (
          <Carregando />
        )}
      </div>
    )
  }

  // ═══ DUAS NATUREZAS DE NÚMERO NESTA TELA, E ELAS NÃO SE FILTRAM IGUAL ═══
  //
  // `aberto`, `entrouNoPeriodo`, `concluidoNoPeriodo` e `pendente` são do
  // PERÍODO escolhido. `aguardandoRevisao` é ESTADO ATUAL — quantos itens estão
  // parados na revisão agora, sem recorte nenhum.
  //
  // O filtro `aberto > 0` valia para as quatro primeiras e mentia sobre a
  // última: bastava escolher um período em que a categoria não teve movimento
  // para a linha sumir, e com ela sumiam do total itens que estão em revisão
  // NESTE momento. O operador estreitava o período para investigar e o número
  // "Em revisão" caía — dando a entender que o trabalho tinha andado.
  //
  // Uma métrica que responde a pergunta errada é pior que uma ausente: esta
  // levava a decisão exatamente para o lado contrário do certo.
  const temTrabalhoAgora = (linha: NaRede<LinhaPainel>) =>
    linha.aberto > 0 || linha.aguardandoRevisao > 0
  const comDados = dados.categorias.filter(temTrabalhoAgora)

  const total = comDados.reduce(
    (soma, linha) => ({
      aberto: soma.aberto + linha.aberto,
      entrou: soma.entrou + linha.entrouNoPeriodo,
      concluido: soma.concluido + linha.concluidoNoPeriodo,
      pendente: soma.pendente + linha.pendente,
    }),
    { aberto: 0, entrou: 0, concluido: 0, pendente: 0 },
  )

  // Sobre TODAS as categorias, nunca sobre as filtradas: é estado atual, e não
  // depende do período que a pessoa escolheu para olhar.
  const emRevisaoAgora = dados.categorias.reduce(
    (soma, linha) => soma + linha.aguardandoRevisao,
    0,
  )

  const conservacaoOk = dados.conservacao.divergentes.length === 0

  return (
    <div className="flex flex-col gap-6">
      {/* Com dados na tela, a falha seguinte também oferece o caminho de volta.
          Antes o botão só existia antes do primeiro carregamento, e para tentar
          de novo era preciso mudar o período — revisão do PR #35. */}
      {erro ? (
        <div className="flex flex-col items-start gap-3">
          <Aviso>{erro}</Aviso>
          <Botao onClick={() => setTentativa((numero) => numero + 1)}>Tentar de novo</Botao>
        </div>
      ) : null}
      <CabecalhoDeSecao
        titulo="Painel"
        descricao="Todo número desta tela é calculado. Não existe campo digitável."
        acao={
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-tinta-suave">Período</span>
            <input
              type="date"
              aria-label="Início do período"
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
              aria-label="Fim do período"
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
          valor={emRevisaoAgora}
          tom={emRevisaoAgora > 0 ? 'atencao' : 'neutro'}
          detalhe="aguardando decisão humana · estado atual"
        />
      </div>

      {/*
        QUEM ESTÁ FORA HOJE (`A10`, com a decisão de privacidade de 06/09/2026).
        A operação inteira precisa saber quem não vai receber trabalho — sem
        isso a tela promete uma equipe que não existe. O MOTIVO fica na ficha
        do Acesso, só para gestor: o que chega aqui já vem redigido pelo
        servidor conforme o papel de quem pediu.
      */}
      {fora.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-tinta-suave">Fora hoje:</span>
          {fora.map((ausente) => (
            <Selo key={ausente.colaboradorId} tom="atencao">
              {ausente.nome} · {ROTULO_AUSENCIA[ausente.rotulo] ?? 'indisponível'}
            </Selo>
          ))}
          <span className="text-tinta-fraca">não recebem distribuição hoje</span>
        </div>
      ) : null}

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
              {
                chave: 'atraso',
                // Indicador de atraso (`A7`). Também é estado atual, daí o
                // "(hoje)" — e por isso ignora o período de propósito: o item
                // de março que ninguém tocou tem de aparecer justamente quando
                // alguém está olhando o recorte de setembro.
                cabecalho: 'Mais antigo (hoje)',
                alinhamento: 'direita',
                conteudo: (linha) => <Atraso dias={linha.diasDoMaisAntigo} />,
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
          aqui a conta fecha sozinha. <strong>Revisão (hoje)</strong> e{' '}
          <strong>Mais antigo (hoje)</strong> são as duas colunas que não seguem o período — elas
          mostram este momento, não o que valia quando o período correu.
        </p>
        <p className="mt-2 text-xs text-tinta-fraca">
          <strong>Mais antigo</strong> é há quantos dias está parado o item aberto mais velho da
          categoria — o que torna backlog envelhecendo visível antes de virar sobrecarga. Não há
          faixa de alerta: o setor de cadastro não trabalha com prazo, e colorir a partir de um
          número inventaria uma cobrança que ninguém definiu.
        </p>
      </section>

      {qualidade ? <QualidadeDaIa medida={qualidade} /> : null}

      <section>
        {/*
          A segunda frase descreve o recorte de `A24` sem a tela precisar saber
          o papel de quem está lendo: ela é verdadeira nos dois casos, e uma
          chamada a mais só para escolher entre dois textos seria custo sem
          ganho. Quem vê uma linha só entende por quê; quem vê a equipe também.
        */}
        {/*
          DOIS TEMPOS NA MESMA TABELA, e cada coluna diz o seu (N-06).
          Concluídos obedece ao período escolhido no topo; Atribuídos e
          Pendentes são o que está com cada pessoa agora. Antes nenhuma dizia,
          e Concluídos contava desde sempre — a comparação mês a mês com a
          planilha saía errada por pessoa.
        */}
        <CabecalhoDeSecao
          titulo="Por pessoa"
          descricao={`Concluídos: de ${dataCurta(dados.periodo.de)} a ${dataCurta(dados.periodo.ate)}. Atribuídos (hoje) e pendentes (hoje): o que está com cada pessoa agora, fora do período. Cada pessoa vê os próprios números; quem coordena vê os de todos. Crédito perto de zero significa carga equilibrada; positivo, a pessoa recebeu menos que a média e fica na frente para a próxima sobra.`}
        />
        <ListaResponsiva
          // Sem filtro aqui: quais linhas saem é decisão do servidor, que sabe
          // o papel de quem pede (`porPessoa`). O filtro `atribuidos > 0` desta
          // tela escondia quem só concluiu no período (N-06).
          linhas={dados.pessoas}
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
              cabecalho: 'Atribuídos (hoje)',
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
              cabecalho: 'Pendentes (hoje)',
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

          {/*
            COMPARAÇÃO ENTRE MODELOS.
            A razão de o sistema manter dois fornecedores é poder responder se
            algum acerta mais neste trabalho. Enquanto a medida era um número
            agregado, a resposta não existia em lugar nenhum — as revisões dos
            dois iam somadas na mesma taxa. Aparece só com dois ou mais: com um
            modelo só, a linha repetiria o número de cima.
          */}
          {medida.porModelo.length > 1 ? (
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-medium tracking-wide text-tinta-fraca uppercase">
                Por modelo
              </p>
              <ul className="flex flex-col gap-1">
                {medida.porModelo.map((linha) => (
                  <li
                    key={linha.modelo}
                    className="flex items-center justify-between gap-3 rounded-md border border-borda px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{linha.modelo}</span>
                    <span className="text-tinta-suave">
                      <span className="numerico">{percentual(linha.taxa.taxaDeAceitacao)}</span>{' '}
                      <span className="text-xs">
                        · {linha.taxa.aceitasSemCorrecao} de {linha.taxa.revisadas}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs text-tinta-fraca">
                Compare pela amostra, não só pela porcentagem: taxa alta sobre poucas revisões
                ainda não diz nada.
              </p>
            </div>
          ) : null}

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
