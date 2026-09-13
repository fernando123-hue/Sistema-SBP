import {
  chavesQueSairam,
  compararComOVisto,
  lerChaveDoAviso,
  montarAvisoDoGestor,
  quemMexeuPorUltimo,
  type AvisoDoGestor,
  type AvisoParaATela,
  type SituacaoDaLimpezaDeHoje,
  type VistoPelaGestora,
} from '../core/aviso-do-gestor'
import { AvisoVistoEntradaSchema, ChavesDoAvisoSchema, TipoDeAfastamentoGravadoSchema } from '../core/esquemas'
import { lerDoBanco } from '../core/lido-do-banco'
import { deslocarDias, hojeIso, paraDataIso } from '../core/util/datas'
import { exigirPapel, type Ator } from '../servidor/ator'
import type { Banco } from '../servidor/prisma'
import { prazoEmVigor } from './retencao'

/**
 * O aviso do dia para a gestora — `A17`. Só gestor, sem IA.
 *
 * ═══ POR QUE NÃO PASSA PELO ASSISTENTE ═══
 *
 * O painel onde o aviso aparece é o do assistente, mas o conteúdo não chega
 * perto do `AssistentePort`. O manual que o modelo recebe é filtrado para não
 * conter dado pessoal (invariante 13); este aviso é FEITO de dado pessoal —
 * nome e motivo de ausência. Ele sai do banco, passa por uma regra pura e vai
 * direto para a tela de quem pode vê-lo.
 *
 * ═══ O QUE MUDOU DESDE A ÚLTIMA OLHADA (`A39(e)`) ═══
 *
 * O quadro abre sozinho só na primeira vez do dia. Depois disso, o que entrar
 * ou sair do aviso acende a bolinha e aparece com nome — inclusive a troca de
 * uma pessoa por outra, que o dono pediu para não passar calada.
 */

async function lerAviso(
  banco: Banco,
  hoje: string,
): Promise<{
  aviso: AvisoDoGestor
  nomePorAfastamento: Map<string, string>
  autorPorAfastamento: Map<string, string>
}> {
  const ontem = deslocarDias(hoje, -1)

  const [linhas, prazoEmDias, execucao] = await Promise.all([
    banco.afastamento.findMany({
      where: {
        OR: [
          // Motivo ainda guardado: pode estar perto de sair. O carimbo do
          // expurgo tira da lista quem já passou, então ela não cresce com o
          // histórico.
          { motivoExpurgadoEm: null },
          // Fora hoje, ou voltando hoje ou amanhã — mesmo com o motivo já
          // apagado (uma licença longa segue "fora" como ausente).
          { canceladoEm: null, OR: [{ fim: null }, { fim: { gte: ontem } }] },
        ],
      },
      select: {
        id: true,
        tipo: true,
        inicio: true,
        fim: true,
        canceladoEm: true,
        observacao: true,
        motivoExpurgadoEm: true,
        registradoPor: true,
        encerradoPor: true,
        canceladoPor: true,
        colaborador: { select: { nome: true, ativo: true } },
      },
    }),
    prazoEmVigor(banco, 'motivo_de_afastamento'),
    banco.execucaoDeRotina.findUnique({
      where: { rotina_data: { rotina: 'limpeza_diaria', data: hoje } },
      select: { situacao: true },
    }),
  ])

  const limpeza: SituacaoDaLimpezaDeHoje =
    execucao?.situacao === 'sucesso' ? 'concluida' : execucao?.situacao === 'falha' ? 'falhou' : 'pendente'

  // Mesma escolha de `quemEstaFora`: pessoa desativada não faz parte da equipe
  // de hoje. O motivo dela continua saindo pelo prazo, pela rotina.
  const ativas = linhas.filter((linha) => linha.colaborador.ativo)

  const aviso = montarAvisoDoGestor({
    hoje,
    prazoEmDias,
    limpeza,
    ausencias: ativas.map((linha) => ({
      id: linha.id,
      nome: linha.colaborador.nome,
      tipo: lerDoBanco(TipoDeAfastamentoGravadoSchema, linha.tipo, 'Afastamento.tipo'),
      inicio: linha.inicio,
      fim: linha.fim,
      canceladoNoDia: linha.canceladoEm === null ? null : paraDataIso(linha.canceladoEm),
      temObservacao: linha.observacao !== null,
      motivoJaSaiu: linha.motivoExpurgadoEm !== null,
    })),
  })

  return {
    aviso,
    nomePorAfastamento: new Map(ativas.map((linha) => [linha.id, linha.colaborador.nome])),
    autorPorAfastamento: new Map(linhas.map((linha) => [linha.id, quemMexeuPorUltimo(linha)])),
  }
}

