/**
 * Tipos do domínio. Núcleo puro: nenhum import de banco, rede ou UI.
 */

import type { z } from 'zod'

import type { RotuloDeAfastamento } from './afastamento-visivel'
import type { FrenteSchema, GrupoSchema } from './esquemas'

export type ColaboradorId = string
export type CategoriaId = string

/** Frente operacional. A V1 cobre apenas CADASTRO. Derivada do esquema — uma lista só. */
export type Frente = z.infer<typeof FrenteSchema>

/**
 * Subgrupo dentro da frente.
 * Restaura a estrutura que as fórmulas `E=SUM(B:D)` e `I=SUM(F:H)` da planilha
 * revelam e que o documento de contexto havia achatado. Ver DECISOES.md § C7.
 */
export type Grupo = z.infer<typeof GrupoSchema>

export interface Categoria {
  id: CategoriaId
  /** Estável e imutável. O rótulo pode mudar; o código, não. Ver DECISOES.md § C8. */
  codigo: string
  rotulo: string
  frente: Frente
  grupo: Grupo
  /**
   * `false` = dono único, sem rateio (RN-07).
   * Caminho secundário: a elegibilidade já produz 100% quando há um só habilitado.
   * Ver DECISOES.md § C5.
   */
  divisivel: boolean
  /** Peso de esforço em unidades ponderadas. `1` na V1. Ver DECISOES.md § AT-02. */
  peso: number
  /**
   * Quantidade até a qual o lote vai inteiro para uma pessoa (RN-05).
   * Comparação é `Q <= limiar` — ver DECISOES.md § C1 para o off-by-one corrigido.
   */
  limiarIndivisivel: number
  /** `INADIMP.` e `ISENTO` ficam fora do rateio diário (RN-15). */
  entraNoRateio: boolean
  /**
   * A liga é a unidade que não se separa nesta categoria (`A4`).
   *
   * `true` em `LIGANTE` e `EMAIL_LIGA`: todos os ligantes de uma liga no
   * mesmo dia vão inteiros para uma pessoa, ainda que tenham chegado em
   * e-mails diferentes (`A4.1`). Nas demais categorias o item é a unidade, e
   * o rateio continua sendo resto-maior.
   */
  agrupaPorLiga: boolean
}

/**
 * Um candidato a receber trabalho numa rodada.
 * Já é o resultado de `Habilitacao ativa ∩ Escala do dia` — o motor não consulta nada.
 */
export interface Elegivel {
  colaboradorId: ColaboradorId
  /** Crédito acumulado NESTA categoria, em unidades ponderadas. Critério primário. */
  creditoCategoria: number
  /** Crédito acumulado somando todas as categorias. Desempate secundário. */
  creditoGlobal: number
  /** Volume recebido no período corrente (semana, mês — definido por quem chama). */
  recebidoPeriodo: number
  /** Volume recebido hoje, somando rodadas anteriores do mesmo dia. */
  recebidoDia: number
  /** Reservado para meio período / retorno de férias. `1` na V1. */
  capacidadeRelativa: number
}

export type CriterioRodada = 'sem_demanda' | 'indivisivel' | 'resto_maior' | 'por_grupo'

/**
 * Lote que não se separa (`A4`).
 *
 * Hoje é sempre uma liga num dia, mas o motor não sabe disso: para ele é só
 * "um punhado de itens que vai inteiro para alguém". Manter o núcleo alheio ao
 * que a chave significa é o que permite outra categoria ganhar agrupamento
 * amanhã sem tocar no motor.
 */
export interface GrupoIndivisivel {
  /** Identidade do lote. Determinística — desempata tamanho igual. */
  chave: string
  /** Quantos itens. Sempre ≥ 1. */
  tamanho: number
}

export interface EntradaRodada {
  /** ISO date (`YYYY-MM-DD`). */
  data: string
  categoria: Categoria
  /** Q — quantidade de ITENS, não de e-mails. Ver DECISOES.md § A1. */
  quantidade: number
  elegiveis: Elegivel[]
  /**
   * Lotes indivisíveis (`A4`). Opcional.
   *
   * REFINA `quantidade`, não a substitui: `Σ tamanhos` tem de ser igual a `Q`,
   * e a trava de conservação continua sendo a mesma de sempre. Ausente, o
   * motor se comporta exatamente como antes — nenhuma rodada existente muda.
   */
  grupos?: GrupoIndivisivel[]
}

