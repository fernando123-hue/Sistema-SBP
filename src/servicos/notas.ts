import { ErroDeNegocio } from '../core/erros'
import { ArquivamentoDeNotaSchema, NotaEntradaSchema } from '../core/esquemas'
import {
  LIMITE_DE_NOTAS_EXIBIDAS,
  selecionarNotas,
  type ContextoDeTrabalho,
  type NotaSelecionavel,
} from '../core/notas'
import { ehOProprio, exigirPapel, type Ator } from '../servidor/ator'
import { novaCorrelacao } from '../servidor/observabilidade'
import type { Banco } from '../servidor/prisma'
import { auditar } from './auditoria'

/**
 * Notas do setor — o que a equipe aprendeu operando.
 *
 * Não confundir com `servicos/memoria.ts`, que também é memória: aquele lê a
 * trilha (o que ACONTECEU), este guarda o aprendizado (o que se APRENDEU com o
 * que aconteceu). O primeiro é gerado pelo sistema e append-only; este é
 * escrito por gente, e gente se corrige — daí o arquivamento.
 *
 * ═══ QUEM ESCREVE ═══
 *
 * Todo mundo que entra no sistema, `colaborador` inclusive. É a única escolha
 * coerente com o propósito: quem tropeça no problema é quem opera, e exigir
 * papel para registrar aprendizado transformaria a memória do setor em memória
 * da chefia. Nenhuma nota decide distribuição, altera cota, mexe em crédito ou
 * entra em métrica de painel — o poder que ela dá é o de avisar, e avisar é o
 * trabalho de todos.
 *
 * Arquivar é mais restrito: quem escreveu, ou o gestor. Ver `arquivar`.
 *
 * ═══ O QUE ESTE MÓDULO NÃO FAZ ═══
 *
 * **Não monta prompt.** `paraContexto` devolve as notas para a TELA. A decisão
 * do dono (07/09/2026) foi construir a seleção agora e ligar o modelo depois
 * que o adapter da Anthropic rodar contra a API real — ver `core/notas.ts`,
 * `DECISOES.md § H.4` item 14, e o invariante 12.
 *
 * **Não vira número de painel.** Nenhuma função daqui é lida por
 * `servicos/painel.ts`. Nota é conselho; métrica sai de `Item`, `Atribuicao` e
 * `Execucao`, que são fatos. Somadas, dariam dois jeitos de contar a mesma
 * coisa — e é exatamente disso que a planilha morreu.
 *
 * **Não guarda nota sobre pessoa.** Não existe vínculo com `Colaborador` além
 * da autoria. Ver `Nota` no schema e `DECISOES.md § H.4`, item 13.
 */

export interface NotaDoSetor {
  id: string
  texto: string
  categoriaCodigo: string | null
  categoriaRotulo: string | null
  ligaId: string | null
  ligaNome: string | null
  autorId: string
  autorNome: string
  criadoEm: Date
  arquivadaEm: Date | null
  motivoArquivo: string | null
}

/** Campos que a seleção pura precisa, mais o que a tela mostra. */
const CAMPOS = {
  id: true,
  texto: true,
  categoriaId: true,
  ligaId: true,
  autorId: true,
  criadoEm: true,
  arquivadaEm: true,
  motivoArquivo: true,
  autor: { select: { nome: true } },
  categoria: { select: { codigo: true, rotulo: true } },
  liga: { select: { nome: true } },
} as const

type LinhaCrua = {
  id: string
  texto: string
  categoriaId: string | null
  ligaId: string | null
  autorId: string
  criadoEm: Date
  arquivadaEm: Date | null
  motivoArquivo: string | null
  autor: { nome: string }
  categoria: { codigo: string; rotulo: string } | null
  liga: { nome: string } | null
}

