import { ErroDeNegocio } from '../core/erros'
import { AlteracaoDePrazoSchema, ChaveDePrazoSchema, type ChaveDePrazo } from '../core/esquemas'
import { PRAZO_PADRAO_EM_DIAS, exigirPrazoValido, type PrazoEmVigor } from '../core/retencao'
import { exigirPapel, type Ator } from '../servidor/ator'
import { novaCorrelacao } from '../servidor/observabilidade'
import type { Banco, Transacao } from '../servidor/prisma'
import { auditar } from './auditoria'

/**
 * Prazos de retenção editáveis pela liderança — `DECISOES.md § A17`.
 *
 * "O prazo é editável por todos com papel gestor, pela tela, com a mudança
 * gravada na trilha (quem, de quanto para quanto, quando); encurtar apaga
 * motivos sem volta, então a tela confirma antes."
 */

/** Como a confirmação descreve o que encurtar apaga. Uma entrada por prazo que existe. */
const O_QUE_ENCURTAR_APAGA: Readonly<Record<ChaveDePrazo, string>> = {
  motivo_de_afastamento: 'o motivo das ausências que já passaram do novo prazo',
  conteudo_do_email: 'o texto e os anexos dos e-mails que já passaram do novo prazo',
}

/**
 * O prazo que a rotina deve cumprir hoje.
 *
 * Sem linha, o padrão decidido. Com linha, o valor dela — conferido de novo,
 * porque uma edição feita direto no banco com `0` passaria por cima do Zod da
 * rota e chegaria à rotina que apaga.
 */
export async function prazoEmVigor(banco: Transacao, chave: ChaveDePrazo): Promise<number> {
  const linha = await banco.prazoDeRetencao.findUnique({ where: { chave }, select: { dias: true } })
  if (linha === null) return PRAZO_PADRAO_EM_DIAS[chave]

  exigirPrazoValido(linha.dias)
  return linha.dias
}

export async function listarPrazos(banco: Banco, ator: Ator): Promise<PrazoEmVigor[]> {
  exigirPapel(ator, 'ver prazos de retenção', 'gestor')

  const linhas = await banco.prazoDeRetencao.findMany()
  const autores = await banco.colaborador.findMany({
    where: { id: { in: linhas.map((linha) => linha.alteradoPor) } },
    select: { id: true, nome: true },
  })

  // A lista sai do ESQUEMA, não do banco: um prazo que o código aplica aparece
  // mesmo sem linha (com o padrão), e uma linha de chave que o código não
  // conhece não vira campo editável que não apaga nada.
  return ChaveDePrazoSchema.options.map((chave) => {
    const linha = linhas.find((candidata) => candidata.chave === chave)
    const padrao = PRAZO_PADRAO_EM_DIAS[chave]

    if (linha === undefined) {
      return { chave, dias: padrao, padrao, alteradoEm: null, alteradoPorNome: null }
    }

    return {
      chave,
      dias: linha.dias,
      padrao,
      alteradoEm: linha.alteradoEm,
      alteradoPorNome: autores.find((autor) => autor.id === linha.alteradoPor)?.nome ?? null,
    }
  })
}

export interface MudancaDePrazo {
  chave: ChaveDePrazo
  diasAntes: number
  diasDepois: number
  /** `false` quando o pedido repetia o valor em vigor — nada gravado, nada na trilha. */
  mudou: boolean
}

export async function alterarPrazo(banco: Banco, entrada: unknown, ator: Ator): Promise<MudancaDePrazo> {
  exigirPapel(ator, 'alterar prazo de retenção', 'gestor')
  const dados = AlteracaoDePrazoSchema.parse(entrada)
  const correlacaoId = novaCorrelacao()

  return banco.$transaction(async (tx) => {
    // Lido DENTRO da transação: duas gestoras mudando ao mesmo tempo precisam
    // comparar com o valor que a outra acabou de gravar, senão a confirmação de
    // encurtamento seria pedida contra um número que já não vale.
    const diasAntes = await prazoEmVigor(tx, dados.chave)

    if (dados.dias === diasAntes) {
      return { chave: dados.chave, diasAntes, diasDepois: diasAntes, mudou: false }
    }

    if (dados.dias < diasAntes && !dados.confirmarEncurtamento) {
      throw new ErroDeNegocio(
        `Encurtar de ${diasAntes} para ${dados.dias} dias apaga, na próxima limpeza diária, ` +
          `${O_QUE_ENCURTAR_APAGA[dados.chave]} — sem volta. Confirme para seguir.`,
        'ENCURTAMENTO_NAO_CONFIRMADO',
      )
    }

    await tx.prazoDeRetencao.upsert({
      where: { chave: dados.chave },
      create: { chave: dados.chave, dias: dados.dias, alteradoPor: ator.colaboradorId },
      update: { dias: dados.dias, alteradoPor: ator.colaboradorId },
    })

    await auditar(tx, {
      entidade: 'PrazoDeRetencao',
      entidadeId: dados.chave,
      acao: 'prazo_de_retencao_alterado',
      antes: { dias: diasAntes },
      depois: { dias: dados.dias },
      usuario: ator.colaboradorId,
      correlacaoId,
    })

    return { chave: dados.chave, diasAntes, diasDepois: dados.dias, mudou: true }
  })
}
