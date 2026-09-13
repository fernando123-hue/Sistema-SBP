import {
  montarAvisoDoGestor,
  type AvisoDoGestor,
  type SituacaoDaLimpezaDeHoje,
} from '../core/aviso-do-gestor'
import { TipoDeAfastamentoGravadoSchema } from '../core/esquemas'
import { lerDoBanco } from '../core/lido-do-banco'
import { deslocarDias, hojeIso, paraDataIso } from '../core/util/datas'
import { exigirPapel, type Ator } from '../servidor/ator'
import type { Banco } from '../servidor/prisma'
import { prazoEmVigor } from './retencao'

/**
 * O aviso do dia para a gestora — `A17`. Só leitura, só gestor, sem IA.
 *
 * ═══ POR QUE NÃO PASSA PELO ASSISTENTE ═══
 *
 * O painel onde o aviso aparece é o do assistente, mas o conteúdo não chega
 * perto do `AssistentePort`. O manual que o modelo recebe é filtrado para não
 * conter dado pessoal (invariante 13); este aviso é FEITO de dado pessoal —
 * nome e motivo de ausência. Ele sai do banco, passa por uma regra pura e vai
 * direto para a tela de quem pode vê-lo.
 */
export async function avisoDoGestor(banco: Banco, ator: Ator, hoje = hojeIso()): Promise<AvisoDoGestor> {
  exigirPapel(ator, 'ver aviso do gestor', 'gestor')

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
        tipo: true,
        inicio: true,
        fim: true,
        canceladoEm: true,
        observacao: true,
        motivoExpurgadoEm: true,
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

  return montarAvisoDoGestor({
    hoje,
    prazoEmDias,
    limpeza,
    // Mesma escolha de `quemEstaFora`: pessoa desativada não faz parte da
    // equipe de hoje. O motivo dela continua saindo pelo prazo, pela rotina.
    ausencias: linhas
      .filter((linha) => linha.colaborador.ativo)
      .map((linha) => ({
        nome: linha.colaborador.nome,
        tipo: lerDoBanco(TipoDeAfastamentoGravadoSchema, linha.tipo, 'Afastamento.tipo'),
        inicio: linha.inicio,
        fim: linha.fim,
        canceladoNoDia: linha.canceladoEm === null ? null : paraDataIso(linha.canceladoEm),
        temObservacao: linha.observacao !== null,
        motivoJaSaiu: linha.motivoExpurgadoEm !== null,
      })),
  })
}