async function lerVisto(banco: Banco, colaboradorId: string): Promise<VistoPelaGestora | null> {
  const linha = await banco.avisoVisto.findUnique({ where: { colaboradorId } })
  if (linha === null) return null
  return {
    data: linha.data,
    // JSON que não se lê cai no ramo dos 500, com correlação — é defeito de dado.
    chaves: lerDoBanco(ChavesDoAvisoSchema, JSON.parse(linha.chaves), 'AvisoVisto.chaves'),
  }
}

export async function avisoDoGestor(banco: Banco, ator: Ator, hoje = hojeIso()): Promise<AvisoParaATela> {
  exigirPapel(ator, 'ver aviso do gestor', 'gestor')

  const [{ aviso, nomePorAfastamento, autorPorAfastamento }, visto] = await Promise.all([
    lerAviso(banco, hoje),
    lerVisto(banco, ator.colaboradorId),
  ])

  // Quem SAIU do aviso não está mais na leitura de agora — o nome vem da linha
  // do afastamento, que nunca é apagada (invariante 11). Inclui pessoa
  // desativada no meio do dia: sair da equipe também é sair da lista.
  const idsQueSairam = chavesQueSairam(aviso.chaves, visto, hoje)
    .map((chave) => lerChaveDoAviso(chave)?.afastamentoId)
    .filter((id): id is string => typeof id === 'string' && !nomePorAfastamento.has(id))

  // Só o NOME. O autor de quem saiu já veio de `lerAviso`, que lê todas as
  // linhas da consulta, inclusive de pessoa desativada. Uma ausência que saiu da
  // própria consulta saiu porque a limpeza apagou o motivo no meio do dia — e
  // aí não foi a gestora quem mexeu: atribuir a ela o último registro humano
  // esconderia um aviso verdadeiro.
  if (idsQueSairam.length > 0) {
    const sairam = await banco.afastamento.findMany({
      where: { id: { in: idsQueSairam } },
      select: { id: true, colaborador: { select: { nome: true } } },
    })
    for (const linha of sairam) nomePorAfastamento.set(linha.id, linha.colaborador.nome)
  }

  return {
    ...aviso,
    ...compararComOVisto({
      hoje,
      chaves: aviso.chaves,
      visto,
      nomePorAfastamento,
      quemOlha: ator.colaboradorId,
      autorPorAfastamento,
    }),
  }
}

/**
 * A gestora viu o aviso: grava o que ela viu.
 *
 * O corpo traz as chaves que a TELA mostrou, e só as que ainda estão no aviso
 * de agora são gravadas. Aceitar a lista do corpo inteira deixaria marcar como
 * visto o que não existe; recalcular sem ouvir o corpo marcaria como visto o que
 * chegou entre a leitura da tela e este pedido — e essa novidade sumiria sem
 * bolinha.
 *
 * Não vai para a trilha: olhar um aviso não altera registro nenhum.
 */
export async function marcarAvisoComoVisto(
  banco: Banco,
  entrada: unknown,
  ator: Ator,
  hoje = hojeIso(),
): Promise<{ marcadas: number }> {
  exigirPapel(ator, 'marcar aviso do gestor como visto', 'gestor')
  const { chaves } = AvisoVistoEntradaSchema.parse(entrada)

  const { aviso } = await lerAviso(banco, hoje)
  const atuais = new Set(aviso.chaves)
  const vistas = [...new Set(chaves)].filter((chave) => atuais.has(chave))

  await banco.avisoVisto.upsert({
    where: { colaboradorId: ator.colaboradorId },
    create: { colaboradorId: ator.colaboradorId, data: hoje, chaves: JSON.stringify(vistas) },
    update: { data: hoje, chaves: JSON.stringify(vistas) },
  })

  return { marcadas: vistas.length }
}