/**
 * Snapshot completo e auto-suficiente da decisão.
 * É o que a `RodadaDistribuicao` persiste — e o que torna qualquer número
 * do painel reconstruível passo a passo.
 */
export interface ResultadoRodada {
  data: string
  categoriaId: CategoriaId
  quantidadeEntrada: number
  algoritmoVersao: string
  criterio: CriterioRodada
  /** Piso da divisão inteira. */
  base: number
  /** `Q mod n` — as unidades que sobram e vão para o topo da ordem. */
  resto: number
  /** `Q × peso / n`. O que cada um deveria ter recebido em unidades ponderadas. */
  cotaJusta: number
  /** Ordem aplicada, do primeiro a receber o resto ao último. Determinística. */
  ordemDesempate: ColaboradorId[]
  /**
   * Estado COMPLETO de cada elegível no instante da decisão, já ordenado.
   *
   * Sem isto, a rodada guarda quem venceu mas não POR QUE venceu: os critérios
   * b, c e d do desempate (crédito global, recebido no período, recebido no dia)
   * ficariam irrecuperáveis, e a tela de auditoria não conseguiria reconstruir
   * a decisão passo a passo. Um item do PRD promete exatamente isso.
   */
  elegiveis: Elegivel[]
  alocacao: Record<ColaboradorId, number>
  /**
   * Qual lote indivisível foi para quem. Presente só no critério `por_grupo`.
   *
   * ═══ POR QUE O NÚMERO NÃO BASTAVA ═══
   *
   * `alocacao` diz QUANTOS itens cada pessoa recebe. Enquanto o rateio era por
   * quantidade isso era suficiente: qualquer conjunto de N itens serve. Com o
   * `A4` deixou de ser — o motor passou a decidir por LOTE, e a identidade do
   * lote é a decisão.
   *
   * Sem este campo, o serviço recebia "Ana: 5, Bruno: 3" e repartia os itens
   * por POSIÇÃO numa lista ordenada por `criadoEm`. Duas ligas cujos e-mails
   * chegaram intercalados eram partidas entre as duas pessoas — exatamente o
   * que o `A4` existe para impedir —, e nada acusava, porque a soma continuava
   * fechando e a trava de conservação só olha a soma.
   *
   * A decisão do motor tem de chegar inteira a quem grava. Este campo é ela.
   */
  atribuicaoDeGrupos?: Record<string, ColaboradorId>
  creditoCategoriaAntes: Record<ColaboradorId, number>
  creditoCategoriaDepois: Record<ColaboradorId, number>
  creditoGlobalAntes: Record<ColaboradorId, number>
  creditoGlobalDepois: Record<ColaboradorId, number>
}

// ─── O contrato entre o serviço e a tela (`H-D7`) ─────────────────────────
//
// Estas formas são declaradas UMA vez. O serviço as devolve, a rota as
// serializa em JSON, e a tela lê o resultado — e como as três olham para a
// mesma declaração, mudar um campo no serviço quebra a compilação da tela em
// vez de quebrar a tela em produção.
//
// A primeira tentativa de fechar a `H-D7` copiou as interfaces das telas para
// cá e deixou as originais nos serviços. Não fechou nada: virou uma terceira
// cópia, e as duas JÁ divergiam — `recebidoEm` era `Date` no serviço e
// `string` na cópia, que é exatamente a divergência que a dívida descreve.
//
// O que a serialização faz com os tipos está em `NaRede`, abaixo: uma única
// regra, verificada pelo compilador, em vez de um `string` digitado à mão em
// cada tela na esperança de que o JSON combine.
//
// O que isto NÃO resolve: nada aqui prova que a ROTA devolve mesmo esta forma
// — ela pode omitir um campo, e o `await api.buscar<T>()` acredita. Fechar
// isso de verdade exige validar a resposta no cliente contra o mesmo Zod, e
// está registrado em `DECISOES.md § H.2` como a parte que sobra da `H-D7`.

/**
 * A mesma forma, depois de passar pelo JSON.
 *
 * `Date` não sobrevive à serialização: `JSON.stringify(new Date())` devolve a
 * string ISO, e é ela que a tela recebe. Declarar o campo como `Date` na tela
 * compilaria e explodiria em `.getTime is not a function` no navegador; digitar
 * `string` à mão numa cópia esconde a diferença. Aqui a conversão é uma regra
 * só, aplicada pelo compilador.
 */