function paraSaida(linha: LinhaCrua): NotaDoSetor {
  return {
    id: linha.id,
    texto: linha.texto,
    categoriaCodigo: linha.categoria?.codigo ?? null,
    categoriaRotulo: linha.categoria?.rotulo ?? null,
    ligaId: linha.ligaId,
    ligaNome: linha.liga?.nome ?? null,
    autorId: linha.autorId,
    autorNome: linha.autor.nome,
    criadoEm: linha.criadoEm,
    arquivadaEm: linha.arquivadaEm,
    motivoArquivo: linha.motivoArquivo,
  }
}

function paraSelecao(linha: LinhaCrua): NotaSelecionavel {
  return {
    id: linha.id,
    texto: linha.texto,
    categoriaId: linha.categoriaId,
    ligaId: linha.ligaId,
    criadoEm: linha.criadoEm,
    arquivadaEm: linha.arquivadaEm,
  }
}

export async function registrar(
  banco: Banco,
  entrada: unknown,
  ator: Ator,
): Promise<NotaDoSetor> {
  // Todos os papéis. Ver o cabeçalho: registrar aprendizado é trabalho de quem
  // opera, e o papel existe para restringir quem DECIDE, não quem avisa.
  exigirPapel(ator, 'registrar nota do setor', 'colaborador', 'operador', 'gestor')

  const dados = NotaEntradaSchema.parse(entrada)
  const correlacaoId = novaCorrelacao()

  return banco.$transaction(async (tx) => {
    // Os vínculos são resolvidos DENTRO da transação, e são recusados quando
    // não existem. Sem isto, uma nota nasceria apontando para uma categoria
    // desativada ou uma liga inexistente e nunca apareceria para ninguém: a
    // pessoa escreveria o aviso, veria a confirmação na tela, e a nota estaria
    // morta no nascimento — o erro silencioso que este sistema existe para
    // eliminar.
    let categoriaId: string | null = null
    if (dados.categoriaCodigo !== null) {
      const categoria = await tx.categoria.findUnique({
        where: { codigo: dados.categoriaCodigo },
        select: { id: true, ativa: true, rotulo: true },
      })
      if (!categoria) {
        throw new ErroDeNegocio(`Categoria "${dados.categoriaCodigo}" não encontrada.`)
      }
      if (!categoria.ativa) {
        throw new ErroDeNegocio(
          `A categoria "${categoria.rotulo}" está inativa — uma nota presa a ela não apareceria para ninguém.`,
        )
      }
      categoriaId = categoria.id
    }

    if (dados.ligaId !== null) {
      const liga = await tx.liga.findUnique({ where: { id: dados.ligaId }, select: { id: true } })
      if (!liga) {
        throw new ErroDeNegocio('Liga não encontrada.')
      }
    }

    const nota = await tx.nota.create({
      data: {
        texto: dados.texto,
        categoriaId,
        ligaId: dados.ligaId,
        autorId: ator.colaboradorId,
      },
      select: CAMPOS,
    })

    // Na MESMA transação do fato, nunca depois — invariante 13. Publicar antes
    // do commit deixaria a memória afirmando uma nota que a transação abortou.
    await auditar(tx, {
      entidade: 'Nota',
      entidadeId: nota.id,
      acao: 'nota_registrada',
      depois: {
        categoriaCodigo: dados.categoriaCodigo,
        ligaId: dados.ligaId,
        // O TEXTO NÃO VAI PARA A TRILHA, e a omissão é a decisão.
        //
        // `LogAuditoria` é append-only por invariante: o que entra aqui não
        // pode ser corrigido nem expurgado depois. Copiar o texto faria a nota
        // existir em dois lugares com políticas de retenção opostas — e a
        // versão que sobrevive para sempre seria justamente a que ninguém
        // consegue arquivar. Ver `DECISOES.md`, seção de 07/09/2026.
        tamanhoDoTexto: dados.texto.length,
      },
      usuario: ator.colaboradorId,
      correlacaoId,
    })

    return paraSaida(nota)
  })
}

