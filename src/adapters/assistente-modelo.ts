import {
  RespostaDoModeloAssistenteSchema,
  TAMANHO_MAXIMO_DA_PERGUNTA,
  type RespostaDoModeloAssistente,
} from '../core/assistente/esquemas'
import { montarMaterial, type QuemPergunta } from '../core/assistente/prompt'
import { prepararConteudoExterno } from '../core/seguranca/conteudo-nao-confiavel'
import { resumoDeValidacao } from '../core/seguranca/resumo-de-validacao'
import { resumoDeTransporte } from '../core/seguranca/resumo-de-transporte'
import { LimiteDeConsumoAtingido } from '../ports/consumo'
import {
  AssistenteIndisponivelError,
  FalhaDoAssistente,
  type AssistentePort,
} from '../ports/assistente'
import { ambiente } from '../servidor/ambiente'
import { registrarLog } from '../servidor/observabilidade'
import { especieDoErro, type ClienteDeModelo, type PerfilDoFornecedor } from './fornecedor'

/**
 * O assistente deste sistema, menos o fornecedor.
 *
 * ═══ A MESMA POLÍTICA DA INTERPRETAÇÃO, PELO MESMO MOTIVO ═══
 *
 * As três camadas contra injeção, a repetição única e só por erro de formato,
 * a distinção entre falha desta chamada e camada fora do ar, a revalidação do
 * que o SDK já disse ter validado: tudo isso vale igual aqui. Não porque
 * "assistente também usa IA", mas porque são decisões DESTE sistema sobre como
 * tratar texto que não escrevemos, e elas não mudam com o fornecedor.
 *
 * ═══ POR QUE A PERGUNTA DE UM COLEGA PASSA PELA DEFESA CONTRA INJEÇÃO ═══
 *
 * Quem pergunta está autenticado, tem papel conferido e é da equipe. Ainda
 * assim a pergunta é tratada como conteúdo não confiável, por três razões
 * concretas:
 *
 *   1. **O caminho mais provável de um ataque é o copiar-e-colar.** A pergunta
 *      real que a operação vai fazer é "o que quer dizer este e-mail?", com o
 *      e-mail colado junto. Nesse instante o texto de um terceiro entra no
 *      prompt pela mão de alguém de dentro, sem nenhuma má intenção.
 *   2. **Conta comprometida.** Uma senha vazada não deve virar um caminho para
 *      reescrever o comportamento do assistente para todo mundo.
 *   3. **A defesa custa quase nada.** Truncar, marcar e delimitar é barato; o
 *      caso em que faltariam é justamente o caro.
 *
 * ═══ O QUE UMA INJEÇÃO BEM-SUCEDIDA CONSEGUE AQUI ═══
 *
 * No limite: uma resposta errada em texto, na tela de quem perguntou. O
 * assistente não grava nada, não decide nada, não enxerga dado de outra pessoa
 * e não recebe conteúdo de e-mail nem nota do setor no material — o prompt é o
 * manual filtrado por papel, e mais nada. É a mesma escolha de arquitetura que
 * limita o estrago na interpretação de e-mail: a defesa real não é a regex, é
 * o modelo não ter autoridade sobre coisa nenhuma.
 */

/**
 * Teto da pergunta ao passar pelas três camadas.
 *
 * Bem menor que o do corpo de e-mail: aqui o texto legítimo é uma dúvida de
 * duas linhas. O esquema já recusa antes com mensagem melhor; este teto é a
 * segunda tranca, para o caso de alguém construir o adapter direto.
 */
const TETO_DA_PERGUNTA = TAMANHO_MAXIMO_DA_PERGUNTA

export class AssistenteComModelo implements AssistentePort {
  readonly nome: string

  constructor(
    private readonly perfil: PerfilDoFornecedor,
    private readonly cliente: ClienteDeModelo,
  ) {
    this.nome = perfil.nome
  }