export type NaRede<T> = { [K in keyof T]: NaRedeCampo<T[K]> }

type NaRedeCampo<V> = V extends Date
  ? string
  : V extends readonly (infer U)[]
    ? NaRedeCampo<U>[]
    : V extends object
      ? { [K in keyof V]: NaRedeCampo<V[K]> }
      : V

/**
 * Categoria ativa, como `GET /api/categorias` devolve.
 *
 * Era o elo mais fraco da `H-D7`: a única rota consumida por duas telas sem
 * interface nomeada em lugar nenhum. O `select` do Prisma na rota ERA o
 * contrato, e Acesso e Caixa redeclaravam a forma cada uma do seu lado.
 * Renomear `entraNoRateio` na rota fazia o seletor de responsável sumir da
 * Caixa, três arquivos depois, com a compilação verde. Achado 22 da auditoria
 * de 08/09/2026. Sem `Date`, então a forma na rede é esta mesma.
 */
export interface CategoriaDisponivel {
  codigo: string
  rotulo: string
  grupo: string
  entraNoRateio: boolean
}

/**
 * Estado de acesso de uma pessoa, como `GET /api/colaboradores` devolve.
 *
 * O hash da senha nunca entra aqui, em nenhuma forma: `senhaDefinidaEm`
 * responde "esta pessoa já tem acesso?" sem revelar nada sobre a senha.
 */
export interface ColaboradorResumo {
  id: string
  nome: string
  papel: string
  email: string
  ativo: boolean
  precisaTrocarSenha: boolean
  senhaDefinidaEm: Date | null
  bloqueadoAte: Date | null
  tentativasFalhas: number
  /** Categorias em que a pessoa pode receber trabalho. */
  categorias: string[]
}

export interface ItemDaCaixa {
  itemId: string
  titulo: string
  categoriaCodigo: string
  categoriaRotulo: string
  /**
   * O limiar de confiança DESTA categoria (`A12`).
   *
   * Sobe até aqui porque a tela precisa dele para colorir o selo de confiança.
   * Sem ele, a tela usava 0,85 para todo mundo e contradizia o motivo da
   * revisão em itens de `DOC` (0,95) e `FICHA` (0,90).
   */
  limiarConfianca: number
  grupo: string
  status: string
  confianca: number
  /**
   * A IA classificou este item?
   *
   * Sem isto, item registrado à mão aparecia com "Confiança 100%" — um número
   * de aparência ótima sobre uma classificação que modelo nenhum fez. É a
   * mesma família de defeito que o `SUBTOTAL(109)` da planilha: o valor está
   * lá, parece resultado, e não significa o que quem lê acha que significa.
   * `modeloIa` é o mesmo critério que a taxa de acerto usa para montar o
   * denominador.
   */
  classificadaPorIa: boolean
  remetente: string | null
  assunto: string | null
  recebidoEm: Date | null
  /**
   * Quando o texto e os anexos do e-mail saíram pelo prazo (`A20`). Sem isto,
   * remetente nulo seria lido como "origem manual" — e a pessoa procuraria um
   * registro de balcão em vez de ir ao Outlook.
   */
  conteudoRemovidoEm: Date | null
  /** Quantos itens o mesmo e-mail gerou. Mostra o desdobramento na tela. */
  irmaos: number
  responsavel: string | null
  /**
   * A liga do item, quando tem (`A4`).
   *
   * Governava a distribuição desde o `A4` e não aparecia em tela nenhuma. Sobe
   * até aqui para que a Caixa possa filtrar por liga — e, com isso, para que a
   * memória do setor sobre aquela liga tenha onde ser lida e escrita.
   */
  ligaId: string | null
  ligaNome: string | null
}
export interface LinhaPainel {
  categoriaCodigo: string
  rotulo: string
  grupo: string

  /** Entrou antes do período e ainda estava aberto quando ele começou. */
  saldoInicial: number
  /** Entrou dentro do período. */
  entrouNoPeriodo: number
  /** `saldoInicial + entrouNoPeriodo` — tudo que esteve na mesa no período. */
  aberto: number
  /** Fechado dentro do período. */
  concluidoNoPeriodo: number
  /** Cancelado dentro do período. A planilha não tem coluna equivalente. */
  canceladoNoPeriodo: number
  /** Ainda aberto no fim do período. */
  pendente: number

