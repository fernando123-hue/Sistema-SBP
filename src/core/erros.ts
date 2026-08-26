/**
 * Erros de domínio.
 *
 * O motor NUNCA degrada silenciosamente. A planilha faz exatamente isso —
 * distribui para quem não trabalha, descarta ajuste, perde 16 itens da
 * categoria LIGA em abril — e ninguém percebe. Aqui, qualquer condição
 * anômala interrompe a transação inteira.
 */

export abstract class ErroDominio extends Error {
  abstract readonly codigo: string

  constructor(mensagem: string) {
    super(mensagem)
    this.name = new.target.name
  }
}

/**
 * Violação de regra de negócio causada pelo uso, não por defeito do sistema.
 *
 * "Só o responsável ativo pode concluir", "transferência exige justificativa",
 * "revisão já resolvida". A mensagem é escrita PARA o usuário e chega inteira
 * até a tela.
 *
 * Sem esta classe, esses casos eram `new Error(...)` puro — que a camada HTTP
 * não reconhece e trata como falha do servidor: o usuário via "Erro interno" em
 * vez do motivo real, e cada erro de uso normal era registrado em nível `erro`
 * como se fosse defeito, poluindo a observabilidade.
 */
export class ErroDeNegocio extends ErroDominio {
  readonly codigo: string

  constructor(mensagem: string, codigo = 'REGRA_DE_NEGOCIO') {
    super(mensagem)
    this.codigo = codigo
  }
}

/** Nunca distribuir para ninguém. Silenciar isto é como o trabalho some hoje. */
export class SemElegiveisError extends ErroDominio {
  readonly codigo = 'SEM_ELEGIVEIS'

  constructor(categoria: string, data: string) {
    super(
      `Nenhum colaborador elegível para a categoria "${categoria}" em ${data}. ` +
        `Verifique habilitação e escala do dia antes de distribuir.`,
    )
  }
}

export class QuantidadeInvalidaError extends ErroDominio {
  readonly codigo = 'QUANTIDADE_INVALIDA'

  constructor(quantidade: unknown) {
    super(
      `Quantidade deve ser inteiro não-negativo. Recebido: ${String(quantidade)}. ` +
        `Itens são indivisíveis — o motor nunca opera sobre frações.`,
    )
  }
}

export class ElegiveisInvalidosError extends ErroDominio {
  readonly codigo = 'ELEGIVEIS_INVALIDOS'

  constructor(motivo: string) {
    super(`Lista de elegíveis inválida: ${motivo}.`)
  }
}

export class CategoriaForaDoRateioError extends ErroDominio {
  readonly codigo = 'CATEGORIA_FORA_DO_RATEIO'

  constructor(categoria: string) {
    super(
      `A categoria "${categoria}" não participa do rateio diário ` +
        `(entraNoRateio = false). Registre manualmente.`,
    )
  }
}

/**
 * A trava central do sistema.
 *
 * A planilha quebra a conservação em 45 de 157 dias (29%). Aqui isso é
 * impossível de persistir: se a soma não bater, a transação inteira aborta.
 */
export class ConservacaoVioladaError extends ErroDominio {
  readonly codigo = 'CONSERVACAO_VIOLADA'

  constructor(
    readonly esperado: number,
    readonly obtido: number,
    readonly alocacao: Record<string, number>,
  ) {
    super(
      `Conservação violada: entrada = ${esperado}, distribuído = ${obtido}. ` +
        `Alocação rejeitada: ${JSON.stringify(alocacao)}. Transação abortada.`,
    )
  }
}
