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
 * Falha ESPERADA numa fronteira externa — modelo, armazenamento, adapter.
 *
 * ═══ POR QUE ESTA CLASSE PRECISOU EXISTIR ═══
 *
 * `ErroDominio` cobre o que o DOMÍNIO recusa: "transferência exige
 * justificativa", "revisão já resolvida". A camada HTTP reconhece e a mensagem
 * chega inteira à tela.
 *
 * As fronteiras externas tinham o mesmo problema que `ErroDeNegocio` resolveu
 * para o domínio, e ninguém tinha notado: `FalhaDeInterpretacao`,
 * `InterpretacaoIndisponivelError`, `AdapterIndisponivelError`,
 * `FalhaDeArmazenamento`, `FalhaDoAssistente` e `AssistenteIndisponivelError`
 * estendiam `Error` puro. Todas têm mensagem escrita para humano — a de
 * `InterpretacaoIndisponivelError` existe LITERALMENTE para dizer qual variável
 * de ambiente arrumar — e todas chegavam à tela como "Erro interno" com um
 * código de correlação. O operador via o mesmo texto para "a chave da IA está
 * errada" e para um defeito de programação, e a mensagem que dizia o que fazer
 * ficava só no log do servidor.
 *
 * Isso é o invariante 7 falhando na última curva: o sistema detectava a causa,
 * escrevia a explicação, e a jogava fora na saída.
 *
 * ═══ MENSAGEM PÚBLICA ≠ MENSAGEM DO LOG ═══
 *
 * `message` é para o log e carrega a causa técnica crua. `mensagemPublica` é o
 * que cruza para o cliente. Elas coincidem por padrão, e divergem onde a causa
 * crua contaria a quem pergunta mais sobre a infraestrutura do que ela precisa
 * saber — ver `AssistenteIndisponivelError`.
 */
export abstract class ErroOperacional extends Error {
  abstract readonly codigo: string
  /**
   * Status HTTP desta falha.
   *
   * `503` para "a dependência está fora ou mal configurada — tente de novo, ou
   * avise quem cuida"; `422` para "esta entrada específica não deu certo".
   *
   * Os dois, e só os dois — por tipo, não por comentário. `rota()` trata esta
   * classe ANTES do portão `status < 500` e devolve `mensagemPublica` direto ao
   * cliente. Com `number`, uma subclasse nova com `500` e uma `message` montada
   * a partir do erro cru do Prisma (que costuma trazer e-mail e id) atravessaria
   * inteira, sem correlação e sem registro — o oposto da regra que o mesmo
   * `rota()` declara, com ênfase, dez linhas abaixo. Falha de servidor não é
   * falha operacional: ela sobe como `Error` e cai no ramo genérico.
   */
  abstract readonly statusHttp: 422 | 503

  constructor(mensagem: string) {
    super(mensagem)
    this.name = new.target.name
  }

  /** O que a tela pode mostrar. Sobrescreva quando a causa crua não deve sair. */
  get mensagemPublica(): string {
    return this.message
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

/**
 * A IA classificou numa categoria que o banco não tem.
 *
 * O enum do código e a tabela `Categoria` saíram de sincronia — seed
 * incompleto, migração pela metade, categoria removida à mão. Descartar o
 * item seria perdê-lo para sempre: a idempotência por `messageId` garante que
 * aquele e-mail nunca mais é reinterpretado. Abortando a transação, o e-mail
 * continua sem `processadoEm` e volta inteiro na próxima sincronização, depois
 * que o cadastro for corrigido.
 */
export class CategoriaDesconhecidaError extends ErroDominio {
  readonly codigo = 'CATEGORIA_DESCONHECIDA'

  constructor(categoria: string) {
    super(
      `A categoria "${categoria}" não existe no cadastro. ` +
        `O item NÃO foi descartado: a transação inteira foi abortada e o e-mail ` +
        `continua reprocessável. Cadastre a categoria e sincronize de novo.`,
    )
  }
}

/**
 * A credencial gravada para esta pessoa não pode ser lida (achado N-36).
 *
 * Hash truncado por migração malfeita, coluna editada à mão, campo corrompido.
 * Antes isto era tratado como "senha errada": a pessoa tentava cinco vezes, a
 * conta travava, o suporte destravava — e travava de novo, porque a causa
 * continuava no banco. Ninguém, em lugar nenhum, ficava sabendo que o defeito
 * era do SISTEMA. É o erro silencioso do invariante 7, cobrando o acesso de
 * alguém.
 *
 * `503` e não `422`: a entrada da pessoa não tem defeito nenhum; o que está
 * quebrado é o dado guardado deste lado.
 */
export class CredencialIlegivelError extends ErroOperacional {
  readonly codigo = 'CREDENCIAL_ILEGIVEL'
  readonly statusHttp = 503

  constructor(colaboradorId: string) {
    super(`Credencial ilegível no banco para o colaborador ${colaboradorId}`)
  }

  /**
   * O id do colaborador NÃO sai daqui.
   *
   * A tela de entrada é pública, e a mensagem não pode confirmar que aquele
   * e-mail existe. Ela manda procurar quem resolve, que é o que a pessoa
   * precisa fazer; o id fica no log e no evento.
   */
  override get mensagemPublica(): string {
    return 'Não foi possível validar sua entrada. Procure o gestor do sistema.'
  }
}