  /** Estado AGORA, para tocar o dia. Não tem recorte de período. */
  aguardandoRevisao: number
  aprovado: number
  distribuido: number
  emAndamento: number
  /**
   * Há quantos dias está parado o item aberto mais antigo desta categoria.
   * `null` quando não há nada aberto.
   *
   * É o indicador de atraso do `A7`. Também é estado AGORA, e por isso ignora
   * o recorte de período: a pergunta é "o que está envelhecendo neste momento",
   * e um recorte de mês esconderia justamente o item de março que ninguém tocou.
   */
  diasDoMaisAntigo: number | null
}
export interface LinhaPorPessoa {
  colaboradorId: string
  nome: string
  atribuidos: number
  concluidos: number
  pendentes: number
  creditoGlobal: number
}
export interface LinhaDaEscala {
  colaboradorId: string
  nome: string
  papel: string
  disponivel: boolean
  capacidadeRelativa: number
  /** Categorias em que a pessoa está habilitada nesta data. */
  categorias: string[]
  /**
   * A ausência que cobre esta data, **já redigida para quem está lendo**.
   *
   * Existe porque sem ela a tela deixava marcar como de plantão alguém que
   * está de férias: `carregarElegiveis` a excluiria do rateio de qualquer
   * jeito, a prévia viria com uma pessoa a menos, e NADA explicaria por quê.
   *
   * NÃO é o tipo cru. Para quem não é gestor, `atestado`, `licença`, `falta` e
   * `outro` chegam todos como `indisponivel` — a operação precisa saber quem
   * não recebe hoje, não o motivo médico. Ver `core/afastamento-visivel.ts`.
   */
  afastamento: RotuloDeAfastamento | null
}
export interface ResumoIngestao {
  correlacaoId: string
  recebidos: number
  novos: number
  duplicados: number
  itensCriados: number
  /**
   * E-mails interpretados que não geraram item nenhum.
   *
   * Zero item é resultado legítimo — resposta automática, aviso de entrega,
   * boletim. Mas é indistinguível de "a IA não entendeu e a carga sumiu", e o
   * e-mail fica marcado como processado, então nunca mais volta. Sem este
   * contador na tela, a diferença entre os dois casos não existiria para
   * ninguém: seria exatamente a perda silenciosa que a planilha comete.
   */
  emailsSemItem: number
  itensAprovados: number
  itensParaRevisao: number
  /** Falhas ao processar: o e-mail não foi gravado e volta na próxima busca. */
  falhas: number
  anexosRejeitados: number
  /**
   * Mensagens da caixa que não puderam ser lidas (fora do formato, anexo que
   * não baixa). NÃO voltam sozinhas como trabalho: voltam recusadas de novo, e
   * uma pessoa precisa tratá-las na caixa. Por isso não somam em `falhas`,
   * cuja frase na tela promete o contrário (AT-35).
   */
  naoLidas: number
  /**
   * Mensagens com o identificador de um e-mail já processado, mas recebidas em
   * outra data: cópia legítima ou falsificação (AT-35). Não são lidas; sem
   * este contador a sincronização ficaria verde e ninguém saberia.
   */
  repetidas: number
  /**
   * E-mails que a IA tentou repetidas vezes e NUNCA conseguiu estruturar
   * (achado C-11/N-13) — desistiu depois de `TENTATIVAS_MAXIMAS_DE_INTERPRETACAO`
   * falhas seguidas.
   *
   * Sem este contador, o e-mail voltava a `falhas` a cada sincronização, pago
   * de novo em cada uma, pela janela inteira de `JANELA_DE_RELEITURA_DIAS`; e
   * depois da janela ele simplesmente sumia da leitura seguinte, sem que
   * ninguém tivesse visto. Ao desistir, o e-mail é marcado como tratado — não
   * volta a cobrar IA — e este número é a única forma de uma pessoa saber que
   * ele existe e precisa ser aberto direto no Outlook.
   */
  naoInterpretados: number
}

export interface ItemEmRevisao {
  revisaoId: string
  itemId: string
  motivo: string
  confianca: number
  campoIncerto: string | null
  titulo: string
  categoriaCodigo: string
  /** O limiar da categoria, para a tela colorir o selo pelo número certo. */
  limiarConfianca: number
  remetente: string | null
  assunto: string | null
  sugestaoIa: string
}
