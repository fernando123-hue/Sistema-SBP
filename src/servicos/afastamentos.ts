import { rotuloDeAfastamento, type RotuloDeAfastamento } from '../core/afastamento-visivel'
import { ErroDeNegocio } from '../core/erros'
import { AfastamentoEntradaSchema, type TipoDeAfastamento } from '../core/esquemas'
import { hojeIso } from '../core/util/datas'
import { exigirPapel, type Ator } from '../servidor/ator'
import { novaCorrelacao } from '../servidor/observabilidade'
import type { Banco } from '../servidor/prisma'
import { auditar } from './auditoria'

/**
 * Afastamentos — férias, atestado, falta (decisão `A10`).
 *
 * O que isto substitui: marcar `Escala.disponivel = false` dia a dia, na mão.
 * Duas semanas de férias eram catorze marcações que alguém precisava lembrar de
 * fazer, e esquecer uma significa distribuir trabalho para quem não está — com
 * o item aparecendo como parado só dias depois.
 *
 * **Escala e afastamento não são a mesma pergunta.** A escala diz quem está de
 * plantão HOJE (decisão diária do operador); o afastamento diz quem está fora
 * NUM PERÍODO (fato, declarado uma vez). `carregarElegiveis` exige as duas
 * coisas, e é lá que o afastamento tem efeito.
 *
 * **O crédito congela sozinho.** Não há mecanismo de congelamento aqui porque
 * não é preciso: crédito só muda para quem entra numa rodada, e quem está
 * afastado não entra. Somado à janela deslizante de 30 dias (`A9`), quem volta
 * de férias não retorna como credor gigante levando tudo.
 */

export interface AfastamentoRegistrado {
  id: string
  colaboradorId: string
  nome: string
  tipo: TipoDeAfastamento
  inicio: string
  fim: string | null
  observacao: string | null
  /** `true` quando o afastamento cobre a data consultada. */
  vigente: boolean
}

/** Um afastamento cobre a data quando começou e ainda não terminou. */
function cobre(inicio: string, fim: string | null, data: string): boolean {
  return inicio <= data && (fim === null || fim >= data)
}

export async function registrar(
  banco: Banco,
  entrada: unknown,
  ator: Ator,
): Promise<AfastamentoRegistrado> {
  // Gestor, não operador. Tirar alguém do rateio por duas semanas é decisão de
  // quem administra a equipe — o operador decide o plantão do dia, na escala.
  exigirPapel(ator, 'registrar afastamento', 'gestor')

  const dados = AfastamentoEntradaSchema.parse(entrada)
  const correlacaoId = novaCorrelacao()

  return banco.$transaction(async (tx) => {
    const pessoa = await tx.colaborador.findUnique({
      where: { id: dados.colaboradorId },
      select: { id: true, nome: true, ativo: true },
    })

    if (!pessoa) {
      throw new ErroDeNegocio('Colaborador não encontrado.')
    }

    // SOBREPOSIÇÃO É RECUSADA, e não é preciosismo.
    //
    // Dois afastamentos cobrindo o mesmo dia não mudam a elegibilidade (a
    // pessoa sai do rateio de qualquer jeito), mas quebram a leitura: a tela
    // mostraria a mesma ausência duas vezes, e cancelar UMA delas deixaria a
    // pessoa ainda fora do rateio sem que a tela explicasse por quê. É a
    // ambiguidade silenciosa que este sistema existe para eliminar.
    const conflitante = await tx.afastamento.findFirst({
      where: {
        colaboradorId: dados.colaboradorId,
        canceladoEm: null,
        // Dois períodos se sobrepõem quando cada um começa antes de o outro
        // terminar. Com `fim` nulo (ausência em aberto), o lado direito é
        // infinito e a condição vira só "o outro não terminou antes daqui".
        AND: [
          { OR: [{ fim: null }, { fim: { gte: dados.inicio } }] },
          ...(dados.fim === null ? [] : [{ inicio: { lte: dados.fim } }]),
        ],
      },
      select: { inicio: true, fim: true },
    })

    if (conflitante) {
      const periodo = conflitante.fim
        ? `${conflitante.inicio} a ${conflitante.fim}`
        : `a partir de ${conflitante.inicio}`
      throw new ErroDeNegocio(
        `${pessoa.nome} já tem afastamento registrado que cobre este período (${periodo}). ` +
          'Cancele o anterior antes de registrar outro.',
      )
    }

    const afastamento = await tx.afastamento.create({
      data: {
        colaboradorId: dados.colaboradorId,
        tipo: dados.tipo,
        inicio: dados.inicio,
        fim: dados.fim,
        observacao: dados.observacao,
        registradoPor: ator.colaboradorId,
      },
    })

    await auditar(tx, {
      entidade: 'Colaborador',
      entidadeId: pessoa.id,
      acao: 'afastamento_registrado',
      depois: {
        afastamentoId: afastamento.id,
        tipo: dados.tipo,
        inicio: dados.inicio,
        fim: dados.fim,
      },
      usuario: ator.colaboradorId,
      correlacaoId,
    })

    return {
      id: afastamento.id,
      colaboradorId: pessoa.id,
      nome: pessoa.nome,
      tipo: dados.tipo,
      inicio: dados.inicio,
      fim: dados.fim,
      observacao: dados.observacao,
      vigente: cobre(dados.inicio, dados.fim, hojeIso()),
    }
  })
}