/**
 * Arquiva uma nota — CARIMBA, nunca apaga.
 *
 * Quem escreveu, ou o gestor. O autor porque é quem sabe que o próprio aviso
 * deixou de valer; o gestor porque alguém precisa poder limpar a nota de quem
 * saiu do setor. Um terceiro qualquer, não: apagar o aviso alheio sem falar com
 * ninguém é como uma memória compartilhada morre.
 *
 * O registro sobrevive ao arquivamento porque "por que a equipe conferia esse
 * documento em março?" é pergunta legítima, e um `DELETE` a deixaria sem
 * resposta para sempre.
 */
export async function arquivar(
  banco: Banco,
  notaId: string,
  entrada: unknown,
  ator: Ator,
): Promise<NotaDoSetor> {
  const dados = ArquivamentoDeNotaSchema.parse(entrada)
  const correlacaoId = novaCorrelacao()

  return banco.$transaction(async (tx) => {
    const existente = await tx.nota.findUnique({
      where: { id: notaId },
      select: { id: true, autorId: true, arquivadaEm: true },
    })

    if (!existente) {
      throw new ErroDeNegocio('Nota não encontrada.')
    }

    if (!ehOProprio(ator, existente.autorId)) {
      exigirPapel(ator, 'arquivar nota do setor', 'gestor')
    }

    // Sai cedo em vez de re-carimbar: um segundo arquivamento sobrescreveria a
    // data e o motivo do primeiro, e a trilha passaria a afirmar que a nota
    // saiu de circulação num dia em que ela já estava fora.
    if (existente.arquivadaEm !== null) {
      const atual = await tx.nota.findUniqueOrThrow({ where: { id: notaId }, select: CAMPOS })
      return paraSaida(atual)
    }

    const nota = await tx.nota.update({
      where: { id: notaId },
      data: {
        arquivadaEm: new Date(),
        arquivadaPor: ator.colaboradorId,
        motivoArquivo: dados.motivo,
      },
      select: CAMPOS,
    })

    await auditar(tx, {
      entidade: 'Nota',
      entidadeId: nota.id,
      acao: 'nota_arquivada',
      antes: { arquivadaEm: null },
      // O TEXTO DO MOTIVO NÃO VAI PARA A TRILHA — só o fato de haver um.
      //
      // É a mesma decisão que a função vizinha já tomava para o texto da nota,
      // e ela vale igual aqui: `LogAuditoria` é append-only e sobrevive à
      // política de retenção (invariante 11), enquanto `Nota.motivoArquivo` é
      // expurgável junto com a nota. Copiar o texto para cá criava a mesma
      // frase em dois lugares com políticas OPOSTAS — e a cópia eterna seria
      // justamente a que ninguém consegue arquivar.
      //
      // O motivo é texto livre escrito por gente sobre trabalho de gente:
      // "a Bianca errava esse campo toda semana" é uma frase plausível ali.
      depois: {
        arquivadaEm: nota.arquivadaEm,
        temMotivo: dados.motivo !== null && dados.motivo.length > 0,
      },
      usuario: ator.colaboradorId,
      correlacaoId,
    })

    return paraSaida(nota)
  })
}

export interface ContextoPedido extends ContextoDeTrabalho {
  /**
   * As telas conhecem o CÓDIGO da categoria, não o id — `codigo` é o que
   * viaja nas listagens porque é estável e imutável, enquanto o id é detalhe
   * de banco. Resolver aqui evita que cada tela faça a tradução por conta
   * própria, que é como cinco telas passam a ter cinco versões da mesma regra.
   */
  categoriaCodigo?: string | null
}