  async responder(quem: QuemPergunta, pergunta: string): Promise<RespostaDoModeloAssistente> {
    const { instrucoes, verbetes } = montarMaterial(quem)

    // As três camadas ANTES de qualquer contato com o modelo.
    const { conteudo, analise } = prepararConteudoExterno(pergunta, TETO_DA_PERGUNTA)

    // Detecção não bloqueia — levanta a mão. Aqui não há fila de revisão para
    // onde mandar, então o sinal vira log: é o que permite descobrir depois que
    // alguém andou colando corpo de e-mail no assistente, ou tentando reescrevê-lo.
    if (analise.suspeito) {
      registrarLog('aviso', 'pergunta ao assistente com padrão de injeção', {
        adapter: this.nome,
        padroes: analise.padroes,
        // O TEXTO da pergunta não vai para o log. Ele pode conter o e-mail que
        // a pessoa colou, e log não tem política de retenção (invariante 11).
        tamanho: pergunta.length,
      })
    }

    const modelo = ambiente().IA_MODELO || this.perfil.modeloPadrao

    const primeira = await this.tentar(instrucoes, conteudo, modelo, null)
    const resultado =
      primeira.tipo === 'ok' || primeira.especie === 'transporte'
        ? primeira
        : await this.tentar(instrucoes, conteudo, modelo, primeira.erro)

    if (resultado.tipo === 'erro') throw new FalhaDoAssistente(resultado.erro)

    // Citação de verbete que não foi enviado é resposta inventada se apoiando
    // numa fonte que não existe. Descartamos a citação — nunca a inventamos de
    // volta — e registramos, porque é o sinal mais barato de que o modelo saiu
    // do material.
    const idsEnviados = new Set(verbetes.map((verbete) => verbete.id))
    const citadosValidos = resultado.resposta.verbetesUsados.filter((id) => idsEnviados.has(id))
    if (citadosValidos.length !== resultado.resposta.verbetesUsados.length) {
      registrarLog('aviso', 'assistente citou verbete inexistente', {
        adapter: this.nome,
        // A CONTAGEM, nunca o texto citado (achado C-15): `verbetesUsados` é
        // escrito pelo modelo, e quem pergunta pode induzi-lo a "citar" o CPF
        // do e-mail que colou. Log não tem política de retenção (invariante 11).
        descartados: resultado.resposta.verbetesUsados.length - citadosValidos.length,
      })
    }

    return { ...resultado.resposta, verbetesUsados: citadosValidos }
  }

  private async tentar(
    instrucoes: string,
    conteudo: string,
    modelo: string,
    erroAnterior: string | null,
  ): Promise<
    | { tipo: 'ok'; resposta: RespostaDoModeloAssistente }
    | { tipo: 'erro'; erro: string; especie: 'validacao' | 'transporte' }
  > {
    try {
      const { objeto } = await this.cliente.gerar({
        esquema: RespostaDoModeloAssistenteSchema,
        // Resumido, nunca a mensagem crua — mesma fresta descrita em
        // `resumo-de-validacao.ts`. Aqui ela seria ainda mais direta: a
        // pergunta é escrita por quem está logado, e `resposta` é um texto
        // livre que o modelo devolve. Colar o erro cru daria a qualquer pessoa
        // um caminho para escrever na região de instruções em duas rodadas.
        instrucoes: erroAnterior
          ? `${instrucoes}\n\nA tentativa anterior foi rejeitada pela validação. Defeitos de forma encontrados: ${erroAnterior}\nDevolva o mesmo conteúdo corrigido, respeitando exatamente o formato pedido.`
          : instrucoes,
        conteudo,
        modelo,
      })

      // Revalidação nossa, como na interpretação: com fornecedor que só garante
      // "é JSON", esta linha deixa de ser cinto de segurança e passa a ser a
      // validação.
      return { tipo: 'ok', resposta: RespostaDoModeloAssistenteSchema.parse(objeto) }
    } catch (erro) {
      const causa = erro instanceof Error ? erro.message : String(erro)

      // Sobe inteiro: chave recusada não é problema desta pergunta, e a
      // mensagem tem de mandar arrumar a configuração.
      if (this.perfil.ehCredencialRecusada(erro)) throw new AssistenteIndisponivelError(resumoDeTransporte(causa))

      // Mesma razão da interpretação: teto, disjuntor e conta sem crédito são
      // a camada fora do ar, não defeito desta pergunta — e repetir a chamada
      // gastaria a segunda tentativa contra uma porta que já está fechada.
      if (erro instanceof LimiteDeConsumoAtingido || this.perfil.ehSemCredito?.(erro) === true) {
        throw new AssistenteIndisponivelError(resumoDeTransporte(causa))
      }

      const especie = especieDoErro(erro)
      // Validação vira resumo estrutural; transporte é texto do fornecedor,
      // curto e mascarado. Mesma distinção de `ia-estruturada.ts`, e pelo
      // mesmo motivo: o log não tem política de retenção.
      const paraRegistrar = especie === 'validacao' ? resumoDeValidacao(erro) : resumoDeTransporte(causa)

      registrarLog(
        'aviso',
        especie === 'validacao'
          ? 'resposta do assistente recusada pela validação'
          : 'chamada do assistente ao modelo falhou',
        { adapter: this.nome, especie, segundaTentativa: erroAnterior !== null, causa: paraRegistrar },
      )
      return { tipo: 'erro', erro: paraRegistrar, especie }
    }
  }
}