/**
 * Cancela um afastamento — CARIMBA, nunca apaga.
 *
 * Ausência que não aconteceu (férias adiadas, atestado corrigido) precisa parar
 * de tirar a pessoa do rateio, mas a trilha tem de continuar respondendo por
 * que alguém ficou fora na terça-feira passada. Apagar a linha destruiria essa
 * resposta.
 */
export async function cancelar(banco: Banco, afastamentoId: string, ator: Ator): Promise<void> {
  exigirPapel(ator, 'cancelar afastamento', 'gestor')
  const correlacaoId = novaCorrelacao()

  await banco.$transaction(async (tx) => {
    const afastamento = await tx.afastamento.findUnique({
      where: { id: afastamentoId },
      select: { id: true, colaboradorId: true, canceladoEm: true, inicio: true, fim: true },
    })

    if (!afastamento) throw new ErroDeNegocio('Afastamento não encontrado.')
    if (afastamento.canceladoEm) throw new ErroDeNegocio('Este afastamento já foi cancelado.')

    await tx.afastamento.update({
      where: { id: afastamentoId },
      data: { canceladoEm: new Date(), canceladoPor: ator.colaboradorId },
    })

    await auditar(tx, {
      entidade: 'Colaborador',
      entidadeId: afastamento.colaboradorId,
      acao: 'afastamento_cancelado',
      antes: { afastamentoId: afastamento.id, inicio: afastamento.inicio, fim: afastamento.fim },
      usuario: ator.colaboradorId,
      correlacaoId,
    })
  })
}

/**
 * Quem está fora HOJE, com o rótulo que este papel pode ver.
 *
 * Responde a parte do `A10` que pedia "exibição no painel de quem está fora" —
 * e que ficou parada até o dono do negócio decidir quem pode ver o quê
 * (06/09/2026). A resposta: a operação inteira precisa saber **quem não vai
 * receber trabalho**, porque sem isso a tela promete uma equipe que não existe;
 * o **motivo** fica na ficha, só para gestor.
 *
 * Não exige papel: todo mundo que já está autenticado pode ver a lista, porque
 * o que ela devolve para não-gestor já vem redigido. O que protege aqui é o
 * conteúdo, não a porta.
 */
export async function quemEstaFora(
  banco: Banco,
  ator: Ator,
  data = hojeIso(),
): Promise<{ colaboradorId: string; nome: string; rotulo: RotuloDeAfastamento }[]> {
  const linhas = await banco.afastamento.findMany({
    where: {
      canceladoEm: null,
      inicio: { lte: data },
      OR: [{ fim: null }, { fim: { gte: data } }],
    },
    orderBy: { inicio: 'asc' },
    include: { colaborador: { select: { id: true, nome: true, ativo: true } } },
  })

  return linhas
    .filter((linha) => linha.colaborador.ativo)
    .map((linha) => ({
      colaboradorId: linha.colaborador.id,
      nome: linha.colaborador.nome,
      // `!` seguro: `linha.tipo` nunca é nulo no banco, e a função só devolve
      // `null` quando recebe `null`.
      rotulo: rotuloDeAfastamento(linha.tipo, ator.papel)!,
    }))
}

/**
 * Afastamentos não cancelados, do mais recente para o mais antigo.
 *
 * Inclui os PASSADOS de propósito: "quem esteve fora no mês passado?" é
 * pergunta legítima ao conferir uma rodada antiga, e esconder o histórico
 * transformaria a tela num retrato do agora que não explica o ontem.
 */
export async function listar(
  banco: Banco,
  ator: Ator,
  data = hojeIso(),
): Promise<AfastamentoRegistrado[]> {
  // Mesmo papel de `listarColaboradores`: saber quem está de férias é saber
  // sobre a equipe, e a tela que mostra isso já é a de gestor.
  exigirPapel(ator, 'listar colaboradores', 'gestor')

  const linhas = await banco.afastamento.findMany({
    where: { canceladoEm: null },
    orderBy: [{ inicio: 'desc' }],
    include: { colaborador: { select: { nome: true } } },
  })

  return linhas.map((linha) => ({
    id: linha.id,
    colaboradorId: linha.colaboradorId,
    nome: linha.colaborador.nome,
    tipo: linha.tipo as TipoDeAfastamento,
    inicio: linha.inicio,
    fim: linha.fim,
    observacao: linha.observacao,
    vigente: cobre(linha.inicio, linha.fim, data),
  }))
}