/**
 * As notas que valem para onde a pessoa está agora.
 *
 * Lê as candidatas do banco e entrega ao núcleo puro, que decide o que sobra.
 * A consulta traz só as vivas — o corte por `arquivadaEm` está nos dois lugares
 * de propósito: no banco porque o índice existe para isso, e em
 * `selecionarNotas` porque a função pura não pode depender de o chamador ter
 * filtrado.
 *
 * **É o modo PADRÃO da rota**, e isso é a defesa. Enquanto a listagem plana era
 * o padrão, as telas que pedem sem contexto — três das quatro — recebiam também
 * as notas presas a categorias em que a pessoa não estava trabalhando, anulando
 * por fora a única garantia que `selecionarNotas` existe para dar. O modo
 * perigoso é o que precisa ser pedido por escrito.
 *
 * **A leitura não tem teto, e é escolha registrada.** Com o recorte do `where`,
 * as candidatas são só as gerais mais as do vínculo pedido — dezenas, na escala
 * de 4 a 7 pessoas. Um `take` aqui pareceria prudente e seria pior: ordenado
 * por data, ele descartaria em silêncio a nota de liga mais antiga em favor de
 * notas gerais recentes, trocando um custo irrelevante por uma degradação
 * invisível. Mesma classe de `H-D8`: vira assunto na migração para PostgreSQL,
 * e lá a saída é paginar informando o corte, como `servicos/memoria.ts` faz.
 */
export async function paraContexto(
  banco: Banco,
  pedido: ContextoPedido,
  limite: number = LIMITE_DE_NOTAS_EXIBIDAS,
): Promise<NotaDoSetor[]> {
  let categoriaId = pedido.categoriaId ?? null

  if (categoriaId === null && pedido.categoriaCodigo) {
    const categoria = await banco.categoria.findUnique({
      where: { codigo: pedido.categoriaCodigo },
      select: { id: true },
    })
    // Código desconhecido cai para o contexto geral em vez de estourar: esta é
    // uma leitura de apoio, e derrubar a tela de trabalho inteira porque uma
    // nota não pôde ser recortada seria trocar um incômodo por uma parada.
    categoriaId = categoria?.id ?? null
  }

  const contexto: ContextoDeTrabalho = { categoriaId, ligaId: pedido.ligaId ?? null }

  const candidatas = await banco.nota.findMany({
    where: {
      arquivadaEm: null,
      // Só o que pode importar: o vínculo do contexto, ou nenhum vínculo. Sem
      // este recorte, a consulta traria a memória inteira do setor a cada
      // carregamento de tela para descartar quase tudo em memória.
      OR: [
        { categoriaId: null, ligaId: null },
        ...(contexto.categoriaId ? [{ categoriaId: contexto.categoriaId }] : []),
        ...(contexto.ligaId ? [{ ligaId: contexto.ligaId }] : []),
      ],
    },
    select: CAMPOS,
    orderBy: { criadoEm: 'desc' },
  })

  const escolhidas = selecionarNotas(candidatas.map(paraSelecao), contexto, limite)
  const porId = new Map(candidatas.map((linha) => [linha.id, linha]))

  return escolhidas.map((linha) => paraSaida(porId.get(linha.id)!))
}

export interface FiltroDeNotas {
  categoriaCodigo?: string | null
  ligaId?: string | null
  /** `true` inclui as arquivadas. A tela de gestão precisa vê-las. */
  incluirArquivadas?: boolean
}

/** Listagem plana, para a tela que administra a memória do setor. */
export async function listar(banco: Banco, filtro: FiltroDeNotas = {}): Promise<NotaDoSetor[]> {
  const linhas = await banco.nota.findMany({
    where: {
      ...(filtro.incluirArquivadas ? {} : { arquivadaEm: null }),
      ...(filtro.categoriaCodigo ? { categoria: { codigo: filtro.categoriaCodigo } } : {}),
      ...(filtro.ligaId ? { ligaId: filtro.ligaId } : {}),
    },
    select: CAMPOS,
    orderBy: { criadoEm: 'desc' },
  })

  return linhas.map(paraSaida)
}
